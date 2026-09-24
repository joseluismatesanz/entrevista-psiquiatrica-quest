import test from "node:test";
import assert from "node:assert/strict";
import { groundReportContentToTranscript } from "../server/report-content-grounding.mjs";

function assessment(overrides = {}) {
  return {
    sources: [
      { id: "p", label: "Paula", kind: "patient" },
      { id: "m", label: "Madre", kind: "mother" },
      { id: "q", label: "Psiquiatra", kind: "psychiatrist" },
    ],
    sections: {
      enfermedad_actual: {
        text: "La paciente niega alucinaciones auditivas o visuales, autolesiones, ideación de muerte e intención autoagresiva o heteroagresiva.",
        evidence_status: "supported",
        source_ids: ["p", "m"],
      },
      situacion_sociofamiliar: {
        text: "Convive con su madre y un hermano menor. Escolarizada en instituto.",
        evidence_status: "supported",
        source_ids: ["p", "m"],
      },
      plan_terapeutico: {
        text: "Valoración preferente por Salud Mental Infanto-Juvenil en 24-48 horas. Vigilancia familiar hasta dicha valoración.",
        evidence_status: "supported",
        source_ids: ["q"],
      },
      ...overrides,
    },
  };
}

const CASE3 = `PSIQUIATRA: ¿Has pensado en hacerte daño, morir o hacer daño a alguien?\nPACIENTE: No. No quiero hacerme daño ni hacer daño a nadie.\nMADRE: No he visto autolesiones ni amenazas, pero está más aislada y ha faltado dos días al instituto.\nPSIQUIATRA: Con esta entrevista breve no voy a cerrar un diagnóstico. Necesitamos ampliar cronología, impacto funcional, sueño, posibles causas médicas y evolución del contenido ideativo. Propongo valoración preferente por Salud Mental Infanto-Juvenil en 24-48 horas y vigilancia familiar mientras tanto.`;

test("Informe: no atribuye a la paciente una negación formal de autolesiones si solo negó hacerse daño", () => {
  const result = groundReportContentToTranscript(assessment(), CASE3);
  const text = result.assessment.sections.enfermedad_actual.text;
  assert.doesNotMatch(text, /autolesiones/i);
  assert.match(text, /ideación de muerte/i);
  assert.ok(result.warnings.includes("report_patient_autolesion_denial_removed_without_explicit_patient_evidence"));
});

test("Informe: conserva una negación de autolesiones cuando la paciente la expresa de forma específica", () => {
  const transcript = `PSIQUIATRA: ¿Te has autolesionado?\nPACIENTE: No, no me he autolesionado ni me he cortado.`;
  const result = groundReportContentToTranscript(assessment(), transcript);
  assert.match(result.assessment.sections.enfermedad_actual.text, /autolesiones/i);
});

test("Informe: faltar al instituto no se convierte por inferencia en escolarización declarada", () => {
  const result = groundReportContentToTranscript(assessment(), CASE3);
  const text = result.assessment.sections.situacion_sociofamiliar.text;
  assert.match(text, /Convive con su madre/i);
  assert.doesNotMatch(text, /Escolarizada|instituto/i);
  assert.ok(result.warnings.includes("report_inferred_schooling_removed_without_explicit_transcript_statement"));
});

test("Informe: el plan conserva la ampliación diagnóstica explícita del psiquiatra", () => {
  const result = groundReportContentToTranscript(assessment(), CASE3);
  const text = result.assessment.sections.plan_terapeutico.text;
  assert.match(text, /Valoración preferente/i);
  assert.match(text, /Ampliar cronología, impacto funcional, sueño, posibles causas médicas y evolución del contenido ideativo/i);
  assert.ok(result.warnings.includes("report_plan_enriched_from_explicit_psychiatrist_assessment"));
});


