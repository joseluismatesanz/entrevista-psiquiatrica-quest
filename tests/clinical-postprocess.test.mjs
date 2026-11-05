import test from "node:test";
import assert from "node:assert/strict";
import { applyClinicalPostprocessing } from "../server/clinical-postprocess.mjs";
import { renderClinicalReport } from "../server/render-report.mjs";

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

test("V0.6 medicación: recupera la pauta previa como habitual y conserva la pauta final completa en actual", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [];
  fixture.medications.current = [
    med("Fluoxetina", "Fluoxetina", "active", "20 mg", "por la mañana y al mediodía"),
    med("Anafranil", "Clomipramina (Anafranil)", "active", "225 mg/día", "150 mg por la mañana y 75 mg en la comida"),
    med("Catapresan", "Clonidina (Catapresan)", "active", "", ""),
    med("Olanzapina", "Olanzapina", "active", "15 mg/día", "5 mg por la mañana y 10 mg por la noche"),
    med("Clonazepam", "Clonazepam", "active", "1 mg", "por la noche"),
    med("Mirtazapina", "Mirtazapina", "active", "15 mg", "por la noche"),
  ];
  fixture.sections.tratamiento_habitual = { text: "", evidence_status: "not_provided", source_ids: [] };
  fixture.sections.tratamiento_actual = {
    text: "Fluoxetina, Anafranil, Catapresan, olanzapina, clonazepam y mirtazapina.",
    evidence_status: "supported",
    source_ids: ["patient", "psychiatrist"],
  };

  const transcript = [
    "PSIQUIATRA: ¿Qué tratamiento toma habitualmente antes de venir a consulta?",
    "PACIENTE: Tomo Anafranil 225 mg al día, Catapresan, olanzapina 15 mg al día, clonazepam 1 mg por la noche y mirtazapina 15 mg por la noche.",
    "PSIQUIATRA: Vamos a introducir fluoxetina 20 mg por la mañana y 20 mg al mediodía.",
    "PSIQUIATRA: Mantenga sin cambios el resto del tratamiento que ya tomaba.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.deepEqual(
    result.assessment.medications.habitual.map((item) => item.raw_name),
    ["Anafranil", "Catapresan", "Olanzapina", "Clonazepam", "Mirtazapina"],
  );
  assert.deepEqual(
    result.assessment.medications.current.map((item) => item.raw_name),
    ["Fluoxetina", "Anafranil", "Catapresan", "Olanzapina", "Clonazepam", "Mirtazapina"],
  );
  assert.match(result.assessment.sections.tratamiento_habitual.text, /Clomipramina \(Anafranil\)/);
  assert.match(result.assessment.sections.tratamiento_habitual.text, /Clonidina \(Catapresan\)/);
  assert.match(result.assessment.sections.tratamiento_actual.text, /Fluoxetina 20 mg/);
  assert.match(result.assessment.sections.tratamiento_actual.text, /Clomipramina \(Anafranil\)/);
  assert.ok(result.warnings.some((warning) =>
    warning.startsWith("medication_preexisting_recovered_current_to_habitual:")
  ));
});

test("V0.6 medicación: conserva la foto previa y la pauta final tras retirar, modificar y añadir", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [
    med("Sertralina", "Sertralina", "active", "50 mg", "por la mañana"),
    med("Lorazepam", "Lorazepam", "active", "1 mg", "por la noche"),
  ];
  fixture.medications.current = [
    med("Sertralina", "Sertralina", "active", "100 mg", "por la mañana"),
    med("Fluoxetina", "Fluoxetina", "active", "20 mg", "al mediodía"),
  ];

  const transcript = [
    "PSIQUIATRA: ¿Qué tratamiento toma habitualmente antes de venir a consulta?",
    "PACIENTE: Tomo sertralina 50 mg por la mañana y lorazepam 1 mg por la noche.",
    "PSIQUIATRA: Desde hoy retiramos el lorazepam, subimos la sertralina a 100 mg por la mañana y añadimos fluoxetina 20 mg al mediodía.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.deepEqual(
    result.assessment.medications.habitual.map((item) => `${item.raw_name}:${item.dose}`),
    ["Sertralina:50 mg", "Lorazepam:1 mg"],
  );
  assert.deepEqual(
    result.assessment.medications.current.map((item) => `${item.raw_name}:${item.dose}`),
    ["Sertralina:100 mg", "Fluoxetina:20 mg"],
  );
});

