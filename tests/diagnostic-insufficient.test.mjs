import test from "node:test";
import assert from "node:assert/strict";
import { applyClinicalInvariants, collectClinicalInvariantViolations } from "../server/clinical-invariants.mjs";
import { renderClinicalReport } from "../server/render-report.mjs";

function section(text = "", evidence_status = "not_provided", source_ids = []) {
  return { text, evidence_status, source_ids };
}

function minimalAssessment() {
  return {
    sources: [
      { id: "pat", label: "Paciente", kind: "patient" },
      { id: "psy", label: "Psiquiatra", kind: "psychiatrist" },
    ],
    sections: {
      motivo_consulta: section("Autolesiones mediante cortes superficiales en antebrazo.", "supported", ["pat"]),
      psq_guardia: section("incorrecto", "supported", ["psy"]),
      alergias_ram: section("", "not_explored", []),
      antecedentes_somaticos: section("", "not_explored", []),
      antecedentes_salud_mental: section("", "insufficient", []),
      antecedentes_familiares_psiquiatricos: section("", "not_explored", []),
      situacion_sociofamiliar: section("", "insufficient", []),
      habitos_toxicos: section("", "not_explored", []),
      tratamiento_habitual: section("Sertralina 50 mg por la mañana; adherencia irregular.", "supported", ["pat"]),
      enfermedad_actual: section(
        "Autolesiones superficiales tras conflicto familiar. Niega intención suicida actual.",
        "supported",
        ["pat"]
      ),
      intervencion: section("", "not_provided", []),
      exploracion_psicopatologica: section(
        "Niega intención y plan suicida actuales.",
        "insufficient",
        ["pat", "psy"]
      ),
      orientacion_diagnostica: section("", "insufficient", []),
      plan_terapeutico: section("Mantener tratamiento y seguimiento próximo.", "supported", ["psy"]),
      tratamiento_actual: section("Sertralina 50 mg por la mañana.", "supported", ["psy"]),
    },
    medications: {
      habitual: [],
      current: [],
    },
    diagnostic_judgment: {
      primary_diagnosis: "",
      cie10_code: "",
      dsm5_code: "",
      provisional: true,
      differential: [],
      basis_summary: "Entrevista breve sin evaluación suficiente de criterios sindrómicos, duración e impacto funcional.",
      requires_clinician_validation: true,
    },
    missing_or_not_explored: [],
    conflicts: [],
    safety_review: [],
    validation: {
      is_draft: true,
      clinician_validation_required: true,
    },
  };
}

test("Diagnóstico: una entrevista insuficiente no fuerza etiqueta ni códigos", () => {
  const { assessment, warnings } = applyClinicalInvariants(minimalAssessment());
  const report = renderClinicalReport(assessment);

  assert.equal(assessment.diagnostic_judgment.primary_diagnosis, "");
  assert.equal(assessment.diagnostic_judgment.cie10_code, "");
  assert.equal(assessment.diagnostic_judgment.dsm5_code, "");
  assert.equal(assessment.sections.orientacion_diagnostica.evidence_status, "insufficient");
  assert.match(
    assessment.sections.orientacion_diagnostica.text,
    /Información insuficiente para establecer un juicio clínico diagnóstico/
  );
  assert.match(report, /ORIENTACIÓN DIAGNÓSTICA\nInformación insuficiente/);
  assert.ok(warnings.includes("diagnostic_judgment_withheld_for_insufficient_evidence"));
  assert.deepEqual(collectClinicalInvariantViolations(assessment), []);
});
