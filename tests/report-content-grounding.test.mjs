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
    "Refiere encontrarse muy nerviosa últimamente, con agitación persistente y dificultad para dormir. La madre describe que está siempre muy agobiada, que duerme mal y presenta aspecto cansado.",
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