test("V0.6 medicación: recupera fluoxetina y mirtazapina como habituales y las excluye tras sustituirlas", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [];
  fixture.medications.current = [
    med("Venlafaxina", "Venlafaxina", "active", "225 mg", "por la mañana"),
    med("de praxis", "de praxis", "active", "100 mg", "por la noche"),
    med("Rivotril", "Clonazepam (Rivotril)", "active", "0,5 mg", "a demanda"),
    med("Fluoxetina", "Fluoxetina", "active", "20 mg", "por la mañana"),
    med("Mirtazapina", "Mirtazapina", "active", "15 mg", "por la noche"),
  ];

  const transcript = [
    "PSIQUIATRA: ¿Qué tratamiento está tomando ahora mismo?",
    "PACIENTE: Tomo fluoxetina 20 mg por la mañana y mirtazapina 15 mg por la noche.",
    "PACIENTE: Sí, fluoxetina 20 mg por la mañana y mirtazapina 15 mg por la noche.",
    "PSIQUIATRA: Vamos a sustituir la fluoxetina y la mirtazapina por venlafaxina 225 mg por la mañana y de praxis 100 mg por la noche.",
    "PSIQUIATRA: Retiramos fluoxetina y mirtazapina y añadimos Rivotril 0,5 mg si lo necesita.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.deepEqual(
    result.assessment.medications.habitual.map((item) => `${item.raw_name}:${item.dose}`.toLowerCase()),
    ["fluoxetina:20 mg", "mirtazapina:15 mg"],
  );
  assert.deepEqual(
    result.assessment.medications.current.map((item) => item.raw_name),
    ["Venlafaxina", "de praxis", "Rivotril"],
  );
  assert.match(result.assessment.sections.tratamiento_habitual.text, /Fluoxetina 20 mg/i);
  assert.match(result.assessment.sections.tratamiento_habitual.text, /Mirtazapina 15 mg/i);
  assert.doesNotMatch(result.assessment.sections.tratamiento_actual.text, /Fluoxetina|Mirtazapina/);
});

test("V0.6 medicación: recupera el habitual aunque los fármacos previos ya no lleguen en ninguna lista", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [];
  fixture.medications.current = [
    med("Sertralina", "Sertralina", "active", "50 mg", "por la mañana"),
    med("de praxis", "de praxis", "active", "100 mg", "por la noche"),
    med("Clonazepam", "Clonazepam", "active", "0,5 mg", "a demanda"),
  ];
  fixture.sections.plan_terapeutico = {
    text: "Sustituir fluoxetina 20 mg por sertralina 50 mg por la mañana. Sustituir mirtazapina 15 mg nocturna por de praxis 100 mg por la noche. Añadir clonazepam 0,5 mg como rescate.",
    evidence_status: "supported",
    source_ids: ["psychiatrist"],
  };

  const transcript = [
    "PACIENTE: He repetido varias veces la medicación que tomo.",
    "PSIQUIATRA: Sustituir fluoxetina 20 mg por sertralina 50 mg por la mañana.",
    "PSIQUIATRA: Sustituir mirtazapina 15 mg nocturna por de praxis 100 mg por la noche.",
    "PSIQUIATRA: Añadir clonazepam 0,5 mg como rescate.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.deepEqual(
    result.assessment.medications.habitual.map((item) => `${item.raw_name}:${item.dose}`),
    ["fluoxetina:20 mg", "mirtazapina:15 mg"],
  );
  assert.deepEqual(
    result.assessment.medications.current.map((item) => item.raw_name),
    ["Sertralina", "de praxis", "Clonazepam"],
  );
  assert.match(result.assessment.sections.tratamiento_habitual.text, /fluoxetina 20 mg/i);
  assert.match(result.assessment.sections.tratamiento_habitual.text, /mirtazapina 15 mg/i);
});

