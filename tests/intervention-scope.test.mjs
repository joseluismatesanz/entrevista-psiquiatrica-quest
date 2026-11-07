import test from "node:test";
import assert from "node:assert/strict";
import { applyClinicalInvariants } from "../server/clinical-invariants.mjs";

function section(text = "", evidence_status = "not_provided", source_ids = []) {
  return { text, evidence_status, source_ids };
}

function assessmentWithIntervention(text) {
  return {
    sources: [
      { id: "pat", label: "Paciente", kind: "patient" },
      { id: "psy", label: "Psiquiatra", kind: "psychiatrist" },
    ],
    sections: {
      motivo_consulta: section("Alteración conductual grave.", "supported", ["pat", "psy"]),
      psq_guardia: section("MIR MAtesanz", "supported", []),
      alergias_ram: section(),
      antecedentes_somaticos: section(),
      antecedentes_salud_mental: section(),
      antecedentes_familiares_psiquiatricos: section(),
      situacion_sociofamiliar: section(),
      habitos_toxicos: section(),
      tratamiento_habitual: section(),
      enfermedad_actual: section(),
      intervencion: section(text, "supported", ["psy", "pat"]),
      exploracion_psicopatologica: section(),
      orientacion_diagnostica: section(),
      plan_terapeutico: section(),
      tratamiento_actual: section(),
    },
    medications: { habitual: [], current: [] },
    diagnostic_judgment: {
      primary_diagnosis: "Psicosis no especificada",
      cie10_code: "F29",
      dsm5_code: "298.9",
      provisional: true,
      differential: [],
      basis_summary: "Juicio de trabajo.",
      requires_clinician_validation: true,
    },
    missing_or_not_explored: [],
    conflicts: [],
    safety_review: [],
    validation: { is_draft: true, clinician_validation_required: true },
  };
}

test("INTERVENCIÓN conserva solo propuesta explícita y aceptación/rechazo", () => {
  const input = assessmentWithIntervention(
    "Se propuso medicación oral, que el paciente rechazó. Se propuso ingreso en Unidad de Agudos, inicialmente rechazado. Tras la estabilización aceptó permanecer en la unidad. Autorizó informar a su madre."
  );

  const { assessment, warnings } = applyClinicalInvariants(input);
  const text = assessment.sections.intervencion.text;

  assert.match(text, /medicación oral/);
  assert.match(text, /ingreso en Unidad de Agudos/);
  assert.doesNotMatch(text, /permanecer en la unidad/);
  assert.doesNotMatch(text, /informar a su madre/);
  assert.ok(warnings.includes("intervention_nonproposal_content_pruned"));
});
