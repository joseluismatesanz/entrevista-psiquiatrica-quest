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
      motivo_consulta: section("Alteración de contenido ideativo.", "supported", ["pat"]),
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
      basis_summary: "Información insuficiente.",
      requires_clinician_validation: true,
    },
    missing_or_not_explored: [],
    conflicts: [],
    safety_review: [],
    validation: { is_draft: true, clinician_validation_required: true },
  };
}

test("Guarda sociofamiliar: conserva convivencia pero poda creencia de filiación no verificada", () => {
  const a = baseAssessment();
  a.sections.situacion_sociofamiliar = section(
    "Convive con su madre y un hermano. Refiere que su madre no es realmente su madre y que fue sustituida.",
    "supported",
    ["pat"]
  );
  a.sections.enfermedad_actual = section(
    "Refiere la creencia de que su madre habría sido sustituida.",
    "supported",
    ["pat"]
  );
  a.sections.exploracion_psicopatologica = section(
    "Contenido ideativo centrado en una posible alteración de identidad familiar, pendiente de caracterización.",
    "supported",
    ["pat", "psy"]
  );

  const { assessment, warnings } = applyClinicalInvariants(a);

  assert.equal(assessment.sections.situacion_sociofamiliar.text, "Convive con su madre y un hermano.");
  assert.ok(warnings.includes("sociofamily_unverified_identity_belief_pruned"));
  assert.deepEqual(collectClinicalInvariantViolations(assessment), []);
  assert.match(assessment.sections.enfermedad_actual.text, /sustituida/i);
});

test("Guarda sociofamiliar: no elimina una adopción documentada como hecho", () => {
  const a = baseAssessment();
  a.sections.situacion_sociofamiliar = section(
    "Adoptada a los 3 años. Convive con sus padres adoptivos y mantiene buena relación con ambos.",
    "supported",
    ["pat", "mom"]
  );

  const { assessment, warnings } = applyClinicalInvariants(a);

  assert.match(assessment.sections.situacion_sociofamiliar.text, /Adoptada a los 3 años/);
  assert.match(assessment.sections.situacion_sociofamiliar.text, /padres adoptivos/);
  assert.ok(!warnings.includes("sociofamily_unverified_identity_belief_pruned"));
  assert.deepEqual(collectClinicalInvariantViolations(assessment), []);
});