test("V0.6 medicación: resuelve dos sustituciones encadenadas en una sola frase", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [];
  fixture.medications.current = [
    med("Venlafaxina", "Venlafaxina", "active", "225 mg", "por la mañana"),
    med("Trazodona", "Trazodona", "active", "100 mg", "por la noche"),
    med("cronacepan", "cronacepan", "active", "0,5 mg", "si precisa"),
    med("Fluoxetina", "Fluoxetina", "active", "20 mg", "por la mañana"),
    med("Mirtazapina", "Mirtazapina", "active", "15 mg", "por la noche"),
  ];
  fixture.sections.plan_terapeutico = {
    text: "Sustituir fluoxetina por venlafaxina 225 mg en una toma matutina y mirtazapina por trazodona 100 mg por la noche. Añadir cronacepan 0,5 mg si precisa.",
    evidence_status: "supported",
    source_ids: ["psychiatrist"],
  };

  const transcript = [
    "PSIQUIATRA: Sustituir fluoxetina por venlafaxina 225 mg en una toma matutina y mirtazapina por trazodona 100 mg por la noche.",
    "PSIQUIATRA: Añadir cronacepan 0,5 mg si precisa.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.deepEqual(
    result.assessment.medications.habitual.map((item) => `${item.raw_name}:${item.dose}`.toLowerCase()),
    ["fluoxetina:20 mg", "mirtazapina:15 mg"],
  );
  assert.deepEqual(
    result.assessment.medications.current.map((item) => item.raw_name),
    ["Venlafaxina", "Trazodona", "cronacepan"],
  );
});

test("V0.6 medicación: propaga el nombre confirmado por CIMA a todo el informe", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [];
  const venlafaxina = med("Ven la fascina", "Venlafaxina", "active", "225 mg", "por la mañana");
  venlafaxina.active_ingredient_known = true;
  venlafaxina.medication_verification = { status: "confirmed" };
  fixture.medications.current = [venlafaxina];
  fixture.sections.plan_terapeutico = {
    text: "Sustituir fluoxetina 20 mg por «Ven la fascina» 225 mg por la mañana.",
    evidence_status: "supported",
    source_ids: ["psychiatrist"],
  };
  fixture.sections.enfermedad_actual = {
    text: "Se acuerda iniciar ven la fascina por respuesta insuficiente al tratamiento previo.",
    evidence_status: "supported",
    source_ids: ["psychiatrist"],
  };

  const transcript = "PSIQUIATRA: Vamos a iniciar Ven la fascina 225 mg por la mañana.";
  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.match(result.assessment.sections.plan_terapeutico.text, /«Venlafaxina» 225 mg/);
  assert.match(result.assessment.sections.enfermedad_actual.text, /iniciar Venlafaxina/);
  assert.doesNotMatch(result.assessment.sections.plan_terapeutico.text, /Ven la fascina/i);
  assert.equal(result.assessment.sections.tratamiento_actual.text, "Venlafaxina 225 mg: 1 - 0 - 0");
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

test("V0.6 medicación: conserva la negación explícita de tratamiento habitual del Caso 3", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [];
  fixture.sections.tratamiento_habitual = {
    text: "",
    evidence_status: "not_explored",
    source_ids: [],
  };
  fixture.missing_or_not_explored = [{
    topic: "Tratamiento habitual",
    status: "not_explored",
    note: "No explorado.",
  }];

  const transcript = [
    "PSIQUIATRA: ¿Tomas medicación habitual?",
    "PACIENTE: No tomo ninguna medicación.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.equal(
    result.assessment.sections.tratamiento_habitual.text,
    "No toma medicación habitual.",
  );
  assert.equal(result.assessment.sections.tratamiento_habitual.evidence_status, "supported");
  assert.deepEqual(result.assessment.sections.tratamiento_habitual.source_ids, ["patient"]);
  assert.deepEqual(result.assessment.missing_or_not_explored, []);
  assert.ok(result.warnings.includes("medication_habitual_explicit_none_restored"));
  assert.equal(result.meta.medication_habitual_explicit_none_guard, true);
});

