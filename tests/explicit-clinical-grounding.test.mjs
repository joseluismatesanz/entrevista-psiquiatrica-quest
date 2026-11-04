import test from "node:test";
import assert from "node:assert/strict";
import { groundExplicitClinicalFacts } from "../server/explicit-clinical-grounding.mjs";
import { applyClinicalInvariants } from "../server/clinical-invariants.mjs";
import { analyzeTranscript } from "../server/analyze.mjs";

function section(text = "", evidence_status = "not_provided", source_ids = []) {
  return { text, evidence_status, source_ids };
}

function fixture() {
  return {
    sources: [
      { id: "pat", label: "Paciente", kind: "patient" },
      { id: "psy", label: "Psiquiatra", kind: "psychiatrist" },
    ],
    sections: {
      motivo_consulta: section(), psq_guardia: section(), alergias_ram: section(),
      antecedentes_somaticos: section(),
      antecedentes_salud_mental: section("Seguimiento por anorexia nerviosa.", "supported", ["pat"]),
      antecedentes_familiares_psiquiatricos: section(), situacion_sociofamiliar: section(),
      habitos_toxicos: section("", "insufficient"), tratamiento_habitual: section(),
      enfermedad_actual: section("", "insufficient"), intervencion: section(),
      exploracion_psicopatologica: section(), orientacion_diagnostica: section("", "insufficient"),
      plan_terapeutico: section(), tratamiento_actual: section(),
    },
    medications: { habitual: [], current: [] },
    diagnostic_judgment: {
      primary_diagnosis: "", cie10_code: "", dsm5_code: "", provisional: true,
      differential: [], basis_summary: "", requires_clinician_validation: true,
    },
    missing_or_not_explored: [], conflicts: [], safety_review: [],
    validation: { is_draft: true, clinician_validation_required: true },
  };
}

test("ADELANTO: conserva anorexia nerviosa expresamente establecida y la codifica", () => {
  const transcript = "PSIQUIATRA: Consta diagnóstico de anorexia nerviosa, actualmente en remisión.\nPACIENTE: Sí.";
  const grounded = groundExplicitClinicalFacts(fixture(), transcript);
  const result = applyClinicalInvariants(grounded.assessment);
  assert.equal(result.assessment.diagnostic_judgment.primary_diagnosis, "Anorexia nerviosa, en remisión");
  assert.equal(result.assessment.diagnostic_judgment.cie10_code, "F50.00");
  assert.equal(result.assessment.diagnostic_judgment.dsm5_code, "307.1");
  assert.match(result.assessment.sections.orientacion_diagnostica.text, /Anorexia nerviosa, en remisión/);
});

test("ADELANTO: no convierte una sospecha diagnóstica en diagnóstico confirmado", () => {
  const grounded = groundExplicitClinicalFacts(fixture(), "PSIQUIATRA: Hay que descartar una posible anorexia nerviosa.");
  assert.equal(grounded.assessment.diagnostic_judgment.primary_diagnosis, "");
});

test("ADELANTO: un TDAH previo explícito se lleva a orientación con código DSM-5-TR", () => {
  const input = fixture();
  const transcript = "PSIQUIATRA: Consta entre sus diagnósticos previos de TDAH y trastorno negativista desafiante.";
  const grounded = groundExplicitClinicalFacts(input, transcript).assessment;
  const result = applyClinicalInvariants(grounded).assessment;
  assert.match(result.sections.orientacion_diagnostica.text, /Trastorno por déficit de atención e hiperactividad/);
  assert.match(result.sections.orientacion_diagnostica.text, /DSM-5: 314\.01/);
});

test("ADELANTO: recupera hábitos tóxicos negados explícitamente", () => {
  const grounded = groundExplicitClinicalFacts(fixture(), "PACIENTE: No fumo, no consumo alcohol y no consumo ninguna otra sustancia.");
  assert.equal(grounded.assessment.sections.habitos_toxicos.evidence_status, "supported");
  assert.match(grounded.assessment.sections.habitos_toxicos.text, /tabaco, alcohol y otras sustancias/);
});

