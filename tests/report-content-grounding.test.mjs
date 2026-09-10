import test from "node:test";
import assert from "node:assert/strict";
import { groundReportContentToTranscript } from "../server/report-content-grounding.mjs";

function assessment(overrides = {}) {
  return {
    sources: [
      { id: "p", label: "Paula", kind: "patient" },
      { id: "m", label: "Madre", kind: "mother" },
      { id: "q", label: "Psiquiatra", kind: "psychiatrist" },
    ],
    sections: {
      enfermedad_actual: {
        text: "La paciente niega alucinaciones auditivas o visuales, autolesiones, ideación de muerte e intención autoagresiva o heteroagresiva.",
        evidence_status: "supported",
        source_ids: ["p", "m"],
      },
      situacion_sociofamiliar: {
        text: "Convive con su madre y un hermano menor. Escolarizada en instituto.",
        evidence_status: "supported",
        source_ids: ["p", "m"],
      },
      plan_terapeutico: {
        text: "Valoración preferente por Salud Mental Infanto-Juvenil en 24-48 horas. Vigilancia familiar hasta dicha valoración.",
        evidence_status: "supported",
        source_ids: ["q"],
      },
      ...overrides,
    },
  };
}

const CASE3 = `PSIQUIATRA: ¿Has pensado en hacerte daño, morir o hacer daño a alguien?\nPACIENTE: No. No quiero hacerme daño ni hacer daño a nadie.\nMADRE: No he visto autolesiones ni amenazas, pero está más aislada y ha faltado dos días al instituto.\nPSIQUIATRA: Con esta entrevista breve no voy a cerrar un diagnóstico. Necesitamos ampliar cronología, impacto funcional, sueño, posibles causas médicas y evolución del contenido ideativo. Propongo valoración preferente por Salud Mental Infanto-Juvenil en 24-48 horas y vigilancia familiar mientras tanto.`;

test("Informe: no atribuye a la paciente una negación formal de autolesiones si solo negó hacerse daño", () => {
  const result = groundReportContentToTranscript(assessment(), CASE3);
  const text = result.assessment.sections.enfermedad_actual.text;
  assert.doesNotMatch(text, /autolesiones/i);
  assert.match(text, /ideación de muerte/i);
  assert.ok(result.warnings.includes("report_patient_autolesion_denial_removed_without_explicit_patient_evidence"));
});

test("Informe: conserva una negación de autolesiones cuando la paciente la expresa de forma específica", () => {
  const transcript = `PSIQUIATRA: ¿Te has autolesionado?\nPACIENTE: No, no me he autolesionado ni me he cortado.`;
  const result = groundReportContentToTranscript(assessment(), transcript);
  assert.match(result.assessment.sections.enfermedad_actual.text, /autolesiones/i);
});

test("Informe: faltar al instituto no se convierte por inferencia en escolarización declarada", () => {
  const result = groundReportContentToTranscript(assessment(), CASE3);
  const text = result.assessment.sections.situacion_sociofamiliar.text;
  assert.match(text, /Convive con su madre/i);
  assert.doesNotMatch(text, /Escolarizada|instituto/i);
  assert.ok(result.warnings.includes("report_inferred_schooling_removed_without_explicit_transcript_statement"));
});

test("Informe: el plan conserva la ampliación diagnóstica explícita del psiquiatra", () => {
  const result = groundReportContentToTranscript(assessment(), CASE3);
  const text = result.assessment.sections.plan_terapeutico.text;
  assert.match(text, /Valoración preferente/i);
  assert.match(text, /Ampliar cronología, impacto funcional, sueño, posibles causas médicas y evolución del contenido ideativo/i);
  assert.ok(result.warnings.includes("report_plan_enriched_from_explicit_psychiatrist_assessment"));
});
