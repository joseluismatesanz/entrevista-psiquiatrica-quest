import test from "node:test";
import assert from "node:assert/strict";
import { applyClinicalPostprocessing } from "../server/clinical-postprocess.mjs";

function fixture(text) {
  return {
    sources: [
      { id: "patient", label: "Paciente", kind: "patient" },
      { id: "mother", label: "Madre", kind: "mother" },
    ],
    sections: {
      situacion_sociofamiliar: {
        text,
        evidence_status: "supported",
        source_ids: ["patient", "mother"],
      },
      tratamiento_habitual: { text: "", evidence_status: "not_provided", source_ids: [] },
      tratamiento_actual: { text: "", evidence_status: "not_provided", source_ids: [] },
    },
    medications: { habitual: [], current: [] },
    conflicts: [],
  };
}

test("V0.5.4 sociofamiliar: elimina acompañamiento a la consulta aunque no diga Urgencias", () => {
  const result = applyClinicalPostprocessing(
    fixture("Convive con su padre y su hermana menor. Acude acompañada por su madre."),
    "PACIENTE: Vivo con mi padre y mi hermana. MADRE: La he acompañado hoy."
  );

  assert.equal(result.assessment.sections.situacion_sociofamiliar.text, "Convive con su padre y su hermana menor.");
  assert.ok(result.warnings.includes("sociofamily_encounter_accompaniment_pruned_postprocess"));
  assert.equal(result.meta.sociofamily_encounter_accompaniment_guard, true);
});

test("V0.5.4 sociofamiliar: conserva hechos relacionales reales aunque mencionen a la madre", () => {
  const result = applyClinicalPostprocessing(
    fixture("Convive con su madre y mantiene buena relación con ella."),
    "PACIENTE: Vivo con mi madre y nos llevamos bien."
  );

  assert.match(result.assessment.sections.situacion_sociofamiliar.text, /Convive con su madre/);
  assert.equal(result.warnings.includes("sociofamily_encounter_accompaniment_pruned_postprocess"), false);
});