test("ADELANTO: una consulta por cambio farmacológico no deja motivo ni enfermedad actual vacíos", () => {
  const grounded = groundExplicitClinicalFacts(fixture(), "PACIENTE: He venido para cambiar el tratamiento farmacológico porque no me encuentro bien.");
  assert.equal(grounded.assessment.sections.motivo_consulta.evidence_status, "supported");
  assert.equal(grounded.assessment.sections.enfermedad_actual.evidence_status, "supported");
});

test("ADELANTO integración: corrige el borrador incompleto en el flujo completo", async () => {
  const modelOutput = fixture();
  const medication = (raw_name, dose, schedule) => ({
    raw_name, display_name: raw_name, active_ingredient_known: true, role: "psychiatric",
    dose, schedule, route: "oral", prn: false, adherence_status: "unknown",
    adherence_text: "", status: "active", source_ids: ["psy"],
  });
  modelOutput.medications.current = [
    medication("Duloxetina", "60 mg", "1 - 0 - 0"),
    medication("Mirtazapina", "30 mg", "0 - 0 - 1"),
    medication("Sertralina", "50 mg", "1 - 0 - 0"),
  ];
  const client = { responses: { async create() { return { status: "completed", output: [], output_text: JSON.stringify(modelOutput) }; } } };
  const transcript = [
    "PSIQUIATRA: Consta diagnóstico de anorexia nerviosa, actualmente en remisión.",
    "PACIENTE: He venido para cambiar el tratamiento farmacológico porque no me encuentro bien.",
    "PACIENTE: No fumo, no consumo alcohol y no consumo ninguna otra sustancia.",
    "PSIQUIATRA: ¿Me confirma que antes de esta consulta toma duloxetina 60 mg por la mañana, mirtazapina 15 mg por la noche y sertralina 50 mg por la mañana?",
    "PACIENTE: Sí, correcto.",
    "PSIQUIATRA: A partir de hoy vamos a aumentar la mirtazapina a 30 mg por la noche y mantenemos el resto.",
  ].join("\n");
  const result = await analyzeTranscript(transcript, { client, model: "test-model" });
  assert.match(result.report, /TRATAMIENTO VIGENTE[\s\S]*Mirtazapina 15 mg: 0 - 0 - 1/);
  assert.match(result.report, /TRATAMIENTO REVISADO[\s\S]*Mirtazapina 30 mg: 0 - 0 - 1/);
  assert.match(result.report, /ORIENTACIÓN DIAGNÓSTICA[\s\S]*Anorexia nerviosa, en remisión/);
  assert.match(result.report, /HÁBITOS TÓXICOS[\s\S]*tabaco, alcohol y otras sustancias/);
  assert.match(result.report, /ENFERMEDAD ACTUAL[\s\S]*modificación del tratamiento farmacológico/);
});

