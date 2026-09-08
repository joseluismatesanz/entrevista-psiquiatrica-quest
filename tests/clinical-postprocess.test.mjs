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
    sources: [
      { id: "patient", label: "Paciente", kind: "patient" },
      { id: "psychiatrist", label: "Psiquiatra", kind: "psychiatrist" },
      { id: "mother", label: "Madre", kind: "mother" },
    ],
    sections: {
      motivo_consulta: { text: "Agitación y nerviosismo subjetivos; preocupación materna no especificada.", evidence_status: "supported", source_ids: ["patient", "mother"] },
      antecedentes_salud_mental: { text: "En tratamiento psicofarmacológico habitual. Diagnóstico, evolución y antecedentes asistenciales no explorados.", evidence_status: "insufficient", source_ids: ["patient"] },
      situacion_sociofamiliar: { text: "Convive con su padre y una hermana menor. Acude acompañada por su madre.", evidence_status: "supported", source_ids: ["patient", "mother"] },
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
        topic: "Agitación actual",
        accounts: [
          { source_id: "patient", statement: "Refiere encontrarse muy agitada y nerviosa." },
          { source_id: "psychiatrist", statement: "Permanece sentada y no se objetiva inquietud motora durante la entrevista." },
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

test("V0.5.4 postproceso: no duplica la etiqueta Adherencia", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [med("Sertralina", "Sertralina", "active", "50 mg", "por la mañana")];
  fixture.medications.habitual[0].adherence_status = "unknown";
  fixture.medications.habitual[0].adherence_text = "Adherencia no explorada";
  const result = applyClinicalPostprocessing(fixture, "PACIENTE: Tomo Sertralina 50 mg por la mañana.");
  const text = result.assessment.sections.tratamiento_habitual.text;
  assert.match(text, /Adherencia: no explorada/i);
  assert.doesNotMatch(text, /Adherencia:\s*Adherencia/i);
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

test("V0.5.4 postproceso: acompañamiento en la consulta no se convierte en situación sociofamiliar", () => {
  const transcript = `PACIENTE: Vivo con mi padre y mi hermana pequeña.\nMADRE: Yo la he acompañado hoy porque estaba preocupada.`;
  const result = applyClinicalPostprocessing(assessmentFixture(), transcript);
  assert.equal(result.assessment.sections.situacion_sociofamiliar.text, "Convive con su padre y una hermana menor.");
  assert.ok(result.warnings.includes("sociofamily_encounter_accompaniment_pruned_postprocess"));
});

test("V0.5.4 postproceso: psicofármacos actuales no crean antecedentes personales en salud mental", () => {
  const transcript = `PSIQUIATRA: ¿Qué tratamiento tomas habitualmente?\nPACIENTE: Sertralina 50 mg por la mañana y Risperdal por la noche.`;
  const result = applyClinicalPostprocessing(assessmentFixture(), transcript);
  const section = result.assessment.sections.antecedentes_salud_mental;
  assert.equal(section.text, "");
  assert.equal(section.evidence_status, "not_explored");
  assert.deepEqual(section.source_ids, []);
  assert.ok(result.warnings.includes("mental_history_not_inferred_from_current_psychotropic_medication"));
});

test("V0.5.4 postproceso: antecedentes de salud mental explícitos sí se conservan", () => {
  const fixture = assessmentFixture();
  fixture.sections.antecedentes_salud_mental = {
    text: "Seguimiento en Salud Mental desde 2024 por ansiedad.",
    evidence_status: "supported",
    source_ids: ["patient"],
  };
  const transcript = `PSIQUIATRA: ¿Has tenido seguimiento previo en Salud Mental?\nPACIENTE: Sí, voy a Salud Mental desde 2024 por ansiedad.`;
  const result = applyClinicalPostprocessing(fixture, transcript);
  assert.equal(result.assessment.sections.antecedentes_salud_mental.evidence_status, "supported");
  assert.match(result.assessment.sections.antecedentes_salud_mental.text, /2024/);
});

test("V0.5.4 postproceso: motivo elimina preocupación familiar inespecífica si ya existe motivo clínico concreto", () => {
  const transcript = `PACIENTE: Estoy muy agitada y muy nerviosa.\nMADRE: Estoy preocupada.`;
  const result = applyClinicalPostprocessing(assessmentFixture(), transcript);
  assert.equal(result.assessment.sections.motivo_consulta.text, "Agitación y nerviosismo subjetivos");
  assert.ok(result.warnings.includes("generic_unspecified_family_concern_pruned_from_motive"));
});
