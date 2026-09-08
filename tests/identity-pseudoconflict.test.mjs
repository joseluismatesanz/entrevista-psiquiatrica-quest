import test from "node:test";
import assert from "node:assert/strict";
import { applyClinicalPostprocessing } from "../server/clinical-postprocess.mjs";

function baseAssessment() {
  return {
    sources: [
      { id: "pat", label: "Paciente", kind: "patient" },
      { id: "mom", label: "Madre", kind: "mother" },
    ],
    sections: {},
    medications: { habitual: [], current: [] },
    conflicts: [],
  };
}

test("V0.5.5: creencia de sustitución + contraste de realidad familiar no se trata como discrepancia factual", () => {
  const assessment = baseAssessment();
  assessment.conflicts = [
    {
      topic: "Identidad o sustitución de la madre",
      accounts: [
        { source_id: "pat", statement: "Considera desde hace una semana que su madre podría haber sido sustituida." },
        { source_id: "mom", statement: "Afirma ser la madre biológica y niega adopción o cambio de cuidador." },
      ],
    },
  ];

  const result = applyClinicalPostprocessing(assessment, "");
  assert.equal(result.assessment.conflicts.length, 0);
  assert.ok(result.warnings.includes("identity_substitution_reality_check_pseudoconflict_pruned"));
  assert.equal(result.meta.identity_substitution_reality_check_guard, true);
});

test("V0.5.5: una discrepancia factual familiar real se conserva", () => {
  const assessment = baseAssessment();
  assessment.conflicts = [
    {
      topic: "Frecuencia de asistencia al instituto",
      accounts: [
        { source_id: "pat", statement: "Dice que ha faltado dos días." },
        { source_id: "mom", statement: "Refiere que ha faltado seis días." },
      ],
    },
  ];

  const result = applyClinicalPostprocessing(assessment, "");
  assert.equal(result.assessment.conflicts.length, 1);
});