test("ADELANTO integración: corrige el caso real de aumento de sertralina y mirtazapina", async () => {
  const modelOutput = fixture();
  const medication = (raw_name, dose, schedule) => ({
    raw_name, display_name: raw_name, active_ingredient_known: true, role: "psychiatric",
    dose, schedule, route: "oral", prn: false, adherence_status: "unknown",
    adherence_text: "", status: "active", source_ids: ["psy"],
  });
  modelOutput.medications.current = [
    medication("Sertralina", "100 mg", "Por la mañana"),
    medication("Mirtazapina", "30 mg", "Por la noche"),
  ];
  modelOutput.sections.plan_terapeutico = section(
    "Aumentar sertralina a 100 mg por la mañana y mirtazapina a 30 mg por la noche. Buenas noches, mi nombre es XXXXXXXXXXX, soy psiquiatra y voy a valorar toda la información médica que tiene.",
    "supported",
    ["psy"],
  );
  modelOutput.sections.tratamiento_actual = section("Sertralina y mirtazapina.", "supported", ["psy"]);
  const client = { responses: { async create() { return { status: "completed", output: [], output_text: JSON.stringify(modelOutput) }; } } };
  const transcript = [
    "PSIQUIATRA: Buenas noches, mi nombre es XXXXXXXXXXX, soy psiquiatra y voy a valorar toda la información médica que tiene.",
    "PACIENTE: Acudo para adaptar el tratamiento antidepresivo.",
    "PSIQUIATRA: Vamos a aumentar sertralina de 50 a 100 mg por la mañana y mirtazapina de 15 a 30 mg por la noche.",
  ].join("\n");

  const result = await analyzeTranscript(transcript, { client, model: "test-model" });
  const vigente = result.report.split("TRATAMIENTO VIGENTE\n")[1].split("\n\nENFERMEDAD ACTUAL")[0];
  const revisado = result.report.split("TRATAMIENTO REVISADO\n")[1];
  const plan = result.report.split("PLAN TERAPÉUTICO\n")[1].split("\n\nTRATAMIENTO REVISADO")[0];

  assert.match(vigente, /Sertralina 50 mg: 1 - 0 - 0/);
  assert.match(vigente, /Mirtazapina 15 mg: 0 - 0 - 1/);
  assert.match(revisado, /Sertralina 100 mg: 1 - 0 - 0/);
  assert.match(revisado, /Mirtazapina 30 mg: 0 - 0 - 1/);
  assert.doesNotMatch(plan, /buenas noches|mi nombre|soy psiquiatra|voy a valorar/i);
});