test("V0.6 informe: elimina frases metadiscursivas de ausencia de MSE y plan", () => {
  const assessment = {
    sources: [{ id: "psy", label: "Psiquiatra", kind: "psychiatrist" }],
    sections: {
      enfermedad_actual: { text: "", evidence_status: "not_provided", source_ids: [] },
      situacion_sociofamiliar: { text: "", evidence_status: "not_provided", source_ids: [] },
      exploracion_psicopatologica: {
        text: "Se exploran nerviosismo y alteración del sueño. No se documentan otros elementos del examen psicopatológico.",
        evidence_status: "supported",
        source_ids: ["psy"],
      },
      plan_terapeutico: {
        text: "Sertralina 50 mg por la mañana. No constan indicaciones sobre ingreso, pruebas, medidas de seguridad ni intervenciones no farmacológicas.",
        evidence_status: "supported",
        source_ids: ["psy"],
      },
    },
  };

  const result = groundReportContentToTranscript(
    assessment,
    "PSIQUIATRA: Sertralina 50 mg por la mañana.",
  );

  assert.equal(
    result.assessment.sections.exploracion_psicopatologica.text,
    "Se exploran nerviosismo y alteración del sueño.",
  );
  assert.equal(
    result.assessment.sections.plan_terapeutico.text,
    "Sertralina 50 mg por la mañana.",
  );
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_mse"));
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_plan"));
});

test("V0.6 informe: elimina 'no se dispone de una exploración psicopatológica completa'", () => {
  const input = assessment({
    exploracion_psicopatologica: {
      text: "Refiere nerviosismo y agitación. Refiere dificultades para dormir. La madre observa cansancio. No se dispone de una exploración psicopatológica completa.",
      evidence_status: "supported",
      source_ids: ["p", "m"],
    },
  });

  const result = groundReportContentToTranscript(input, "PACIENTE: Estoy nerviosa y duermo mal.");

  assert.equal(
    result.assessment.sections.exploracion_psicopatologica.text,
    "Refiere nerviosismo y agitación. Refiere dificultades para dormir.",
  );
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_mse"));
  assert.ok(result.warnings.includes("report_collateral_content_pruned_from_mse"));
});

test("V0.6 informe: elimina la variante 'no se documentan de forma suficiente otros dominios'", () => {
  const input = assessment({
    exploracion_psicopatologica: {
      text: "Se exploran verbalmente nerviosismo, agitación, ansiedad e insomnio referidos por la paciente; la madre observa aspecto cansado. No se documentan de forma suficiente otros dominios del estado mental.",
      evidence_status: "insufficient",
      source_ids: ["p", "m"],
    },
  });

  const result = groundReportContentToTranscript(
    input,
    "PACIENTE: Estoy nerviosa y duermo mal.\nMADRE: La veo cansada.",
  );

  assert.equal(
    result.assessment.sections.exploracion_psicopatologica.text,
    "Se exploran verbalmente nerviosismo, agitación, ansiedad e insomnio referidos por la paciente.",
  );
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_mse"));
  assert.ok(result.warnings.includes("report_collateral_content_pruned_from_mse"));
});

test("V0.6 informe: elimina 'no se exploraron de forma documentada otros dominios psicopatológicos'", () => {
  const input = assessment({
    exploracion_psicopatologica: {
      text: "La paciente refiere nerviosismo, insomnio y agitación. No se exploraron de forma documentada otros dominios psicopatológicos.",
      evidence_status: "insufficient",
      source_ids: ["p"],
    },
  });

  const result = groundReportContentToTranscript(
    input,
    "PACIENTE: Estoy nerviosa, agitada y duermo mal.",
  );

  assert.equal(
    result.assessment.sections.exploracion_psicopatologica.text,
    "La paciente refiere nerviosismo, insomnio y agitación.",
  );
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_mse"));
});

