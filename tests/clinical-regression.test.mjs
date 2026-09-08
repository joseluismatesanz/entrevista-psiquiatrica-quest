import test from "node:test";
import assert from "node:assert/strict";
import { applyClinicalInvariants, collectClinicalInvariantViolations } from "../server/clinical-invariants.mjs";
import { renderClinicalReport } from "../server/render-report.mjs";
import { analyzeTranscript } from "../server/analyze.mjs";

function section(text = "", evidence_status = "not_provided", source_ids = []) {
  return { text, evidence_status, source_ids };
}

function med(overrides = {}) {
  return {
    raw_name: "",
    display_name: "",
    active_ingredient_known: true,
    role: "psychiatric",
    dose: "",
    schedule: "",
    route: "oral",
    prn: false,
    adherence_status: "unknown",
    adherence_text: "",
    status: "active",
    source_ids: [],
    ...overrides,
  };
}

function baseAssessment() {
  const sections = {
    motivo_consulta: section(),
    psq_guardia: section(),
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
  };

  return {
    sources: [
      { id: "pat", label: "Paciente", kind: "patient" },
      { id: "psy", label: "Psiquiatra", kind: "psychiatrist" },
      { id: "mom", label: "Madre", kind: "mother" },
      { id: "ehr", label: "Historia clínica", kind: "ehr" },
      { id: "obs", label: "Observación clínica", kind: "clinician_observation" },
    ],
    sections,
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

function setDiagnosis(a, diagnosis, cie10, dsm5, differential = []) {
  a.diagnostic_judgment = {
    primary_diagnosis: diagnosis,
    cie10_code: cie10,
    dsm5_code: dsm5,
    provisional: true,
    differential,
    basis_summary: "Juicio de trabajo sustentado por la entrevista.",
    requires_clinician_validation: true,
  };
}

test("Caso 1: motivo directo, tratamiento por líneas, NSSI no se convierte en intento y diagnóstico consistente", () => {
  const a = baseAssessment();
  a.sections.motivo_consulta = section(
    "Autolesiones mediante cortes superficiales en miembro superior e ideación autolítica reciente.",
    "supported",
    ["pat", "mom"]
  );
  a.sections.antecedentes_familiares_psiquiatricos = section(
    "Abuela materna: depresión. Tío paterno: trastorno bipolar.",
    "supported",
    ["pat"]
  );
  a.sections.enfermedad_actual = section(
    "Empeoramiento afectivo de varias semanas con autolesiones de finalidad reguladora. Conducta preparatoria reciente al abrir el cajón de medicación sin ingesta. Actualmente niega intención y plan.",
    "supported",
    ["pat", "mom"]
  );
  a.sections.intervencion = section("", "not_provided", []);
  a.sections.orientacion_diagnostica = section(
    "Texto que no debe ser la fuente canónica.",
    "supported",
    ["pat"]
  );
  setDiagnosis(a, "Episodio depresivo moderado", "F32.1", "296.22");

  a.medications.habitual = [
    med({
      raw_name: "sertralina",
      display_name: "Sertralina",
      dose: "50 mg",
      schedule: "1 - 0 - 0",
      adherence_status: "irregular",
      adherence_text: "aproximadamente 4/7 días en las últimas semanas",
      source_ids: ["pat"],
    }),
    med({
      raw_name: "melatonina",
      display_name: "Melatonina",
      dose: "3,8 mg",
      schedule: "0 - 0 - 1",
      adherence_status: "irregular",
      adherence_text: "uso irregular",
      source_ids: ["pat"],
    }),
  ];
  a.medications.current = structuredClone(a.medications.habitual);

  const { assessment } = applyClinicalInvariants(a);
  const report = renderClinicalReport(assessment);

  assert.match(report, /MOTIVO DE LA CONSULTA\nAutolesiones/);
  assert.doesNotMatch(report, /La paciente refiere/);
  assert.match(report, /Sertralina 50 mg: 1 - 0 - 0/);
  assert.match(report, /Melatonina 3,8 mg: 0 - 0 - 1/);
  assert.doesNotMatch(report, /\nINTERVENCIÓN\n/);
  assert.match(report, /JUICIO CLÍNICO: Episodio depresivo moderado\. CIE-10: F32\.1\. DSM-5: 296\.22\./);
  assert.equal(assessment.sections.psq_guardia.text, "");
  assert.deepEqual(collectClinicalInvariantViolations(assessment), []);
});

test("Caso 2: familia solo paciente, intervención explícita, contención en enfermedad actual y juicio F29", () => {
  const a = baseAssessment();
  a.sections.motivo_consulta = section(
    "Alteración conductual grave en vía pública. Sintomatología psicótica con ideación delirante persecutoria y alteraciones sensoperceptivas auditivas. Agitación psicomotriz.",
    "supported",
    ["pat", "psy"]
  );
  a.sections.antecedentes_salud_mental = section(
    "Ingreso en Unidad de Agudos en 11/2024 por episodio psicótico en contexto de cannabis y privación de sueño, comprobado en historia clínica.",
    "supported",
    ["pat", "ehr"]
  );
  a.sections.antecedentes_familiares_psiquiatricos = section(
    "Madre: depresión. Tío paterno: esquizofrenia. Padre: consumo problemático de alcohol.",
    "supported",
    ["pat"]
  );
  a.sections.enfermedad_actual = section(
    "Durante la entrevista presenta escalada de agitación tras fracaso de medidas menos restrictivas, precisando protocolo de contención mecánica, olanzapina intramuscular, monitorización y retirada posterior tras reevaluación.",
    "supported",
    ["pat", "psy", "obs"]
  );
  a.sections.intervencion = section(
    "Se plantea medicación oral; el paciente la rechaza. Se plantea ingreso en Unidad de Agudos; el paciente no acepta ingreso voluntario.",
    "supported",
    ["psy", "pat"]
  );
  a.sections.exploracion_psicopatologica = section(
    "Hipervigilante y suspicaz, con ideación persecutoria y fenómenos auditivos. Tras estabilización niega intención autolítica y heteroagresiva activa.",
    "supported",
    ["pat", "psy", "obs"]
  );
  setDiagnosis(
    a,
    "Psicosis no especificada",
    "F29",
    "298.9",
    ["Trastorno psicótico inducido por sustancias", "Recaída de trastorno psicótico primario"]
  );

  a.medications.habitual = [
    med({
      raw_name: "salbutamol",
      display_name: "Salbutamol",
      role: "organic",
      dose: "100 microgramos/inhalación",
      schedule: "2 inhalaciones a demanda",
      route: "inhalatoria",
      prn: true,
      adherence_status: "good",
      adherence_text: "buena adherencia cuando precisa",
      source_ids: ["pat"],
    }),
  ];
  a.medications.current = [
    med({
      raw_name: "olanzapina",
      display_name: "Olanzapina",
      dose: "10 mg",
      schedule: "0 - 0 - 1",
      route: "oral",
      source_ids: ["psy"],
    }),
    med({
      raw_name: "salbutamol",
      display_name: "Salbutamol",
      role: "organic",
      dose: "100 microgramos/inhalación",
      schedule: "2 inhalaciones a demanda",
      route: "inhalatoria",
      prn: true,
      adherence_status: "good",
      adherence_text: "buena adherencia cuando precisa",
      source_ids: ["pat"],
    }),
  ];

  const { assessment } = applyClinicalInvariants(a);
  const report = renderClinicalReport(assessment);

  assert.match(report, /INTERVENCIÓN\nSe plantea medicación oral/);
  assert.match(report, /ENFERMEDAD ACTUAL[\s\S]*contención mecánica/);
  assert.doesNotMatch(
    report.split("INTERVENCIÓN")[1]?.split("EXPLORACIÓN PSICOPATOLÓGICA")[0] || "",
    /contención mecánica/
  );
  assert.match(report, /Olanzapina 10 mg: 0 - 0 - 1/);
  assert.match(report, /Salbutamol 100 microgramos\/inhalación: 2 inhalaciones a demanda/);
  assert.match(report, /JUICIO CLÍNICO: Psicosis no especificada\. CIE-10: F29\. DSM-5: 298\.9\./);
  assert.match(report, /Diagnóstico diferencial: Trastorno psicótico inducido por sustancias; Recaída de trastorno psicótico primario/);
  assert.deepEqual(collectClinicalInvariantViolations(assessment), []);
});

test("Guarda clínica: conserva antecedentes familiares aportados por un informante colateral", () => {
  const a = baseAssessment();
  setDiagnosis(a, "Diagnóstico de prueba", "F99", "300.9");
  a.sections.antecedentes_familiares_psiquiatricos = section(
    "Tía paterna: trastorno bipolar.",
    "supported",
    ["mom"]
  );
  const { assessment, warnings } = applyClinicalInvariants(a);
  assert.equal(assessment.sections.antecedentes_familiares_psiquiatricos.text, "Tía paterna: trastorno bipolar.");
  assert.equal(assessment.sections.antecedentes_familiares_psiquiatricos.evidence_status, "supported");
  assert.deepEqual(assessment.sections.antecedentes_familiares_psiquiatricos.source_ids, ["mom"]);
  assert.ok(!warnings.includes("family_history_non_patient_source_removed"));
});

test("Guarda clínica: elimina MSE sustentada solo por familiar/EHR", () => {
  const a = baseAssessment();
  setDiagnosis(a, "Diagnóstico de prueba", "F99", "300.9");
  a.sections.exploracion_psicopatologica = section(
    "Autocuidado conservado. Orientada. Sin alteraciones sensoperceptivas.",
    "supported",
    ["mom", "ehr"]
  );

  const { assessment, warnings } = applyClinicalInvariants(a);
  assert.equal(assessment.sections.exploracion_psicopatologica.text, "");
  assert.equal(assessment.sections.exploracion_psicopatologica.evidence_status, "insufficient");
  assert.ok(warnings.includes("mse_without_direct_assessment_source_removed"));
  assert.ok(
    assessment.missing_or_not_explored.some((x) => x.topic === "exploracion_psicopatologica")
  );
});

test("Guarda clínica: nombre comercial se conserva cuando principio activo es desconocido", () => {
  const a = baseAssessment();
  setDiagnosis(a, "Diagnóstico de prueba", "F99", "300.9");
  a.medications.habitual = [
    med({
      raw_name: "MarcaX",
      display_name: "principio inventado",
      active_ingredient_known: false,
      source_ids: ["pat"],
    }),
  ];
  const { assessment } = applyClinicalInvariants(a);
  assert.equal(assessment.medications.habitual[0].display_name, "MarcaX");
});

test("Guarda diagnóstica: CIE-10/DSM-5 incompletos no se renderizan como juicio cerrado", () => {
  const a = baseAssessment();
  a.diagnostic_judgment.primary_diagnosis = "Psicosis no especificada";
  a.diagnostic_judgment.cie10_code = "F29";
  a.diagnostic_judgment.dsm5_code = "";
  a.sections.orientacion_diagnostica = section(
    "JUICIO CLÍNICO: Psicosis no especificada. CIE-10: F29.",
    "supported",
    ["pat", "psy"]
  );

  const { assessment, warnings } = applyClinicalInvariants(a);
  assert.equal(assessment.sections.orientacion_diagnostica.text, "");
  assert.equal(assessment.sections.orientacion_diagnostica.evidence_status, "insufficient");
  assert.ok(warnings.includes("diagnostic_codes_incomplete"));
  assert.ok(collectClinicalInvariantViolations(assessment).includes("missing_dsm5_code"));
});

test("Backend OpenAI: usa Responses + Structured Outputs + store:false", async () => {
  const a = baseAssessment();
  a.sections.motivo_consulta = section(
    "Autolesiones mediante cortes superficiales en miembro superior.",
    "supported",
    ["pat"]
  );
  // Simula una identidad alucinada por el modelo: la transcripción no la respalda.
  a.sections.psq_guardia = section("MIR MAtesanz", "supported", []);
  setDiagnosis(a, "Episodio depresivo moderado", "F32.1", "296.22");

  let captured;
  const client = {
    responses: {
      async create(params) {
        captured = params;
        return {
          status: "completed",
          output: [],
          output_text: JSON.stringify(a),
        };
      },
    },
  };

  const result = await analyzeTranscript(
    "PSIQUIATRA: ¿Qué ha ocurrido? PACIENTE: Me he hecho cortes superficiales en el antebrazo.",
    { client, model: "gpt-5.6" }
  );

  assert.equal(captured.store, false);
  assert.equal(captured.background, false);
  assert.equal(captured.text.format.type, "json_schema");
  assert.equal(captured.text.format.strict, true);
  assert.equal(captured.model, "gpt-5.6");
  assert.match(captured.input[0].content[0].text, /JSON/);
  assert.doesNotMatch(result.report, /MIR MAtesanz/);
  assert.match(result.report, /PSQ GUARDIA\nNo consta\./);
  assert.ok(result.meta.warnings.includes("psq_guardia_unsupported_identity_removed"));
  assert.match(result.report, /CIE-10: F32\.1/);
  assert.equal(result.meta.store, false);
});
