import test from "node:test";
import assert from "node:assert/strict";
import { applyClinicalInvariants, collectClinicalInvariantViolations } from "../server/clinical-invariants.mjs";

function section(text = "", evidence_status = "not_provided", source_ids = []) {
  return { text, evidence_status, source_ids };
}

function baseAssessment() {
  return {
    sources: [
      { id: "pat", label: "Paciente", kind: "patient" },
      { id: "psy", label: "Psiquiatra", kind: "psychiatrist" },
      { id: "mom", label: "Madre", kind: "mother" },
      { id: "obs", label: "Observación clínica", kind: "clinician_observation" },
    ],
    sections: {
      motivo_consulta: section(),
      psq_guardia: section("incorrecto", "supported", ["psy"]),
      alergias_ram: section(),
      antecedentes_somaticos: section(),
      antecedentes_salud_mental: section(),
      antecedentes_familiares_psiquiatricos: section(),
      situacion_sociofamiliar: section(),
      habitos_toxicos: section(),
      tratamiento_habitual: section(),
      enfermedad_actual: section(),
      intervencion: section(),
      exploracion_psicopatologica: section(),
      orientacion_diagnostica: section(),
      plan_terapeutico: section(),
      tratamiento_actual: section(),
    },
    medications: { habitual: [], current: [] },
    diagnostic_judgment: {
      primary_diagnosis: "",
      cie10_code: "",
      dsm5_code: "",
      provisional: true,
      differential: [],
      basis_summary: "",
      requires_clinician_validation: true,
    },
    missing_or_not_explored: [],
    conflicts: [],
    safety_review: [],
    validation: { is_draft: true, clinician_validation_required: true },
  };
}

test("V0.5.4 sociofamiliar: presencia de la madre en Urgencias no se convierte en dato sociofamiliar", () => {
  const a = baseAssessment();
  a.sections.situacion_sociofamiliar = section(
    "La madre participa en la valoración y acompaña a la paciente en Urgencias. Vive con su madre y su hermano menor.",
    "supported",
    ["pat", "mom"]
  );

  const { assessment, warnings } = applyClinicalInvariants(a);
  assert.equal(assessment.sections.situacion_sociofamiliar.text, "Vive con su madre y su hermano menor.");
  assert.ok(warnings.includes("sociofamily_encounter_presence_pruned"));
  assert.ok(!collectClinicalInvariantViolations(assessment).includes("sociofamily_contains_encounter_presence_only"));
});

test("V0.5.4 MSE: síntoma referido no puede convertirse en agitación objetiva", () => {
  const a = baseAssessment();
  a.sections.exploracion_psicopatologica = section(
    "Agitación objetiva durante la entrevista. Refiere insomnio de conciliación.",
    "supported",
    ["pat", "psy"]
  );

  const { assessment, warnings } = applyClinicalInvariants(a);
  assert.equal(assessment.sections.exploracion_psicopatologica.text, "Refiere insomnio de conciliación.");
  assert.ok(warnings.includes("mse_unsupported_objective_observation_pruned"));
  assert.ok(!collectClinicalInvariantViolations(assessment).includes("mse_contains_unsupported_objective_observation"));
});

test("V0.5.4 MSE: observación objetiva explícita se conserva cuando existe fuente clinician_observation", () => {
  const a = baseAssessment();
  a.sections.exploracion_psicopatologica = section(
    "Se observa inquietud psicomotriz durante la entrevista. Refiere insomnio.",
    "supported",
    ["pat", "obs"]
  );

  const { assessment, warnings } = applyClinicalInvariants(a);
  assert.match(assessment.sections.exploracion_psicopatologica.text, /Se observa inquietud psicomotriz/);
  assert.ok(!warnings.includes("mse_unsupported_objective_observation_pruned"));
  assert.ok(!collectClinicalInvariantViolations(assessment).includes("mse_contains_unsupported_objective_observation"));
});