test("ADELANTO integración: separa actualización, pauta vigente, pauta revisada y evita duplicidades", async () => {
  const modelOutput = fixture();
  const medication = (raw_name, dose, schedule, source = "psy") => ({
    raw_name, display_name: raw_name, active_ingredient_known: true, role: "psychiatric",
    dose, schedule, route: "oral", prn: false, adherence_status: "unknown",
    adherence_text: "", status: "active", source_ids: [source],
  });

  modelOutput.sections.motivo_consulta = section("Adaptación de la medicación.", "supported", ["psy"]);
  modelOutput.sections.enfermedad_actual = section(
    "Acude para adaptación farmacológica. Durante la entrevista permanece vigil, orientado y centrado en la conversación, con comunicación adecuada. No presenta sintomatología psicótica, alteraciones de los biorritmos, pensamientos intrusivos de muerte, ideación o planificación autolítica ni autoagresividad. Se aprecia poca conciencia de enfermedad y cierto desbordamiento vital. Se decide sustituir el tratamiento previo y mantener observación hasta el día siguiente para valorar tolerancia, respuesta y evolución nocturna.",
    "supported",
    ["pat", "psy"],
  );
  modelOutput.sections.exploracion_psicopatologica = section(
    "Vigil y orientado, centrado en la conversación. Comunicación adecuada. Sin sintomatología psicótica. Biorritmos conservados. Sin pensamientos intrusivos de muerte, ideación o planificación autolítica ni autoagresividad. Poca conciencia de enfermedad y cierto desbordamiento vital.",
    "supported",
    ["pat", "psy"],
  );
  modelOutput.sections.plan_terapeutico = section(
    "Sustituir el tratamiento previo por duloxetina 60 mg por la mañana, mirtazapina 30 mg por la noche y clonazepam 0,5 mg por la mañana. Permanencia en observación hasta el día siguiente para valorar tolerancia, respuesta y evolución nocturna.",
    "supported",
    ["psy"],
  );
  modelOutput.medications.current = [
    medication("Melatonina", "1,9 mg", "0 - 0 - 1", "pat"),
    medication("Fluoxetina", "20 mg", "1 - 1 - 0", "pat"),
    medication("Lorazepam", "2 mg", "0 - 0 - 1", "pat"),
    medication("Duloxetina", "60 mg", "1 - 0 - 0"),
    medication("Mirtazapina", "30 mg", "0 - 0 - 1"),
    medication("Clonazepam (Rivotril)", "0,5 mg", "1 - 0 - 0"),
  ];

  const client = { responses: { async create() { return { status: "completed", output: [], output_text: JSON.stringify(modelOutput) }; } } };
  const transcript = [
    "PSIQUIATRA: El motivo de hoy es realizar una actualización del tratamiento farmacológico.",
    "PSIQUIATRA: Vamos a cambiar por completo el tratamiento vigente.",
    "PSIQUIATRA: ¿Qué tratamiento está tomando ahora mismo, antes del cambio?",
    "PACIENTE: Melatonina 1,9 mg por la noche, fluoxetina 20 mg por la mañana y al mediodía y lorazepam 2 mg por la noche.",
    "PSIQUIATRA: A partir de hoy tome duloxetina 60 mg por la mañana, mirtazapina 30 mg por la noche y clonazepam, Rivotril, 0,5 mg por la mañana.",
    "PSIQUIATRA: Permanecerá en observación hasta mañana para valorar tolerancia y evolución nocturna.",
    "PSIQUIATRA: Durante la entrevista permanece vigil, orientado y centrado en la conversación, con comunicación adecuada. No presenta sintomatología psicótica ni ideación autolítica. Se aprecia poca conciencia de enfermedad.",
  ].join("\n");

  const result = await analyzeTranscript(transcript, { client, model: "test-model" });
  const report = result.report;
  const vigente = report.split("TRATAMIENTO VIGENTE\n")[1].split("\n\nENFERMEDAD ACTUAL")[0];
  const enfermedad = report.split("ENFERMEDAD ACTUAL\n")[1].split("\n\nEXPLORACIÓN PSICOPATOLÓGICA")[0];
  const exploracion = report.split("EXPLORACIÓN PSICOPATOLÓGICA\n")[1].split("\n\nORIENTACIÓN DIAGNÓSTICA")[0];
  const plan = report.split("PLAN TERAPÉUTICO\n")[1].split("\n\nTRATAMIENTO REVISADO")[0];
  const revisado = report.split("TRATAMIENTO REVISADO\n")[1];

  assert.match(report, /MOTIVO DE LA CONSULTA\nActualización del tratamiento farmacológico\./);
  assert.match(vigente, /Melatonina 1,9 mg: 0 - 0 - 1/);
  assert.match(vigente, /Fluoxetina 20 mg: 1 - 1 - 0/);
  assert.match(vigente, /Lorazepam 2 mg: 0 - 0 - 1/);
  assert.doesNotMatch(vigente, /Duloxetina|Mirtazapina|Clonazepam/);

  assert.match(revisado, /Duloxetina 60 mg: 1 - 0 - 0/);
  assert.match(revisado, /Mirtazapina 30 mg: 0 - 0 - 1/);
  assert.match(revisado, /Clonazepam \(Rivotril\) 0,5 mg: 1 - 0 - 0/);
  assert.doesNotMatch(revisado, /Melatonina|Fluoxetina|Lorazepam/);

  assert.doesNotMatch(enfermedad, /vigil|orientad|psicótica|biorritmos|autolítica|conciencia de enfermedad|observación|sustituir/i);
  assert.equal((exploracion.match(/\bvigil\b/gi) || []).length, 1);
  assert.equal((exploracion.match(/\borientado\b/gi) || []).length, 1);
  assert.match(plan, /Permanencia en observación hasta el día siguiente/);
  assert.doesNotMatch(plan, /Melatonina|Fluoxetina|Lorazepam|Duloxetina|Mirtazapina|Clonazepam|\bmg\b|sustituir el tratamiento/i);
});
