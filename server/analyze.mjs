import { zodTextFormat } from "openai/helpers/zod";
import { SYSTEM_PROMPT } from "./prompt.mjs";
import { FAST_SYSTEM_PROMPT } from "./fast-prompt.mjs";
import { ClinicalAssessmentSchema } from "./clinical-schema.mjs";
import {
  HistoryClinicalSchema,
  CurrentClinicalSchema,
  HISTORY_PROMPT,
  CURRENT_PROMPT,
  mergeParallelClinicalAssessment,
} from "./parallel-clinical-analysis.mjs";
import { applyClinicalInvariants, collectClinicalInvariantViolations } from "./clinical-invariants.mjs";
import { applyClinicalPostprocessing } from "./clinical-postprocess.mjs";
import { groundInterventionToTranscript } from "./intervention-grounding.mjs";
import { groundExplicitMseAssessment } from "./mse-grounding.mjs";
import { groundPsqGuardiaToTranscript } from "./psq-guard.mjs";
import { groundReportContentToTranscript } from "./report-content-grounding.mjs";
import { renderClinicalReport } from "./render-report.mjs";
import { resolveModelAuth } from "./model-auth.mjs";
import { verifyAssessmentMedications } from "./medication-verification.mjs";

function extractRefusal(response) {
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "refusal") return content.refusal || "Solicitud rechazada por el modelo.";
    }
  }
  return "";
}

function extractParsed(response) {
  if (response?.output_parsed) return response.output_parsed;
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.parsed) return content.parsed;
    }
  }
  return null;
}

function structuredOutputError(message, cause) {
  const error = new Error(message);
  error.name = "StructuredOutputParseError";
  if (cause) error.cause = cause;
  return error;
}

function isRetryableStructuredError(error) {
  if (!error) return false;
  if (error.name === "StructuredOutputParseError" || error.name === "SyntaxError" || error.name === "ZodError") return true;
  return /json|parse|parsed|structured output|schema/i.test(String(error.message || ""));
}

async function invokeStructured(client, params, schema = ClinicalAssessmentSchema) {
  if (typeof client.responses?.parse === "function") {
    const response = await client.responses.parse(params);
    return { response, parsed: extractParsed(response), parser: "responses.parse+zod" };
  }
  if (typeof client.responses?.create === "function") {
    const response = await client.responses.create(params);
    if (!response.output_text) return { response, parsed: null, parser: "test-create-fallback" };
    try {
      const parsed = schema.parse(JSON.parse(response.output_text));
      return { response, parsed, parser: "test-create-fallback" };
    } catch (cause) {
      throw structuredOutputError("El cliente de prueba devolvió una salida estructurada inválida.", cause);
    }
  }
  throw new TypeError("El cliente de modelo no expone Responses API.");
}

async function requestParsedAssessment(client, baseParams, instructionPrompt = SYSTEM_PROMPT, schema = ClinicalAssessmentSchema) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { response, parsed, parser } = await invokeStructured(client, {
        ...baseParams,
        instructions: attempt === 1
          ? instructionPrompt
          : `${instructionPrompt}\n\nREINTENTO TÉCNICO: devuelve únicamente una salida que cumpla exactamente el esquema estructurado. No añadas texto fuera de los campos del esquema.`,
      }, schema);
      const refusal = extractRefusal(response);
      if (refusal) {
        const error = new Error(refusal);
        error.name = "ModelRefusalError";
        throw error;
      }
      if (response.status !== "completed") {
        const error = new Error(`Respuesta incompleta del modelo: ${response.status}`);
        error.name = "IncompleteModelResponseError";
        throw error;
      }
      if (!parsed) throw structuredOutputError("El modelo no devolvió una salida estructurada validable.");
      return { parsed, response, attempts: attempt, parser };
    } catch (error) {
      lastError = error;
      if (attempt < 2 && isRetryableStructuredError(error)) continue;
      throw error;
    }
  }
  throw lastError || structuredOutputError("No se pudo obtener una salida estructurada válida.");
}

function modelInput(text) {
  return [{
    role: "user",
    content: [{
      type: "input_text",
      text:
        "Trabaja únicamente con la siguiente evidencia procedente de una entrevista ficticia o previamente anonimizada. " +
        "La evidencia puede ser una selección conservadora de líneas exactas; no infieras que lo omitido fue negado o explorado:\n\n" +
        text,
    }],
  }];
}

