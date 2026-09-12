import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeTranscript } from "../server/analyze.mjs";

function section(text = "", evidence_status = "not_provided", source_ids = []) {
  return { text, evidence_status, source_ids };
}

function assessment() {
  return {
    sources: [
      { id: "pat", label: "Paciente", kind: "patient" },
      { id: "psy", label: "Psiquiatra", kind: "psychiatrist" },
    ],
    sections: {
      motivo_consulta: section("Nerviosismo e insomnio.", "supported", ["pat"]),
      psq_guardia: section(),
      alergias_ram: section(),
      antecedentes_somaticos: section(),
      antecedentes_salud_mental: section(),
      antecedentes_familiares_psiquiatricos: section(),
      situacion_sociofamiliar: section(),
      habitos_toxicos: section(),
      tratamiento_habitual: section(),
      enfermedad_actual: section("Nerviosismo reciente con dificultad para dormir.", "supported", ["pat"]),
      intervencion: section(),
      exploracion_psicopatologica: section(),
      orientacion_diagnostica: section("", "insufficient", []),
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

function clientCapturing(target) {
  return {
    responses: {
      async create(params) {
        target.push(params);
        return {
          status: "completed",
          output: [],
          output_text: JSON.stringify(assessment()),
        };
      },
    },
  };
}

const transcript = "PSIQUIATRA: ¿Qué le ocurre? PACIENTE: Estoy nervioso y desde hace unos días duermo mal.";

test("V0.6 rendimiento: el modo rápido verificado conserva prompt compacto y reasoning none como fallback", async () => {
  const captured = [];
  const result = await analyzeTranscript(transcript, {
    client: clientCapturing(captured),
    model: "gpt-5.6-luna",
    modelTranscript: transcript,
    fastMode: true,
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].reasoning.effort, "none");
  assert.equal(captured[0].max_output_tokens, 10000);
  assert.match(captured[0].instructions, /No inventes ni completes por inferencia/);
  assert.equal(result.meta.fast_mode, true);
  assert.equal(result.meta.reasoning_effort, "none");
});

test("V0.6 seguridad: la ruta clínica normal conserva prompt completo y reasoning low", async () => {
  const captured = [];
  const result = await analyzeTranscript(transcript, {
    client: clientCapturing(captured),
    model: "gpt-5.6",
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].reasoning.effort, "low");
  assert.equal(captured[0].max_output_tokens, 16000);
  assert.match(captured[0].instructions, /CONTENCIÓN MECÁNICA/);
  assert.equal(result.meta.fast_mode, false);
  assert.equal(result.meta.reasoning_effort, "low");
});

test("V0.6 seguridad: API solo activa el paralelo rápido con ruta rápida y evidencia verificada, con fallback compacto", async () => {
  const apiAnalyze = await readFile(new URL("../api/analyze.mjs", import.meta.url), "utf8");
  const fastParallel = await readFile(new URL("../server/fast-parallel-analysis.mjs", import.meta.url), "utf8");

  assert.match(apiAnalyze, /const fastMode = fastRoute && evidenceBundle\.verified/);
  assert.match(apiAnalyze, /analyzeFastParallelTranscript/);
  assert.match(apiAnalyze, /fast_parallel_close: fastParallelClose/);
  assert.match(apiAnalyze, /fast_parallel_fallback_used: fastParallelFallbackUsed/);
  assert.match(apiAnalyze, /fastMode:\s*true/);
  assert.match(apiAnalyze, /verified_fast_mode: fastMode/);

  assert.match(fastParallel, /Promise\.all/);
  assert.match(fastParallel, /HistoryClinicalSchema/);
  assert.match(fastParallel, /CurrentClinicalSchema/);
  assert.match(fastParallel, /reasoning:\s*\{ effort: "none" \}/);
  assert.match(fastParallel, /mergeParallelClinicalAssessment\(history\.parsed, current\.parsed\)/);
  assert.match(fastParallel, /collectClinicalInvariantViolations/);
  assert.match(fastParallel, /groundReportContentToTranscript/);
});
