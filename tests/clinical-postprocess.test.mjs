import test from "node:test";
import assert from "node:assert/strict";
import { applyClinicalPostprocessing } from "../server/clinical-postprocess.mjs";

function med(rawName, displayName, status = "active", dose = "", schedule = "") {
  return {
    raw_name: rawName,
    display_name: displayName,
    active_ingredient_known: displayName !== rawName,
    role: "psychiatric",
    dose,
    schedule,
    route: "oral",
    prn: false,
    adherence_status: "unknown",
    adherence_text: "",
    status,
    source_ids: ["patient"],
  };
}

function assessmentFixture() {
  return {
    sections: {
      tratamiento_habitual: { text: "Sertralina 50 mg. Risperdal por la noche. Cetralina.", evidence_status: "supported", source_ids: ["patient"] },
      tratamiento_actual: { text: "", evidence_status: "not_provided", source_ids: [] },
    },
    medications: {
      habitual: [
        med("Sertralina", "Sertralina", "active", "50 mg", "por la mañana"),
        med("Risperdal", "Risperidona (Risperdal)", "active", "", "por la noche"),
        med("Cetralina", "Cetralina (no encontrada correspondencia en CIMA)", "active", "", ""),
      ],
      current: [],
    },
    conflicts: [
      {
        topic: "Agitación subjetiva frente a psicomotricidad observada",
        accounts: [
          { source_id: "patient", statement: "Refiere estar muy agitada y nerviosa." },
          { source_id: "psychiatrist", statement: "Permanece sentada; no se objetiva inquietud motora." },
        ],
      },
    ],
  };
}

test("V0.5.4 postproceso: medicación histórica no aparece como tratamiento habitual", () => {
  const transcript = `PSIQUIATRA: ¿Qué tratamiento tomas habitualmente?\nPACIENTE: Por la mañana tomo Sertralina 50 miligramos. Por la noche tomo Risperdal, pero no recuerdo la dosis. Y alguna vez me dieron Cetralina, tampoco recuerdo cuánto.`;
  const result = applyClinicalPostprocessing(assessmentFixture(), transcript);

  const habitual = result.assessment.medications.habitual;
  assert.equal(habitual[0].status, "active");
  assert.equal(habitual[1].status, "active");
  assert.equal(habitual[2].status, "historical");
  assert.equal(habitual[2].adherence_status, "not_applicable");

  const section = result.assessment.sections.tratamiento_habitual.text;
  assert.match(section, /Sertralina 50 mg/);
  assert.match(section, /Risperidona \(Risperdal\)/);
  assert.doesNotMatch(section, /Cetralina/);
  assert.ok(result.warnings.includes("medication_temporality_corrected_to_historical:Cetralina"));
});

test("V0.5.4 postproceso: la tarjeta usa el nombre farmacológico verificado", () => {
  const transcript = `PACIENTE: Por la mañana tomo Sertralina 50 miligramos. Por la noche tomo Risperdal.`;
  const fixture = assessmentFixture();
  fixture.medications.habitual = fixture.medications.habitual.slice(0, 2);
  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.match(result.assessment.sections.tratamiento_habitual.text, /Risperidona \(Risperdal\)/);
  assert.doesNotMatch(result.assessment.sections.tratamiento_habitual.text, /^Risperdal/m);
  assert.equal(result.meta.medication_sections_synced_from_structured_entities, true);
});

test("V0.5.4 postproceso: agitación subjetiva y ausencia de inquietud motora no son discrepancia", () => {
  const transcript = `PACIENTE: Estoy muy agitada y muy nerviosa.\nPSIQUIATRA: Permanece sentada y no se objetiva inquietud motora.`;
  const result = applyClinicalPostprocessing(assessmentFixture(), transcript);

  assert.equal(result.assessment.conflicts.length, 0);
  assert.ok(result.warnings.includes("subjective_agitation_vs_observed_psychomotor_pseudoconflict_pruned"));
});

test("V0.5.4 postproceso: discrepancias clínicas reales se conservan", () => {
  const fixture = assessmentFixture();
  fixture.conflicts = [{
    topic: "Adherencia",
    accounts: [
      { source_id: "patient", statement: "Dice que toma sertralina todos los días." },
      { source_id: "mother", statement: "La madre refiere que la toma tres días por semana." },
    ],
  }];
  const result = applyClinicalPostprocessing(fixture, "PACIENTE: Tomo sertralina todos los días.\nMADRE: La toma tres días por semana.");
  assert.equal(result.assessment.conflicts.length, 1);
});
