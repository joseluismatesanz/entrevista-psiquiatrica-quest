import test from "node:test";
import assert from "node:assert/strict";
import { groundInterventionToTranscript } from "../server/intervention-grounding.mjs";

function assessmentWithIntervention(text = "La paciente y su madre aceptan la propuesta.") {
  return {
    sources: [
      { id: "psy", label: "Psiquiatra", kind: "psychiatrist" },
      { id: "pat", label: "Paciente", kind: "patient" },
      { id: "mom", label: "Madre", kind: "mother" },
    ],
    sections: {
      intervencion: {
        text,
        evidence_status: "supported",
        source_ids: ["psy", "pat", "mom"],
      },
    },
  };
}

test("Intervención: reconstruye propuesta concreta y respuestas desde la transcripción", () => {
  const input = assessmentWithIntervention();
  const transcript = [
    "PSIQUIATRA: Con esta entrevista breve no voy a cerrar un diagnóstico. Necesitamos ampliar cronología. Propongo valoración preferente por Salud Mental Infanto-Juvenil en 24-48 horas y vigilancia familiar mientras tanto.",
    "PACIENTE: De acuerdo, acepto la valoración.",
    "MADRE: Yo también estoy de acuerdo.",
  ].join("\n");

  const result = groundInterventionToTranscript(input, transcript);
  const section = result.assessment.sections.intervencion;

  assert.equal(result.grounded, true);
  assert.match(section.text, /^Se propone valoración preferente por Salud Mental Infanto-Juvenil en 24-48 horas y vigilancia familiar mientras tanto\./);
  assert.match(section.text, /La paciente acepta la propuesta\./);
  assert.match(section.text, /La madre muestra conformidad\./);
  assert.equal(section.evidence_status, "supported");
  assert.deepEqual(section.source_ids, ["psy", "pat", "mom"]);
  assert.ok(result.warnings.includes("intervention_grounded_to_explicit_transcript_proposal_response"));
});

test("Intervención: una referencia genérica a la propuesta se elimina si no existe propuesta explícita", () => {
  const input = assessmentWithIntervention("La paciente acepta la propuesta.");
  const transcript = [
    "PSIQUIATRA: ¿Estás de acuerdo con que sigamos hablando?",
    "PACIENTE: Sí, de acuerdo.",
  ].join("\n");

  const result = groundInterventionToTranscript(input, transcript);
  const section = result.assessment.sections.intervencion;

  assert.equal(result.grounded, false);
  assert.equal(section.text, "");
  assert.equal(section.evidence_status, "not_provided");
  assert.deepEqual(section.source_ids, []);
  assert.ok(result.warnings.includes("intervention_generic_proposal_reference_removed_without_grounding"));
});

test("Intervención: no se documenta propuesta sin respuesta explícita de la paciente", () => {
  const input = assessmentWithIntervention("La paciente acepta la propuesta.");
  const transcript = [
    "PSIQUIATRA: Propongo valoración preferente por Salud Mental en 24 horas.",
    "MADRE: Me parece bien.",
  ].join("\n");

  const result = groundInterventionToTranscript(input, transcript);
  const section = result.assessment.sections.intervencion;

  assert.equal(result.grounded, false);
  assert.equal(section.text, "");
  assert.equal(section.evidence_status, "not_provided");
});
