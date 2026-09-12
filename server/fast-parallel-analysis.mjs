import { zodTextFormat } from "openai/helpers/zod";
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
  for (const item of response?.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "refusal") return content.refusal || "Solicitud rechazada por el modelo.";
    }
  }
  return "";
}

function extractParsed(response) {
  if (response?.output_parsed) return response.output_parsed;
  for (const item of response?.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.parsed) return content.parsed;
    }
  }
  return null;
}

async function invokeStructured(client, params, schema) {
  if (typeof client.responses?.parse === "function") {
    const response = await client.responses.parse(params);
    return { response, parsed: extractParsed(response), parser: "responses.parse+zod" };
  }
  if (typeof client.responses?.create === "function") {
    const response = await client.responses.create(params);
    if (!response.output_text) return { response, parsed: null, parser: "test-create-fallback" };
    return { response, parsed: schema.parse(JSON.parse(response.output_text)), parser: "test-create-fallback" };
  }
  throw new TypeError("El cliente de modelo no expone Responses API.");
}

function retryable(error) {
  return error?.name === "SyntaxError" || error?.name === "ZodError" || /json|parse|structured output|schema/i.test(String(error?.message || ""));
}

async function requestBranch(client, { model, schema, formatName, prompt, transcript, maxOutputTokens }) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const startedAt = Date.now();
      const result = await invokeStructured(client, {
        model,
        store: false,
        background: false,
        reasoning: { effort: "none" },
        max_output_tokens: maxOutputTokens,
        instructions: attempt === 1
          ? prompt
          : `${prompt}\n\nREINTENTO TÉCNICO: devuelve únicamente la salida estructurada exacta, sin texto adicional.`,
        input: [{
          role: "user",
          content: [{
            type: "input_text",
            text:
              "Trabaja únicamente con esta evidencia clínica ya desidentificada. " +
              "Puede ser una selección conservadora de líneas exactas; lo omitido no equivale a negado ni explorado:\n\n" +
              transcript,
          }],
        }],
        text: { format: zodTextFormat(schema, formatName) },
      }, schema);
      const refusal = extractRefusal(result.response);
      if (refusal) throw Object.assign(new Error(refusal), { name: "ModelRefusalError" });
      if (result.response?.status !== "completed") {
        throw Object.assign(new Error(`Respuesta incompleta del modelo: ${result.response?.status}`), { name: "IncompleteModelResponseError" });
      }
      if (!result.parsed) throw Object.assign(new Error("Salida estructurada no validable."), { name: "StructuredOutputParseError" });
      return {
        ...result,
        attempts: attempt,
        elapsedMs: Date.now() - startedAt,
        requestId: result.response?._request_id || "",
      };
    } catch (error) {
      lastError = error;
      if (attempt < 2 && retryable(error)) continue;
      throw error;
    }
  }
  throw lastError || new Error("No se pudo obtener una salida estructurada válida.");
}

export async function analyzeFastParallelTranscript(transcript, options = {}) {
  const totalStartedAt = Date.now();
  if (typeof transcript !== "string" || transcript.trim().length < 20) {
    throw new TypeError("La transcripción debe contener texto suficiente para analizar.");
  }
  const modelTranscript = typeof options.modelTranscript === "string" && options.modelTranscript.trim().length >= 20
    ? options.modelTranscript.trim()
    : transcript.trim();

  let client = options.client;
  let transport = client ? "injected-test-client" : "";
  let defaultModel = "gpt-5.6-luna";
  if (!client) {
    const { default: OpenAI } = await import("openai");
    const auth = await resolveModelAuth();
    if (!auth) throw new Error("No hay credenciales de modelo configuradas.");
    client = new OpenAI({ apiKey: auth.apiKey, ...(auth.baseURL ? { baseURL: auth.baseURL } : {}) });
    transport = auth.transport;
    defaultModel = auth.defaultModel || defaultModel;
  }
  const model = options.model || "gpt-5.6-luna" || defaultModel;

  const modelStartedAt = Date.now();
  const [history, current] = await Promise.all([
    requestBranch(client, {
      model,
      schema: HistoryClinicalSchema,
      formatName: "psychiatric_fast_history_v062",
      prompt: HISTORY_PROMPT,
      transcript: modelTranscript,
      maxOutputTokens: 5000,
    }),
    requestBranch(client, {
      model,
      schema: CurrentClinicalSchema,
      formatName: "psychiatric_fast_current_v062",
      prompt: CURRENT_PROMPT,
      transcript: modelTranscript,
      maxOutputTokens: 5000,
    }),
  ]);
  const modelMs = Date.now() - modelStartedAt;

  const merged = mergeParallelClinicalAssessment(history.parsed, current.parsed);
  const deterministicStartedAt = Date.now();
  const invariantResult = applyClinicalInvariants(merged);
  let assessment = invariantResult.assessment;
  const warnings = [...invariantResult.warnings];

  let medicationMeta = {
    medication_verification_enabled: false,
    medication_verification_source: "not_run",
  };
  let medicationMs = 0;
  const shouldVerifyMedications = !options.client || typeof options.medicationVerifier === "function";
  if (shouldVerifyMedications) {
    const medicationStartedAt = Date.now();
    const verifier = options.medicationVerifier || verifyAssessmentMedications;
    const medicationResult = await verifier(assessment, options.medicationVerificationOptions || {});
    medicationMs = Date.now() - medicationStartedAt;
    assessment = medicationResult.assessment;
    warnings.push(...(medicationResult.warnings || []));
    medicationMeta = medicationResult.meta || medicationMeta;
  }

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
      structured_output_parser: `fast-parallel2:${history.parser}+${current.parser}`,
      structured_output_attempts: Math.max(history.attempts, current.attempts),
      request_id: [history.requestId, current.requestId].filter(Boolean).join(","),
      warnings,
      invariant_violations: violations,
      intervention_transcript_grounded: true,
      mse_explicit_observation_grounded: true,
      psq_guardia_transcript_grounded: true,
      report_content_transcript_grounded: true,
      model_input_compacted: modelTranscript !== transcript.trim(),
      model_input_characters: modelTranscript.length,
      grounding_transcript_characters: transcript.trim().length,
      fast_mode: true,
      fast_parallel_route: true,
      parallel_full_route: true,
      parallel_full_fallback_used: false,
      parallel_branch_count: 2,
      reasoning_effort: "none",
      max_output_tokens: 5000,
      performance_ms: {
        structured_clinical_model: modelMs,
        parallel_history_model: history.elapsedMs,
        parallel_current_model: current.elapsedMs,
        medication_verification: medicationMs,
        deterministic_postprocessing: deterministicOnlyMs,
        total_analysis: Date.now() - totalStartedAt,
      },
      ...medicationMeta,
      ...postprocessResult.meta,
    },
  };
}