test("V0.6 medicación: negar alcohol no se interpreta como ausencia de tratamiento habitual", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [];
  fixture.sections.tratamiento_habitual = {
    text: "",
    evidence_status: "not_provided",
    source_ids: [],
  };

  const result = applyClinicalPostprocessing(fixture, "PACIENTE: No tomo alcohol.");

  assert.equal(result.assessment.sections.tratamiento_habitual.text, "");
  assert.equal(result.assessment.sections.tratamiento_habitual.evidence_status, "not_provided");
  assert.doesNotMatch(result.warnings.join("\n"), /explicit_none_restored/);
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

test("ADELANTO medicación: la lista previa confirmada por el paciente sustenta el habitual", () => {
  const fixture = assessmentFixture();
  const duloxetina = med("Duloxetina", "Duloxetina", "active", "60 mg", "1 - 0 - 0");
  const mirtazapinaActual = med("Mirtazapina", "Mirtazapina", "active", "30 mg", "0 - 0 - 1");
  const sertralina = med("Sertralina", "Sertralina", "active", "50 mg", "1 - 0 - 0");
  fixture.medications.habitual = [];
  fixture.medications.current = [duloxetina, mirtazapinaActual, sertralina];
  fixture.sections.tratamiento_habitual = { text: "", evidence_status: "not_provided", source_ids: [] };
  const transcript = [
    "PSIQUIATRA: ¿Me confirma que antes de esta consulta toma duloxetina 60 mg por la mañana, mirtazapina 15 mg por la noche y sertralina 50 mg por la mañana?",
    "PACIENTE: Sí, correcto.",
    "PSIQUIATRA: A partir de hoy vamos a aumentar la mirtazapina a 30 mg por la noche y mantenemos el resto.",
  ].join("\n");
  const result = applyClinicalPostprocessing(fixture, transcript);
  assert.deepEqual(result.assessment.medications.habitual.map((item) => item.raw_name), ["Duloxetina", "Mirtazapina", "Sertralina"]);
  assert.equal(result.assessment.medications.habitual.find((item) => item.raw_name === "Mirtazapina").dose, "15 mg");
  assert.match(result.assessment.sections.tratamiento_habitual.text, /Mirtazapina 15 mg: 0 - 0 - 1/);
  assert.match(result.assessment.sections.tratamiento_actual.text, /Mirtazapina 30 mg: 0 - 0 - 1/);
});

test("ADELANTO medicación: tratamiento actual conserva lo mantenido y excluye lo retirado", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [
    med("Duloxetina", "Duloxetina", "active", "60 mg", "1 - 0 - 0"),
    med("Sertralina", "Sertralina", "active", "50 mg", "1 - 0 - 0"),
  ];
  fixture.medications.current = [];
  const transcript = [
    "PACIENTE: Tomo duloxetina 60 mg por la mañana y sertralina 50 mg por la mañana.",
    "PSIQUIATRA: A partir de hoy retiramos la sertralina y mantenemos la duloxetina.",
  ].join("\n");
  const result = applyClinicalPostprocessing(fixture, transcript);
  assert.deepEqual(result.assessment.medications.current.map((item) => item.raw_name), ["Duloxetina"]);
  assert.doesNotMatch(result.assessment.sections.tratamiento_actual.text, /Sertralina/);
});