test("V0.6 informe: elimina 'no consta exploración suficiente de otros dominios psicopatológicos'", () => {
  const input = assessment({
    exploracion_psicopatologica: {
      text: "Refiere nerviosismo, agitación e insomnio. No consta exploración suficiente de otros dominios psicopatológicos.",
      evidence_status: "insufficient",
      source_ids: ["p"],
    },
  });

  const result = groundReportContentToTranscript(
    input,
    "PACIENTE: Estoy nerviosa, agitada y no puedo dormir.",
  );

  assert.equal(
    result.assessment.sections.exploracion_psicopatologica.text,
    "Refiere nerviosismo, agitación e insomnio.",
  );
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_mse"));
});

test("V0.6 informe: limpia las nuevas variantes metadiscursivas de sociofamiliar, MSE y plan", () => {
  const input = assessment({
    situacion_sociofamiliar: {
      text: "No se exploraron convivencia, apoyo adicional, escolarización ni empleo.",
      evidence_status: "insufficient",
      source_ids: ["q"],
    },
    exploracion_psicopatologica: {
      text: "La paciente refiere nerviosismo, insomnio y agitación. No se documentan en esta evidencia otros elementos del estado mental actual.",
      evidence_status: "insufficient",
      source_ids: ["p"],
    },
    plan_terapeutico: {
      text: "No consta ingreso ni no ingreso, unidad asistencial, pruebas complementarias, seguimiento programado ni medidas específicas de seguridad. El psiquiatra indica la pauta de sertralina, clonazepam de rescate y mirtazapina nocturna, y expresa expectativa de mejoría en la próxima visita.",
      evidence_status: "supported",
      source_ids: ["q"],
    },
  });

  const result = groundReportContentToTranscript(
    input,
    "PACIENTE: Estoy nerviosa, agitada y no puedo dormir.\nPSIQUIATRA: Indico sertralina, clonazepam de rescate y mirtazapina por la noche.",
  );

  assert.equal(result.assessment.sections.situacion_sociofamiliar.text, "");
  assert.equal(result.assessment.sections.situacion_sociofamiliar.evidence_status, "insufficient");
  assert.equal(
    result.assessment.sections.exploracion_psicopatologica.text,
    "La paciente refiere nerviosismo, insomnio y agitación.",
  );
  assert.equal(
    result.assessment.sections.plan_terapeutico.text,
    "El psiquiatra indica la pauta de sertralina, clonazepam de rescate y mirtazapina nocturna",
  );
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_sociofamily"));
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_mse"));
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_plan"));
  assert.ok(result.warnings.includes("report_meta_phrasing_pruned_from_plan"));
});