async function runSingleClinicalModel(client, model, modelTranscript, { fastMode = false } = {}) {
  const textFormat = zodTextFormat(ClinicalAssessmentSchema, "psychiatric_assessment_v04");
  const instructionPrompt = fastMode ? FAST_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const reasoningEffort = fastMode ? "none" : "low";
  const maxOutputTokens = fastMode ? 10000 : 16000;
  const startedAt = Date.now();
  const result = await requestParsedAssessment(client, {
    model,
    store: false,
    background: false,
    reasoning: { effort: reasoningEffort },
    max_output_tokens: maxOutputTokens,
    input: [{
      role: "user",
      content: [{
        type: "input_text",
        text:
          "Genera el borrador clínico estructurado en JSON según el esquema. " +
          "Trabaja únicamente con la siguiente evidencia procedente de una entrevista ficticia o previamente anonimizada. " +
          "La evidencia puede ser una selección conservadora de líneas exactas; no infieras que lo omitido fue negado o explorado:\n\n" +
          modelTranscript,
      }],
    }],
    text: { format: textFormat },
  }, instructionPrompt, ClinicalAssessmentSchema);
  return {
    ...result,
    elapsedMs: Date.now() - startedAt,
    reasoningEffort,
    maxOutputTokens,
    requestIds: [result.response?._request_id].filter(Boolean),
  };
}

async function runParallelClinicalModel(client, model, modelTranscript) {
  const startedAt = Date.now();
  const historyFormat = zodTextFormat(HistoryClinicalSchema, "psychiatric_history_context_v06");
  const currentFormat = zodTextFormat(CurrentClinicalSchema, "psychiatric_current_risk_v06");

  const timed = async (fn) => {
    const branchStartedAt = Date.now();
    const result = await fn();
    return { ...result, elapsedMs: Date.now() - branchStartedAt };
  };

  const [history, current] = await Promise.all([
    timed(() => requestParsedAssessment(client, {
      model,
      store: false,
      background: false,
      reasoning: { effort: "low" },
      max_output_tokens: 8000,
      input: modelInput(modelTranscript),
      text: { format: historyFormat },
    }, HISTORY_PROMPT, HistoryClinicalSchema)),
    timed(() => requestParsedAssessment(client, {
      model,
      store: false,
      background: false,
      reasoning: { effort: "low" },
      max_output_tokens: 10000,
      input: modelInput(modelTranscript),
      text: { format: currentFormat },
    }, CURRENT_PROMPT, CurrentClinicalSchema)),
  ]);

  return {
    parsed: mergeParallelClinicalAssessment(history.parsed, current.parsed),
    attempts: Math.max(history.attempts, current.attempts),
    parser: `parallel:${history.parser}+${current.parser}`,
    elapsedMs: Date.now() - startedAt,
    branchPerformance: {
      parallel_history_model: history.elapsedMs,
      parallel_current_model: current.elapsedMs,
    },
    requestIds: [history.response?._request_id, current.response?._request_id].filter(Boolean),
  };
}