test("ADELANTO medicación: sustitución de toda la pauta separa vigente y revisado y normaliza horarios", () => {
  const fixture = assessmentFixture();
  const deprax = med("De Prax", "Deprax", "active", "100 mg", "antes de dormir");
  deprax.medication_verification = {
    status: "confirmed",
    queriedName: "Deprax",
    medicationAliasApplied: true,
    matchType: "product_name_exact_or_prefix",
  };
  fixture.medications.habitual = [];
  fixture.medications.current = [
    med("Duloxetina", "Duloxetina", "active", "60 mg", "por la mañana y en la comida"),
    med("Olanzapina", "Olanzapina", "active", "5 mg", "de rescate"),
    deprax,
    med("Fluoxetina", "Fluoxetina", "active", "20 mg", "por la mañana"),
    med("Mirtazapina", "Mirtazapina", "active", "15 mg", "por la noche"),
    med("Clonazepam", "Clonazepam", "active", "0,5 mg", "a demanda"),
  ];
  fixture.medications.current[1].prn = true;
  fixture.medications.current[5].prn = true;
  fixture.sections.tratamiento_habitual = {
    text: "pauta previa",
    evidence_status: "supported",
    source_ids: ["patient"],
  };
  fixture.sections.plan_terapeutico = {
    text: "Sustituir el tratamiento previo por duloxetina 60 mg por la mañana y en la comida, olanzapina 5 mg de rescate y De Prax 100 mg antes de dormir.",
    evidence_status: "supported",
    source_ids: ["psychiatrist"],
  };
  fixture.sections.tratamiento_actual = {
    text: "",
    evidence_status: "supported",
    source_ids: ["psychiatrist"],
  };

  const transcript = [
    "PSIQUIATRA: ¿Cuál es el tratamiento que está tomando ahora mismo?",
    "PACIENTE: Fluoxetina 20 mg por la mañana, mirtazapina 15 mg por la noche y clonazepam 0,5 mg a demanda.",
    "PSIQUIATRA: Vamos a sustituir el tratamiento previo por duloxetina 60 mg por la mañana y en la comida, olanzapina 5 mg de rescate y De Prax 100 mg antes de dormir.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);
  assert.deepEqual(
    result.assessment.medications.habitual.map((item) => item.raw_name),
    ["Fluoxetina", "Mirtazapina", "Clonazepam"],
  );
  assert.deepEqual(
    result.assessment.medications.current.map((item) => item.raw_name),
    ["Duloxetina", "Olanzapina", "De Prax"],
  );
  assert.match(result.assessment.sections.tratamiento_habitual.text, /Fluoxetina 20 mg: 1 - 0 - 0/);
  assert.match(result.assessment.sections.tratamiento_habitual.text, /Mirtazapina 15 mg: 0 - 0 - 1/);
  assert.match(result.assessment.sections.tratamiento_habitual.text, /Clonazepam 0,5 mg: a demanda/);
  assert.match(result.assessment.sections.tratamiento_actual.text, /Duloxetina 60 mg: 1 - 1 - 0/);
  assert.match(result.assessment.sections.tratamiento_actual.text, /Olanzapina 5 mg: a demanda/);
  assert.match(result.assessment.sections.tratamiento_actual.text, /Deprax 100 mg: 0 - 0 - 1/);
  assert.match(result.assessment.sections.plan_terapeutico.text, /Deprax 100 mg/);
  assert.doesNotMatch(result.assessment.sections.tratamiento_actual.text, /Fluoxetina|Mirtazapina|Clonazepam/);
});

test("ADELANTO medicación: una subida de dosis reconstruye vigente y revisado con pauta numérica", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [];
  fixture.medications.current = [
    med("Sertralina", "Sertralina", "active", "100 mg", "Por la mañana"),
    med("Mirtazapina", "Mirtazapina", "active", "30 mg", "Por la noche"),
  ];
  fixture.sections.tratamiento_habitual = { text: "", evidence_status: "not_provided", source_ids: [] };
  fixture.sections.tratamiento_actual = { text: "", evidence_status: "supported", source_ids: ["psychiatrist"] };

  const transcript = [
    "PSIQUIATRA: Buenas noches, mi nombre es XXXXXXXXXXX, soy psiquiatra y voy a valorar toda la información médica que tiene.",
    "PSIQUIATRA: Vamos a aumentar sertralina de 50 a 100 mg por la mañana y mirtazapina de 15 a 30 mg por la noche.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);
  assert.match(result.assessment.sections.tratamiento_habitual.text, /Sertralina 50 mg: 1 - 0 - 0/);
  assert.match(result.assessment.sections.tratamiento_habitual.text, /Mirtazapina 15 mg: 0 - 0 - 1/);
  assert.match(result.assessment.sections.tratamiento_actual.text, /Sertralina 100 mg: 1 - 0 - 0/);
  assert.match(result.assessment.sections.tratamiento_actual.text, /Mirtazapina 30 mg: 0 - 0 - 1/);
});

test("ADELANTO medicación: una pauta previa omitida por el modelo se recupera y se mantiene en ambas listas", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [];
  fixture.medications.current = [];
  fixture.sections.tratamiento_habitual = { text: "", evidence_status: "not_provided", source_ids: [] };
  fixture.sections.tratamiento_actual = { text: "", evidence_status: "not_provided", source_ids: [] };

  const transcript = [
    "PSIQUIATRA: ¿Qué tratamiento está tomando ahora mismo?",
    "PACIENTE: Tomo fluoxetina 20 mg por la mañana.",
    "PSIQUIATRA: A partir de hoy mantenemos la fluoxetina sin cambios.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);
  assert.match(result.assessment.sections.tratamiento_habitual.text, /Fluoxetina 20 mg: 1 - 0 - 0/);
  assert.match(result.assessment.sections.tratamiento_actual.text, /Fluoxetina 20 mg: 1 - 0 - 0/);
});

test("ADELANTO medicación: recupera el tratamiento vigente con etiquetas de hablante en formato mixto", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [];
  fixture.medications.current = [med("Fluoxetina", "Fluoxetina", "active", "20 mg", "1 - 0 - 0")];
  fixture.sections.tratamiento_habitual = { text: "No consta.", evidence_status: "not_provided", source_ids: [] };
  fixture.sections.tratamiento_actual = { text: "", evidence_status: "supported", source_ids: ["psychiatrist"] };

  const transcript = [
    "Psiquiatra: ¿Qué medicación está tomando ahora?",
    "Paciente: Tomo fluoxetina 20 mg por la mañana.",
    "Psiquiatra: Vamos a mantener fluoxetina sin cambios.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);
  assert.match(result.assessment.sections.tratamiento_habitual.text, /Fluoxetina 20 mg: 1 - 0 - 0/);
  assert.match(result.assessment.sections.tratamiento_actual.text, /Fluoxetina 20 mg: 1 - 0 - 0/);
});

test("ADELANTO medicación: excluye marcadores ininteligibles de la pauta confirmada y los señala para revisión", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [];
  fixture.medications.current = [
    med("Sertralina", "Sertralina", "active", "50 mg", "1 - 0 - 0"),
    med("[UBICACIÓN]", "[UBICACIÓN]", "active", "15 mg", "0 - 0 - 1"),
  ];
  fixture.sections.tratamiento_habitual = { text: "", evidence_status: "not_provided", source_ids: [] };
  fixture.sections.tratamiento_actual = { text: "[UBICACIÓN] 15 mg: 0 - 0 - 1", evidence_status: "supported", source_ids: ["psychiatrist"] };

  const { assessment: result } = applyClinicalPostprocessing(fixture, "PSIQUIATRA: Voy a pautar sertralina 50 mg por la mañana.");
  const report = renderClinicalReport(result);
  const revised = report.split("TRATAMIENTO REVISADO\n")[1];
  assert.deepEqual(result.medications.current.map((item) => item.raw_name), ["Sertralina"]);
  assert.match(revised, /Sertralina 50 mg: 1 - 0 - 0/);
  assert.match(revised, /nombre ininteligible; se excluye de la pauta confirmada/);
  assert.doesNotMatch(revised, /\[UBICACIÓN\]/);
});