test("V0.6 informe: limpia las variantes del informe tras la nueva prueba completa", () => {
  const input = assessment({
    situacion_sociofamiliar: {
      text: "Se menciona a la madre, descrita por la paciente como agobiada y con falta de sueño.",
      evidence_status: "supported",
      source_ids: ["p"],
    },
    enfermedad_actual: {
      text: "Refiere encontrarse muy nerviosa últimamente, con sueño alterado y sensación de agitación persistente. Expresa preocupación por el estado de su madre, a quien describe agobiada y con aspecto cansado por falta de sueño. Durante la entrevista refiere estar tomando lorazepam y sertralina y señala que es adherente a la medicación.",
      evidence_status: "supported",
      source_ids: ["p", "m"],
    },
    exploracion_psicopatologica: {
      text: "Refiere nerviosismo, agitación e insomnio. Otros dominios psicopatológicos no explorados en la entrevista disponible.",
      evidence_status: "insufficient",
      source_ids: ["p"],
    },
    plan_terapeutico: {
      text: "Se indica sertralina 50 mg por la mañana, en una sola dosis con el desayuno. Se indica no tomarla con la comida ni con la cena. Se prescribe Rivotril (clonazepam) 0,5 mg como medicación de rescate durante el día cuando aparezca ansiedad. Se indica mirtazapina 15 mg por la noche antes de dormir.",
      evidence_status: "supported",
      source_ids: ["q"],
    },
  });
  input.medications = {
    habitual: [],
    current: [
      { raw_name: "Sertralina", status: "active" },
      { raw_name: "Rivotril", status: "active" },
      { raw_name: "Mirtazapina", status: "active" },
    ],
  };

  const result = groundReportContentToTranscript(
    input,
    "PACIENTE: Estoy nerviosa, agitada y duermo mal.\nMADRE: Está agobiada y parece cansada.\nPSIQUIATRA: Indico sertralina 50 mg por la mañana, Rivotril 0,5 mg de rescate y mirtazapina 15 mg por la noche.",
  );

  assert.equal(result.assessment.sections.situacion_sociofamiliar.text, "");
  assert.equal(result.assessment.sections.situacion_sociofamiliar.evidence_status, "insufficient");
  assert.equal(
    result.assessment.sections.enfermedad_actual.text,
    "Refiere encontrarse muy nerviosa últimamente, con sueño alterado y sensación de agitación persistente.",
  );
  assert.equal(
    result.assessment.sections.exploracion_psicopatologica.text,
    "Refiere nerviosismo, agitación e insomnio.",
  );
  assert.equal(
    result.assessment.sections.plan_terapeutico.text,
    "Se indica sertralina 50 mg por la mañana, en una sola dosis con el desayuno. Se prescribe Rivotril (clonazepam) 0,5 mg como medicación de rescate durante el día cuando aparezca ansiedad. Se indica mirtazapina 15 mg por la noche antes de dormir.",
  );
  assert.ok(result.warnings.includes("report_family_self_symptoms_pruned_from_sociofamily"));
  assert.ok(result.warnings.includes("report_family_self_symptoms_pruned_from_current_illness"));
  assert.ok(result.warnings.includes("report_unsupported_habitual_medication_pruned_from_current_illness"));
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_mse"));
  assert.ok(result.warnings.includes("report_meta_phrasing_pruned_from_plan"));
});

test("V0.6 informe: limpia la contaminación madre-paciente observada tras la regresión", () => {
  const input = assessment({
    situacion_sociofamiliar: {
      text: "Se menciona a la madre en el contexto de la relación actual. La paciente refiere que su madre está muy agobiada y duerme mal.",
      evidence_status: "supported",
      source_ids: ["p"],
    },
    enfermedad_actual: {
      text: "Refiere encontrarse muy nerviosa últimamente, con dificultad para dormir y sensación de agitación constante. Durante la entrevista menciona también que su madre está muy agobiada y duerme mal. Refiere tratamiento actual con lorazepam y sertralina, sin aportar dosis ni pauta.",
      evidence_status: "supported",
      source_ids: ["p", "m"],
    },
    exploracion_psicopatologica: {
      text: "Refiere nerviosismo, agitación y dificultades de sueño. No se exploraron de forma suficiente otros dominios psicopatológicos.",
      evidence_status: "insufficient",
      source_ids: ["p"],
    },
  });
  input.medications = { habitual: [], current: [] };

  const result = groundReportContentToTranscript(
    input,
    "PACIENTE: Estoy nerviosa, agitada y duermo mal.\nMADRE: Está muy agobiada y duerme mal.",
  );

  assert.equal(result.assessment.sections.situacion_sociofamiliar.text, "");
  assert.equal(result.assessment.sections.situacion_sociofamiliar.evidence_status, "insufficient");
  assert.equal(
    result.assessment.sections.enfermedad_actual.text,
    "Refiere encontrarse muy nerviosa últimamente, con dificultad para dormir y sensación de agitación constante.",
  );
  assert.equal(
    result.assessment.sections.exploracion_psicopatologica.text,
    "Refiere nerviosismo, agitación y dificultades de sueño.",
  );
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_sociofamily"));
  assert.ok(result.warnings.includes("report_family_self_symptoms_pruned_from_sociofamily"));
  assert.ok(result.warnings.includes("report_family_self_symptoms_pruned_from_current_illness"));
  assert.ok(result.warnings.includes("report_unsupported_habitual_medication_pruned_from_current_illness"));
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_mse"));
});