export async function analyzeTranscript(transcript, options = {}) {
  const totalStartedAt = Date.now();
  if (typeof transcript !== "string" || transcript.trim().length < 20) {
    throw new TypeError("La transcripción debe contener texto suficiente para analizar.");
  }

  const modelTranscript = typeof options.modelTranscript === "string" && options.modelTranscript.trim().length >= 20
    ? options.modelTranscript.trim()
    : transcript.trim();
  const fastMode = options.fastMode === true;
  const requestedParallelMode = options.parallelMode === true && !fastMode;

  let client = options.client;
  let transport = client ? "injected-test-client" : "";
  let defaultModel = "gpt-5.6";

  if (!client) {
    const { default: OpenAI } = await import("openai");
    const auth = await resolveModelAuth();
    if (!auth) throw new Error("No hay credenciales de modelo configuradas.");
    client = new OpenAI({ apiKey: auth.apiKey, ...(auth.baseURL ? { baseURL: auth.baseURL } : {}) });
    transport = auth.transport;
    defaultModel = auth.defaultModel;
  }

  const model = options.model || process.env.OPENAI_MODEL || defaultModel;
  let parsed;
  let attempts = 1;
  let parser = "";
  let requestIds = [];
  let modelMs = 0;
  let branchPerformance = {};
  let parallelMode = false;
  let parallelFallbackUsed = false;
  let reasoningEffort = fastMode ? "none" : "low";
  let maxOutputTokens = fastMode ? 10000 : 16000;

  if (requestedParallelMode) {
    try {
      const parallel = await runParallelClinicalModel(client, model, modelTranscript);
      parsed = parallel.parsed;
      attempts = parallel.attempts;
      parser = parallel.parser;
      requestIds = parallel.requestIds;
      modelMs = parallel.elapsedMs;
      branchPerformance = parallel.branchPerformance;
      parallelMode = true;
      maxOutputTokens = 10000;
    } catch {
      // Fallback seguro: una rama o la fusión no deben dejar la Organización inutilizable.
      parallelFallbackUsed = true;
      const single = await runSingleClinicalModel(client, model, modelTranscript, { fastMode: false });
      parsed = single.parsed;
      attempts = single.attempts;
      parser = `parallel-fallback:${single.parser}`;
      requestIds = single.requestIds;
      modelMs = single.elapsedMs;
      reasoningEffort = single.reasoningEffort;
      maxOutputTokens = single.maxOutputTokens;
    }
  } else {
    const single = await runSingleClinicalModel(client, model, modelTranscript, { fastMode });
    parsed = single.parsed;
    attempts = single.attempts;
    parser = single.parser;
    requestIds = single.requestIds;
    modelMs = single.elapsedMs;
    reasoningEffort = single.reasoningEffort;
    maxOutputTokens = single.maxOutputTokens;
  }

  const deterministicStartedAt = Date.now();
  const invariantResult = applyClinicalInvariants(parsed);
  let assessment = invariantResult.assessment;
  const warnings = [...invariantResult.warnings];
  if (parallelFallbackUsed) warnings.push("parallel_full_route_fallback_used");
  let medicationMeta = {
    medication_verification_enabled: false,
    medication_verification_source: "not_run",
  };

  const shouldVerifyMedications = !options.client || typeof options.medicationVerifier === "function";
  let medicationMs = 0;
  if (shouldVerifyMedications) {
    const medicationStartedAt = Date.now();
    const verifier = options.medicationVerifier || verifyAssessmentMedications;
    const medicationResult = await verifier(assessment, options.medicationVerificationOptions || {});
    medicationMs = Date.now() - medicationStartedAt;
    assessment = medicationResult.assessment;
    warnings.push(...(medicationResult.warnings || []));
    medicationMeta = medicationResult.meta || medicationMeta;
  }

  // Las guardas deterministas SIEMPRE usan la transcripción completa desidentificada,
  // aunque el modelo haya recibido evidencia compacta o se haya dividido en ramas paralelas.
  const postprocessResult = applyClinicalPostprocessing(assessment, transcript);
  assessment = postprocessResult.assessment;
  warnings.push(...postprocessResult.warnings);

  const interventionGroundResult = groundInterventionToTranscript(assessment, transcript);
  assessment = interventionGroundResult.assessment;
  warnings.push(...interventionGroundResult.warnings);

  const mseGroundResult = groundExplicitMseAssessment(assessment, transcript);
  assessment = mseGroundResult.assessment;
  warnings.push(...mseGroundResult.warnings);

  const psqGuardResult = groundPsqGuardiaToTranscript(assessment, transcript);
  assessment = psqGuardResult.assessment;
  warnings.push(...psqGuardResult.warnings);

  const reportGroundResult = groundReportContentToTranscript(assessment, transcript);
  assessment = reportGroundResult.assessment;
  warnings.push(...reportGroundResult.warnings);

  const violations = collectClinicalInvariantViolations(assessment);
  const deterministicAndMedicationMs = Date.now() - deterministicStartedAt;
  const deterministicOnlyMs = Math.max(0, deterministicAndMedicationMs - medicationMs);

  return {
    assessment,
    report: renderClinicalReport(assessment),
    meta: {
      model,
      transport,
      store: false,
      structured_output_parser: parser,
      structured_output_attempts: attempts,
      request_id: requestIds.join(","),
      warnings,
      invariant_violations: violations,
      intervention_transcript_grounded: true,
      mse_explicit_observation_grounded: true,
      psq_guardia_transcript_grounded: true,
      report_content_transcript_grounded: true,
      model_input_compacted: modelTranscript !== transcript.trim(),
      model_input_characters: modelTranscript.length,
      grounding_transcript_characters: transcript.trim().length,
      fast_mode: fastMode,
      parallel_full_route: parallelMode,
      parallel_full_fallback_used: parallelFallbackUsed,
      reasoning_effort: reasoningEffort,
      max_output_tokens: maxOutputTokens,
      performance_ms: {
        structured_clinical_model: modelMs,
        ...branchPerformance,
        medication_verification: medicationMs,
        deterministic_postprocessing: deterministicOnlyMs,
        total_analysis: Date.now() - totalStartedAt,
      },
      ...medicationMeta,
      ...postprocessResult.meta,
    },
  };
}