test("ADELANTO medicación: no confirma como revisada la lista del modelo si la entrevista no indica pauta posterior", () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [];
  fixture.medications.current = [
    med("Sertralina", "Sertralina", "active", "50 mg", "1 - 0 - 0"),
    med("Fluoxetina", "Fluoxetina", "active", "40 mg", "1 - 0 - 0"),
    med("Lorazepam", "Lorazepam", "active", "2 mg", "0 - 0 - 1"),
  ];
  const transcript = [
    "PSIQUIATRA: ¿Qué medicación está tomando antes de esta consulta?",
    "PACIENTE: Tomo sertralina 50 mg, fluoxetina 40 mg y lorazepam 2 mg por la noche.",
    "PSIQUIATRA: Vamos a mantener observación y valorar cómo evoluciona.",
  ].join("\n");

  const result = applyClinicalPostprocessing(fixture, transcript);

  assert.deepEqual(result.assessment.medications.habitual.map((item) => item.raw_name), [
    "Sertralina", "Fluoxetina", "Lorazepam",
  ]);
  assert.deepEqual(result.assessment.medications.current, []);
  assert.ok(result.assessment.safety_review.some((item) =>
    item.topic === "medication_safety:revised_regimen_unconfirmed"
  ));
});

const clinicianHistoryTranscript = [
  'PSIQUIATRA: Buenas tardes. Vamos a hacer una revaluación de los tratamientos farmacológicos que tiene,',
  'PSIQUIATRA: dado que este es el concepto de la consulta. El motivo de la consulta es revaluación del tratamiento farmacológico que tiene en este momento.',
  'PSIQUIATRA: El informe dice que no tiene ningún tipo de alergia ni a los medicamentos ni a los alimentos,',
  'PSIQUIATRA: que no tiene ninguna enfermedad, tampoco tiene historia en salud mental.',
  'PSIQUIATRA: Su mujer trabaja, igual que usted,',
  'PSIQUIATRA: como médicos de atención primaria,',
  'PSIQUIATRA: no tienen hijos,',
  'PSIQUIATRA: no bebe alcohol ni fuma.',
  'PSIQUIATRA: El tratamiento que tiene ahora puesto lo ha puesto su médico de familia y es el siguiente.',
  'PSIQUIATRA: Dos fluoxetina de 40 miligramos por la mañana y una...',
  'INTERLOCUTOR_NO_IDENTIFICADO: de 15 mg por la noche.',
  'PSIQUIATRA: Esta medicación es algo excesiva y vamos a cambiarlo por fluoxetina de 20 mg media por la mañana y por la noche vamos a cambiar a lorazepam de 2 mg.',
  'INTERLOCUTOR_NO_IDENTIFICADO: Muchas gracias.',
].join('\n');