test("V0.6 informe: aclara la observación materna y elimina el metatexto de la captura final", () => {
  const input = assessment({
    enfermedad_actual: {
      text: "La paciente refiere encontrarse muy nerviosa últimamente, con dificultad para dormir y agitación constante. La madre la describe siempre muy agobiada, con mal descanso nocturno y aspecto cansado.",
      evidence_status: "supported",
      source_ids: ["p", "m"],
    },
    exploracion_psicopatologica: {
      text: "Refiere nerviosismo, agitación e insomnio. No se realiza exploración psicopatológica completa en la entrevista aportada.",
      evidence_status: "insufficient",
      source_ids: ["p"],
    },
  });

  const result = groundReportContentToTranscript(
    input,
    "PACIENTE: Estoy nerviosa, agitada y duermo mal.\nMADRE: La veo muy agobiada, cansada y duerme mal.",
  );

  assert.equal(
    result.assessment.sections.enfermedad_actual.text,
    "La paciente refiere encontrarse muy nerviosa últimamente, con dificultad para dormir y agitación constante. Según la madre, la paciente se muestra siempre muy agobiada, con mal descanso nocturno y aspecto cansado.",
  );
  assert.equal(
    result.assessment.sections.exploracion_psicopatologica.text,
    "Refiere nerviosismo, agitación e insomnio.",
  );
  assert.ok(result.warnings.includes("report_maternal_collateral_subject_clarified"));
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_mse"));
});

test("V0.6 informe: elimina medicación materna y metatexto observados en la nueva captura", () => {
  const input = assessment({
    enfermedad_actual: {
      text: "La paciente refiere estar muy nerviosa últimamente, con dificultad para dormir y agitación persistente. La madre informa de tratamiento actual con lorazepam y sertralina y refiere supervisar la toma de toda la medicación.",
      evidence_status: "supported",
      source_ids: ["p", "m"],
    },
    exploracion_psicopatologica: {
      text: "La paciente refiere nerviosismo, insomnio y agitación. No constan otros elementos del estado mental actual explorados u observados.",
      evidence_status: "insufficient",
      source_ids: ["p"],
    },
  });
  input.medications = {
    habitual: [],
    current: [
      { raw_name: "Sertralina", status: "active" },
      { raw_name: "Clonazepam", status: "active" },
      { raw_name: "Mirtazapina", status: "active" },
    ],
  };

  const result = groundReportContentToTranscript(
    input,
    "PACIENTE: Estoy nerviosa, agitada y duermo mal.\nMADRE: Yo tomo lorazepam y sertralina.\nPSIQUIATRA: Para la paciente indico sertralina, clonazepam y mirtazapina.",
  );

  assert.equal(
    result.assessment.sections.enfermedad_actual.text,
    "La paciente refiere estar muy nerviosa últimamente, con dificultad para dormir y agitación persistente.",
  );
  assert.equal(
    result.assessment.sections.exploracion_psicopatologica.text,
    "La paciente refiere nerviosismo, insomnio y agitación.",
  );
  assert.ok(result.warnings.includes("report_unsupported_habitual_medication_pruned_from_current_illness"));
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_mse"));
});

test("V0.6 informe: normaliza la referencia indirecta a una próxima visita", () => {
  const input = assessment({
    plan_terapeutico: {
      text: "Sertralina 50 mg por la mañana. Se hará referencia a una próxima visita.",
      evidence_status: "supported",
      source_ids: ["q"],
    },
  });

  const result = groundReportContentToTranscript(
    input,
    "PSIQUIATRA: Sertralina 50 mg por la mañana y revisión en la próxima consulta.",
  );

  assert.equal(
    result.assessment.sections.plan_terapeutico.text,
    "Sertralina 50 mg por la mañana. Seguimiento en próxima consulta.",
  );
  assert.ok(result.warnings.includes("report_meta_phrasing_pruned_from_plan"));
});

