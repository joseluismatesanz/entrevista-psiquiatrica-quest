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

test("V0.6 postproceso: supervisar la medicación no se convierte en situación sociofamiliar", () => {
  const fixture = assessmentFixture();
  fixture.sections.situacion_sociofamiliar = {
    text: "La madre refiere supervisar que toma toda la medicación.",
    evidence_status: "supported",
    source_ids: ["mother"],
  };

  const result = applyClinicalPostprocessing(
    fixture,
    "MADRE: Yo me aseguraré de que tome la medicación que acaba de indicar.",
  );

  const section = result.assessment.sections.situacion_sociofamiliar;
  assert.equal(section.text, "");
  assert.equal(section.evidence_status, "insufficient");
  assert.deepEqual(section.source_ids, []);
  assert.ok(result.warnings.includes("sociofamily_medication_supervision_pruned_postprocess"));
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


test("V0.6 medicación: la medicación que la madre toma para sí no se atribuye a la paciente", () => {
  const fixture = assessmentFixture();
  const lorazepam = med("Lorazepam", "Lorazepam", "active", "", "");
  const sertralinaHabitual = med("Sertralina", "Sertralina", "active", "", "");
  lorazepam.source_ids = ["mother"];
  sertralinaHabitual.source_ids = ["mother"];

  const sertralinaActual = med("Sertralina", "Sertralina", "active", "50 mg", "por la mañana");
  const rivotril = med("Rivotril", "Clonazepam (Rivotril)", "active", "0,5 mg", "a demanda");
  const mirtazapina = med("Mirtazapina", "Mirtazapina", "active", "15 mg", "por la noche");
  sertralinaActual.source_ids = ["psychiatrist"];
  rivotril.source_ids = ["psychiatrist"];
  mirtazapina.source_ids = ["psychiatrist"];

  fixture.medications.habitual = [lorazepam, sertralinaHabitual];
  fixture.medications.current = [sertralinaActual, rivotril, mirtazapina];
  fixture.sections.tratamiento_habitual = { text: "Lorazepam y sertralina.", evidence_status: "supported", source_ids: ["mother"] };
  fixture.sections.tratamiento_actual = { text: "", evidence_status: "not_provided", source_ids: [] };

  const transcript = [
    "PSIQUIATRA: ¿Y tomar alguna medicación usted, señora?",
    "MADRE: ahora mismo estoy tomando lorazepam y sertralina.",
    "PSIQUIATRA: Como soy su psiquiatra, le voy a explicar cómo es el tratamiento que tiene que hacer a partir de este momento.",
    "PSIQUIATRA: La sertralina se toma por la mañana 50 miligramos.",
    "PSIQUIATRA: Rivotril, que es clonazepam, lo debe tomar cuando sienta ansiedad, de rescate, 0,5 miligramos.",
    "PSIQUIATRA: Debe tomar mirtazapina 15 miligramos antes de dormir.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.deepEqual(result.assessment.medications.habitual, []);
  assert.equal(result.assessment.sections.tratamiento_habitual.text, "");
  assert.equal(result.assessment.sections.tratamiento_habitual.evidence_status, "not_provided");
  assert.deepEqual(
    result.assessment.medications.current.map((item) => item.raw_name),
    ["Sertralina", "Rivotril", "Mirtazapina"],
  );
  assert.match(result.assessment.sections.tratamiento_actual.text, /Sertralina 50 mg/);
  assert.match(result.assessment.sections.tratamiento_actual.text, /Clonazepam \(Rivotril\) 0,5 mg/);
  assert.match(result.assessment.sections.tratamiento_actual.text, /Mirtazapina 15 mg/);
  assert.ok(result.warnings.some((warning) => warning.startsWith("medication_family_self_use_pruned_from_patient_habitual:Lorazepam")));
  assert.ok(result.warnings.some((warning) => warning.startsWith("medication_family_self_use_pruned_from_patient_habitual:Sertralina")));
  assert.equal(result.meta.medication_family_self_use_guard, true);
});


test("V0.6 medicación: una nueva pauta del psiquiatra no queda como tratamiento habitual", () => {
  const fixture = assessmentFixture();
  const rivotril = med("Rivotril", "Clonazepam (Rivotril)", "active", "0,5 mg", "a demanda");
  const mirtazapina = med("Mirtazapina", "Mirtazapina", "active", "15 mg", "por la noche");
  rivotril.source_ids = ["psychiatrist"];
  mirtazapina.source_ids = ["psychiatrist"];

  fixture.medications.habitual = [rivotril, mirtazapina];
  fixture.medications.current = [];
  fixture.sections.tratamiento_habitual = {
    text: "Clonazepam (Rivotril) 0,5 mg a demanda. Mirtazapina 15 mg por la noche.",
    evidence_status: "supported",
    source_ids: ["psychiatrist"],
  };
  fixture.sections.tratamiento_actual = { text: "", evidence_status: "not_provided", source_ids: [] };

  const transcript = [
    "PSIQUIATRA: Como soy su psiquiatra, le voy a explicar cómo es el tratamiento que tiene que hacer a partir de este momento.",
    "PSIQUIATRA: Rivotril, que es clonazepam, lo debe tomar cuando sienta ansiedad, de rescate, 0,5 miligramos.",
    "PSIQUIATRA: Debe tomar mirtazapina 15 miligramos antes de dormir.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.deepEqual(result.assessment.medications.habitual, []);
  assert.deepEqual(
    result.assessment.medications.current.map((item) => item.raw_name),
    ["Rivotril", "Mirtazapina"],
  );
  assert.equal(result.assessment.sections.tratamiento_habitual.text, "");
  assert.equal(result.assessment.sections.tratamiento_habitual.evidence_status, "not_provided");
  assert.match(result.assessment.sections.tratamiento_actual.text, /Clonazepam \(Rivotril\) 0,5 mg/);
  assert.match(result.assessment.sections.tratamiento_actual.text, /Mirtazapina 15 mg/);
  assert.ok(result.warnings.some((warning) =>
    warning.startsWith("medication_new_prescription_moved_habitual_to_current:")
    && warning.includes("Rivotril")
  ));
  assert.ok(result.warnings.some((warning) =>
    warning.startsWith("medication_new_prescription_moved_habitual_to_current:")
    && warning.includes("Mirtazapina")
  ));
  assert.equal(result.meta.medication_new_prescription_temporality_guard, true);
});


test("V0.6 medicación: una pauta nueva no hereda adherencia expresada antes de prescribirla", () => {
  const fixture = assessmentFixture();
  const sertralina = med("Sertralina", "Sertralina", "active", "50 mg", "por la mañana");
  sertralina.source_ids = ["psychiatrist"];
  sertralina.adherence_status = "good";
  sertralina.adherence_text = "La madre refiere que supervisa que tome todas las pastillas.";

  fixture.medications.habitual = [];
  fixture.medications.current = [sertralina];
  fixture.sections.tratamiento_habitual = { text: "", evidence_status: "not_provided", source_ids: [] };
  fixture.sections.tratamiento_actual = {
    text: "Sertralina 50 mg por la mañana. Adherencia: La madre refiere que supervisa que tome todas las pastillas.",
    evidence_status: "supported",
    source_ids: ["mother", "psychiatrist"],
  };

  const transcript = [
    "MADRE: Sí, sí, yo le miro que se tome todas las pastillas.",
    "PSIQUIATRA: Como soy su psiquiatra, le voy a explicar cómo es el tratamiento que tiene que hacer a partir de este momento.",
    "PSIQUIATRA: La sertralina se toma por la mañana 50 miligramos.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);

  const medActual = result.assessment.medications.current[0];
  assert.equal(medActual.adherence_status, "unknown");
  assert.equal(medActual.adherence_text, "");
  assert.doesNotMatch(result.assessment.sections.tratamiento_actual.text, /Adherencia:/i);
  assert.ok(result.warnings.some((warning) =>
    warning.startsWith("medication_new_prescription_adherence_cleared:Sertralina")
  ));
  assert.equal(result.meta.medication_new_prescription_adherence_guard, true);
});

test("V0.6 medicación: la pregunta a la madre prevalece si su respuesta fue etiquetada como paciente", () => {
  const fixture = assessmentFixture();
  const lorazepam = med("azepam", "azepam (no encontrada correspondencia en CIMA)", "active", "", "");
  const sertralinaHabitual = med("Sertralina", "Sertralina", "active", "", "");
  lorazepam.adherence_status = "good";
  lorazepam.adherence_text = "La madre refiere supervisar que tome todas las pastillas.";
  sertralinaHabitual.adherence_status = "good";
  sertralinaHabitual.adherence_text = "La madre refiere supervisar que tome todas las pastillas.";

  fixture.medications.habitual = [lorazepam, sertralinaHabitual];
  fixture.sections.tratamiento_habitual = {
    text: "azepam. Adherencia: la madre refiere supervisar que tome todas las pastillas. Sertralina.",
    evidence_status: "supported",
    source_ids: ["patient"],
  };

  const transcript = [
    "PSIQUIATRA: ¿Y toma alguna medicación usted, señora?",
    "PACIENTE: Ahora mismo estoy tomando lorazepam y sertralina.",
    "PSIQUIATRA: Como soy su psiquiatra, le voy a explicar cómo es el tratamiento que tiene que hacer a partir de este momento.",
    "PSIQUIATRA: La sertralina se toma por la mañana 50 miligramos.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.deepEqual(result.assessment.medications.habitual, []);
  assert.equal(result.assessment.sections.tratamiento_habitual.text, "");
  assert.equal(result.assessment.sections.tratamiento_habitual.evidence_status, "not_provided");
  assert.deepEqual(result.assessment.sections.tratamiento_habitual.source_ids, []);
  assert.equal(result.meta.medication_habitual_preexisting_evidence_guard, true);
});

test("V0.6 medicación: una respuesta elíptica a la pregunta dirigida a la madre sigue siendo medicación de la madre", () => {
  const fixture = assessmentFixture();
  const lorazepam = med("Lorazepam", "Lorazepam", "active", "", "");
  const sertralinaHabitual = med("Sertralina", "Sertralina", "active", "", "");
  lorazepam.adherence_status = "good";
  lorazepam.adherence_text = "La madre refiere supervisar que toma todas las pastillas.";
  sertralinaHabitual.adherence_status = "good";
  sertralinaHabitual.adherence_text = "La madre refiere supervisar que toma todas las pastillas.";

  fixture.medications.habitual = [lorazepam, sertralinaHabitual];
  fixture.sections.tratamiento_habitual = {
    text: "Lorazepam. Adherencia: La madre refiere supervisar que toma todas las pastillas. Sertralina. Adherencia: La madre refiere supervisar que toma todas las pastillas.",
    evidence_status: "supported",
    source_ids: ["mother"],
  };

  const transcript = [
    "PSIQUIATRA: ¿Y toma alguna medicación usted, señora?",
    "MADRE: La medicación que toma ahora mismo es lorazepam y sertralina.",
    "PSIQUIATRA: Como soy su psiquiatra, le voy a explicar el tratamiento que tiene que hacer a partir de este momento.",
    "PSIQUIATRA: La sertralina se toma por la mañana, 50 miligramos.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.deepEqual(result.assessment.medications.habitual, []);
  assert.equal(result.assessment.sections.tratamiento_habitual.text, "");
  assert.equal(result.assessment.sections.tratamiento_habitual.evidence_status, "not_provided");
  assert.deepEqual(result.assessment.sections.tratamiento_habitual.source_ids, []);
  assert.ok(result.warnings.some((warning) =>
    warning.startsWith("medication_family_self_use_pruned_from_patient_habitual:")
  ));
});

test("V0.6 medicación: 'usted' mantiene el turno de la madre aunque la respuesta se etiquete como paciente", () => {
  const fixture = assessmentFixture();
  const lorazepam = med("Lorazepam", "Lorazepam", "active", "", "");
  const sertralinaHabitual = med("Sertralina", "Sertralina", "active", "", "");
  lorazepam.adherence_status = "good";
  lorazepam.adherence_text = "La madre supervisa que tome todas las pastillas.";
  sertralinaHabitual.adherence_status = "good";
  sertralinaHabitual.adherence_text = "La madre supervisa que tome todas las pastillas.";

  fixture.medications.habitual = [lorazepam, sertralinaHabitual];
  fixture.sections.tratamiento_habitual = {
    text: "Lorazepam. Adherencia: La madre supervisa que tome todas las pastillas. Sertralina. Adherencia: La madre supervisa que tome todas las pastillas.",
    evidence_status: "supported",
    source_ids: ["patient", "mother"],
  };

  const transcript = [
    "MADRE: La veo muy agobiada y duerme mal.",
    "PSIQUIATRA: ¿Y toma alguna medicación usted?",
    "PACIENTE: La medicación que toma ahora mismo es lorazepam y sertralina.",
    "PSIQUIATRA: Como soy su psiquiatra, le explico el tratamiento a partir de este momento.",
    "PSIQUIATRA: Sertralina 50 miligramos por la mañana.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.deepEqual(result.assessment.medications.habitual, []);
  assert.equal(result.assessment.sections.tratamiento_habitual.text, "");
  assert.equal(result.assessment.sections.tratamiento_habitual.evidence_status, "not_provided");
  assert.ok(result.warnings.some((warning) =>
    warning.startsWith("medication_family_self_use_pruned_from_patient_habitual:")
  ));
});

test("V0.6 medicación: elimina un habitual activo sin evidencia previa inequívoca", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [med("Sertralina", "Sertralina", "active", "50 mg", "por la mañana")];
  fixture.sections.tratamiento_habitual = {
    text: "Sertralina 50 mg por la mañana.",
    evidence_status: "supported",
    source_ids: ["psychiatrist"],
  };

  const transcript = "PSIQUIATRA: Hoy revisaremos su evolución clínica y ampliaremos la anamnesis.";

  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.deepEqual(result.assessment.medications.habitual, []);
  assert.equal(result.assessment.sections.tratamiento_habitual.text, "");
  assert.equal(result.assessment.sections.tratamiento_habitual.evidence_status, "not_provided");
  assert.ok(result.warnings.some((warning) =>
    warning.startsWith("medication_habitual_pruned_without_preexisting_evidence:Sertralina")
  ));
});

test("V0.6 medicación: una confirmación posterior a la prescripción no convierte la pauta nueva en habitual", () => {
  const fixture = assessmentFixture();
  const sertralinaHabitual = med("Sertralina", "Sertralina", "active", "50 mg", "por la mañana");
  sertralinaHabitual.adherence_status = "good";
  sertralinaHabitual.adherence_text = "La paciente refiere que la está tomando; la madre supervisa la toma.";
  const sertralinaActual = structuredClone(sertralinaHabitual);
  sertralinaActual.source_ids = ["psychiatrist"];

  fixture.medications.habitual = [sertralinaHabitual];
  fixture.medications.current = [sertralinaActual];
  fixture.sections.tratamiento_habitual = {
    text: "Sertralina 50 mg. Adherencia: la paciente refiere que la está tomando.",
    evidence_status: "supported",
    source_ids: ["patient"],
  };

  const transcript = [
    "PSIQUIATRA: Le indico sertralina 50 miligramos por la mañana, con el desayuno.",
    "PACIENTE: De acuerdo, la estoy tomando desde ahora.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.deepEqual(result.assessment.medications.habitual, []);
  assert.equal(result.assessment.sections.tratamiento_habitual.text, "");
  assert.equal(result.assessment.sections.tratamiento_habitual.evidence_status, "not_provided");
  assert.equal(result.assessment.medications.current[0].adherence_status, "unknown");
  assert.equal(result.assessment.medications.current[0].adherence_text, "");
  assert.ok(result.warnings.some((warning) =>
    warning.startsWith("medication_new_prescription_moved_habitual_to_current:Sertralina")
  ));
});
