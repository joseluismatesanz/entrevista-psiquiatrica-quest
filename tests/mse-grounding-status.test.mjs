import test from "node:test";
import assert from "node:assert/strict";
import { groundExplicitMseAssessment, hasExplicitClinicianMseObservation } from "../server/mse-grounding.mjs";

function assessment(status = "insufficient", text = "Consciente, orientada y colaboradora. Discurso organizado. No se objetiva agitación.") {
  return {
    sources: [
      { id: "psy", label: "Psiquiatra", kind: "psychiatrist" },
      { id: "obs", label: "Observación clínica", kind: "clinician_observation" },
      { id: "pat", label: "Paciente", kind: "patient" },
    ],
    sections: {
      exploracion_psicopatologica: {
        text,
        evidence_status: status,
        source_ids: ["pat"],
      },
    },
  };
}

test("MSE: una observación clínica explícita del psiquiatra promueve el apartado a Consta", () => {
  const transcript = "PSIQUIATRA: Durante la entrevista estás consciente, orientada, colaboradora y con discurso organizado. No se objetivan alteraciones del lenguaje ni agitación.\nPACIENTE: De acuerdo.";
  assert.equal(hasExplicitClinicianMseObservation(transcript), true);

  const result = groundExplicitMseAssessment(assessment(), transcript);
  assert.equal(result.assessment.sections.exploracion_psicopatologica.evidence_status, "supported");
  assert.ok(result.assessment.sections.exploracion_psicopatologica.source_ids.includes("psy"));
  assert.ok(result.assessment.sections.exploracion_psicopatologica.source_ids.includes("obs"));
  assert.ok(result.warnings.includes("mse_status_promoted_from_explicit_clinician_observation"));
});

test("MSE: un síntoma referido solo por la paciente no se promociona a observación clínica", () => {
  const transcript = "PSIQUIATRA: ¿Cómo te encuentras?\nPACIENTE: Estoy muy nerviosa y me cuesta concentrarme.";
  assert.equal(hasExplicitClinicianMseObservation(transcript), false);

  const result = groundExplicitMseAssessment(
    assessment("insufficient", "Refiere nerviosismo y dificultad de concentración."),
    transcript
  );
  assert.equal(result.assessment.sections.exploracion_psicopatologica.evidence_status, "insufficient");
  assert.deepEqual(result.warnings, []);
});