test("V0.6 informe: limpia las variantes de metatexto visibles en exploración y plan", () => {
  const input = assessment({
    exploracion_psicopatologica: {
      text: "La paciente refiere nerviosismo, insomnio y agitación. No constan datos suficientes sobre ánimo, afecto, pensamiento, percepción, cognición, juicio, introspección ni ideación suicida u homicida.",
      evidence_status: "insufficient",
      source_ids: ["p"],
    },
    plan_terapeutico: {
      text: "Sertralina 50 mg por la mañana. Se menciona una próxima visita, sin fecha ni condiciones especificadas. No constan indicación de ingreso, unidad, pruebas, medidas de seguridad ni intervención no farmacológica.",
      evidence_status: "supported",
      source_ids: ["q"],
    },
  });

  const result = groundReportContentToTranscript(
    input,
    "PACIENTE: Estoy nerviosa, agitada y duermo mal.\nPSIQUIATRA: Sertralina 50 mg por la mañana y revisión en la próxima consulta.",
  );

  assert.equal(
    result.assessment.sections.exploracion_psicopatologica.text,
    "La paciente refiere nerviosismo, insomnio y agitación.",
  );
  assert.equal(
    result.assessment.sections.plan_terapeutico.text,
    "Sertralina 50 mg por la mañana. Seguimiento en próxima consulta.",
  );
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_mse"));
  assert.ok(result.warnings.includes("report_meta_absence_pruned_from_plan"));
  assert.ok(result.warnings.includes("report_meta_phrasing_pruned_from_plan"));
});

test("V0.6 informe: elimina de enfermedad actual la medicación de la madre y la nueva pauta", () => {
  const input = assessment({
    enfermedad_actual: {
      text: "La paciente refiere encontrarse muy nerviosa últimamente, con sueño insuficiente y agitación constante. La madre la describe siempre muy agobiada y con mal descanso, observándole aspecto cansado. Durante la valoración se recoge que actualmente toma lorazepam y sertralina, con supervisión materna de la administración. El psiquiatra indica una pauta a partir de ese momento: sertralina 50 mg por la mañana, clonazepam de rescate durante el día y mirtazapina 15 mg antes de dormir.",
      evidence_status: "supported",
      source_ids: ["p", "m", "q"],
    },
  });
  input.medications = {
    habitual: [],
    current: [
      { raw_name: "Sertralina", status: "active" },
      { raw_name: "Clonazepam", status: "active" },
      { raw_name: "Mirtazapina", status: "active" },
    ],
  };

  const result = groundReportContentToTranscript(
    input,
    "PACIENTE: Estoy nerviosa, agitada y duermo mal.\nMADRE: La veo muy agobiada, cansada y duerme mal.\nPSIQUIATRA: Le indico sertralina, clonazepam y mirtazapina a partir de ahora.",
  );

  assert.equal(
    result.assessment.sections.enfermedad_actual.text,
    "La paciente refiere encontrarse muy nerviosa últimamente, con sueño insuficiente y agitación constante. Según la madre, la paciente se muestra siempre muy agobiada y con mal descanso y presenta aspecto cansado.",
  );
  assert.ok(result.warnings.includes("report_maternal_collateral_subject_clarified"));
  assert.ok(result.warnings.includes("report_current_treatment_plan_pruned_from_current_illness"));
  assert.ok(result.warnings.includes("report_unsupported_habitual_medication_pruned_from_current_illness"));
});

