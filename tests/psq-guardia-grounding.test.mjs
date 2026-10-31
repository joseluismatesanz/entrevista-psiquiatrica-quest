import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { groundPsqGuardiaToTranscript } from "../server/psq-guard.mjs";
import { renderClinicalReport } from "../server/render-report.mjs";

function assessmentWithPsq(text = "MIR MAtesanz") {
  return {
    sources: [{ id: "psy", label: "Psiquiatra entrevistador", kind: "psychiatrist" }],
    sections: {
      psq_guardia: { text, evidence_status: "supported", source_ids: ["psy"] },
    },
    medications: { habitual: [], current: [] },
  };
}

test("PSQ Guardia: elimina una identidad que no aparece explícitamente en la transcripción", () => {
  const transcript = "PSIQUIATRA: Paula, 17 años, ¿qué os preocupa hoy?\nPACIENTE: Estoy muy nerviosa.";
  const result = groundPsqGuardiaToTranscript(assessmentWithPsq(), transcript);

  assert.equal(result.assessment.sections.psq_guardia.text, "");
  assert.equal(result.assessment.sections.psq_guardia.evidence_status, "not_provided");
  assert.deepEqual(result.assessment.sections.psq_guardia.source_ids, []);
  assert.ok(result.warnings.includes("psq_guardia_unsupported_identity_removed"));
  assert.doesNotMatch(renderClinicalReport(result.assessment), /MAtesanz/i);
});

test("PSQ Guardia: conserva solo una autoidentificación explícita del profesional", () => {
  const transcript = "PSIQUIATRA: Soy la Dra. García. Voy a hacerte unas preguntas.\nPACIENTE: De acuerdo.";
  const result = groundPsqGuardiaToTranscript(assessmentWithPsq("Nombre inventado"), transcript);

  assert.equal(result.assessment.sections.psq_guardia.text, "Dra. García");
  assert.equal(result.assessment.sections.psq_guardia.evidence_status, "supported");
  assert.deepEqual(result.assessment.sections.psq_guardia.source_ids, ["psy"]);
});

test("PSQ Guardia: no quedan identidades hardcodeadas en invariantes ni en el renderizador", async () => {
  const [invariants, renderer] = await Promise.all([
    readFile(new URL("../server/clinical-invariants.mjs", import.meta.url), "utf8"),
    readFile(new URL("../server/render-report.mjs", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(invariants, /MIR MAtesanz/);
  assert.doesNotMatch(renderer, /MIR MAtesanz/);
  assert.doesNotMatch(invariants, /psq_guardia_not_exact/);
});
