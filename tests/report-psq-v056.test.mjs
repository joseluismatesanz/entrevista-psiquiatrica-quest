import test from "node:test";
import assert from "node:assert/strict";
import { renderClinicalReport } from "../server/render-report.mjs";

function baseAssessment(psqGuardia) {
  const empty = { text: "", evidence_status: "not_provided", source_ids: [] };
  return {
    sections: {
      motivo_consulta: { text: "Nerviosismo.", evidence_status: "supported", source_ids: ["patient"] },
      psq_guardia: psqGuardia,
      alergias_ram: empty,
      antecedentes_somaticos: empty,
      antecedentes_salud_mental: empty,
      antecedentes_familiares_psiquiatricos: empty,
      situacion_sociofamiliar: empty,
      habitos_toxicos: empty,
      tratamiento_habitual: empty,
      enfermedad_actual: empty,
      intervencion: empty,
      exploracion_psicopatologica: empty,
      orientacion_diagnostica: empty,
      plan_terapeutico: empty,
      tratamiento_actual: empty,
    },
    medications: { habitual: [], current: [] },
  };
}

test("V0.5.6 informe: PSQ Guardia se omite cuando no existe identidad profesional sustentada", () => {
  const report = renderClinicalReport(baseAssessment({
    text: "",
    evidence_status: "not_provided",
    source_ids: [],
  }));

  assert.doesNotMatch(report, /PSQ GUARDIA/);
  assert.match(report, /MOTIVO DE LA CONSULTA\nNerviosismo\./);
});

test("V0.5.6 informe: PSQ Guardia se conserva cuando el profesional está identificado", () => {
  const report = renderClinicalReport(baseAssessment({
    text: "Dra. García",
    evidence_status: "supported",
    source_ids: ["psychiatrist"],
  }));

  assert.match(report, /PSQ GUARDIA\nDra\. García/);
});