test("V0.6 informe: elimina la variante 'se informa de una pauta farmacológica a seguir'", () => {
  const input = assessment({
    enfermedad_actual: {
      text: "La paciente refiere estar muy nerviosa últimamente, con dificultad para dormir y agitación constante. La madre la describe siempre muy agobiada, con mal descanso nocturno y aspecto cansado. Durante la valoración se informa de una pauta farmacológica a seguir: sertralina 50 mg por la mañana, clonazepam 0,5 mg como medicación de rescate ante ansiedad y mirtazapina 15 mg por la noche.",
      evidence_status: "supported",
      source_ids: ["p", "m", "q"],
    },
  });

  const result = groundReportContentToTranscript(
    input,
    "PACIENTE: Estoy nerviosa, agitada y duermo mal.\nMADRE: La veo agobiada y cansada.\nPSIQUIATRA: Indico sertralina, clonazepam y mirtazapina a partir de ahora.",
  );

  assert.equal(
    result.assessment.sections.enfermedad_actual.text,
    "La paciente refiere estar muy nerviosa últimamente, con dificultad para dormir y agitación constante. Según la madre, la paciente se muestra siempre muy agobiada, con mal descanso nocturno y aspecto cansado.",
  );
  assert.ok(result.warnings.includes("report_maternal_collateral_subject_clarified"));
  assert.ok(result.warnings.includes("report_current_treatment_plan_pruned_from_current_illness"));
});

test("V0.6 informe: separa la pauta nueva de enfermedad actual y elimina lenguaje interno", () => {
  const input = assessment({
    enfermedad_actual: {
      text: "Refiere encontrarse muy nerviosa últimamente, con agitación persistente y dificultad para dormir. La madre describe que está siempre muy agobiada, que duerme mal y presenta aspecto cansado. Durante la valoración se revisa el tratamiento: se indica sertralina 50 mg por la mañana, en una sola toma con el desayuno; clonazepam 0,5 mg de rescate; y un fármaco referido como «catapina», de 5 mg antes de dormir, cuyo principio activo no queda establecido en la transcripción. También se indica no tomar medicación en la comida ni en la cena en relación con la sertralina.",
      evidence_status: "supported",
      source_ids: ["p", "m", "q"],
    },
    exploracion_psicopatologica: {
      text: "Refiere nerviosismo, agitación y dificultades de sueño. La madre refiere agobio, mal descanso y aspecto cansado.",
      evidence_status: "supported",
      source_ids: ["p", "m"],
    },
    plan_terapeutico: {
      text: "Pauta indicada durante la valoración: sertralina 50 mg por la mañana, en una sola dosis con el desayuno; clonazepam 0,5 mg durante el día como medicación de rescate ante ansiedad; y un fármaco referido como «catapina», 5 mg antes de dormir, sin principio activo confirmado. Se indica no tomar medicación ni en comida ni en cena en relación con la sertralina. Seguimiento en próxima visita mencionado, sin fecha ni dispositivo especificados.",
      evidence_status: "supported",
      source_ids: ["q"],
    },
  });

  const result = groundReportContentToTranscript(
    input,
    "PACIENTE: Estoy nerviosa y duermo mal.\nMADRE: Está agobiada y parece cansada.\nPSIQUIATRA: Indico sertralina 50 mg por la mañana, clonazepam 0,5 mg de rescate y catapina 5 mg antes de dormir. Seguimiento en próxima consulta.",
  );

  assert.equal(
    result.assessment.sections.enfermedad_actual.text,
    "Refiere encontrarse muy nerviosa últimamente, con agitación persistente y dificultad para dormir. Según la madre, la paciente está siempre muy agobiada, duerme mal y presenta aspecto cansado.",
  );
  assert.equal(
    result.assessment.sections.exploracion_psicopatologica.text,
    "Refiere nerviosismo, agitación y dificultades de sueño.",
  );
  assert.equal(
    result.assessment.sections.plan_terapeutico.text,
    "sertralina 50 mg por la mañana, en una sola dosis con el desayuno; clonazepam 0,5 mg durante el día como medicación de rescate ante ansiedad; y «catapina», 5 mg antes de dormir. Seguimiento en próxima consulta.",
  );
  assert.doesNotMatch(result.assessment.sections.plan_terapeutico.text, /transcripci[oó]n|principio activo|mencionado|sin fecha/i);
  assert.ok(result.warnings.includes("report_current_treatment_plan_pruned_from_current_illness"));
  assert.ok(result.warnings.includes("report_meta_phrasing_pruned_from_plan"));
  assert.ok(result.warnings.includes("report_collateral_content_pruned_from_mse"));
});