test('ADELANTO: recupera la pauta de AP narrada por el psiquiatra antes del cambio y preserva cantidades', () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [];
  fixture.sections.tratamiento_habitual.text = 'No consta.';
  fixture.medications.current = [
    med('Fluoxetina', 'Fluoxetina', 'active', '20 mg', '0,5 - 0 - 0'),
    med('Lorazepam', 'Lorazepam', 'active', '2 mg', '0 - 0 - 1'),
  ];
  const { assessment } = applyClinicalPostprocessing(fixture, clinicianHistoryTranscript);
  assert.deepEqual(assessment.medications.habitual.map(({raw_name, dose, schedule}) => ({raw_name, dose, schedule})), [
    {raw_name: 'Fluoxetina', dose: '40 mg', schedule: '2 - 0 - 0'},
  ]);
  assert.deepEqual(assessment.medications.current.map(({raw_name, dose, schedule}) => ({raw_name, dose, schedule})), [
    {raw_name: 'Fluoxetina', dose: '20 mg', schedule: '0,5 - 0 - 0'},
    {raw_name: 'Lorazepam', dose: '2 mg', schedule: '0 - 0 - 1'},
  ]);
  const report = renderClinicalReport(assessment);
  const prior = report.split('TRATAMIENTO VIGENTE\n')[1].split('ENFERMEDAD ACTUAL')[0];
  assert.match(prior, /Fluoxetina 40 mg: 2 - 0 - 0/);
  assert.match(prior, /15 mg por la noche.*no consta su nombre/);
  assert.doesNotMatch(prior, /Lorazepam|20 mg/);
});

test('ADELANTO: una pregunta del profesional sin respuesta no confirma una pauta previa', () => {
  const fixture = assessmentFixture();
  fixture.medications.habitual = [];
  fixture.medications.current = [med('Fluoxetina', 'Fluoxetina', 'active', '20 mg', '1 - 0 - 0')];
  const { assessment } = applyClinicalPostprocessing(fixture, [
    'PSIQUIATRA: ¿El tratamiento que tiene ahora es fluoxetina 40 mg por la mañana?',
    'PSIQUIATRA: Vamos a iniciar fluoxetina 20 mg por la mañana.',
  ].join('\n'));
  assert.deepEqual(assessment.medications.habitual, []);
  assert.equal(assessment.medications.current[0].dose, '20 mg');
});
