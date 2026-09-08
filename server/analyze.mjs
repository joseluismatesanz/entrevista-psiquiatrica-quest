import { zodTextFormat } from "openai/helpers/zod";
import { SYSTEM_PROMPT } from "./prompt.mjs";
import { ClinicalAssessmentSchema } from "./clinical-schema.mjs";
import { applyClinicalInvariants, collectClinicalInvariantViolations } from "./clinical-invariants.mjs";
import { applyClinicalPostprocessing } from "./clinical-postprocess.mjs";
import { groundExplicitMseAssessment } from "./mse-grounding.mjs";
import { groundPsqGuardiaToTranscript } from "./psq-guard.mjs";
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
  if (error.name === "StructuredOutputParseError" || error.name === "SyntaxError" || error.name === "ZodError") {
    return true;
  }
  return /json|parse|parsed|structured output|schema/i.test(String(error.message || ""));
}

async function invokeStructured(client, params) {
  if (typeof client.responses?.parse === "function") {
    const response = await client.responses.parse(params);
    return { response, parsed: extractParsed(response), parser: "responses.parse+zod" };
  }

  // Compatibilidad exclusiva con clientes simulados de regresión.
  if (typeof client.responses?.create === "function") {
    const response = await client.responses.create(params);
    if (!response.output_text) return { response, parsed: null, parser: "test-create-fallback" };

    try {
      const parsed = ClinicalAssessmentSchema.parse(JSON.parse(response.output_text));
      return { response, parsed, parser: "test-create-fallback" };
    } catch (cause) {
      throw structuredOutputError("El cliente de prueba devolvió una salida estructurada inválida.", cause);
    }
  }

  throw new TypeError("El cliente de modelo no expone Responses API.");
}

async function requestParsedAssessment(client, baseParams) {
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { response, parsed, parser } = await invokeStructured(client, {
        ...baseParams,
        instructions:
          attempt === 1
            ? SYSTEM_PROMPT
            : `${SYSTEM_PROMPT}\n\nREINTENTO TÉCNICO: devuelve únicamente una salida que cumpla exactamente el esquema estructurado. No añadas texto fuera de los campos del esquema.`,
      });

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

      if (!parsed) {
        throw structuredOutputError("El modelo no devolvió una salida estructurada validable.");
      }

      return { parsed, response, attempts: attempt, parser };
    } catch (error) {
      lastError = error;
      if (attempt < 2 && isRetryableStructuredError(error)) continue;
      throw error;
    }
  }

  throw lastError || structuredOutputError("No se pudo obtener una salida estructurada válida.");
}

export async function analyzeTranscript(transcript, options = {}) {
  if (typeof transcript !== "string" || transcript.trim().length < 20) {
    throw new TypeError("La transcripción debe contener texto suficiente para analizar.");
  }

  let client = options.client;
  let transport = client ? "injected-test-client" : "";
  let defaultModel = "gpt-5.6";

  if (!client) {
    const { default: OpenAI } = await import("openai");
    const auth = await resolveModelAuth();

    if (!auth) {
      throw new Error("No hay credenciales de modelo configuradas.");
    }

    client = new OpenAI({
      apiKey: auth.apiKey,
      ...(auth.baseURL ? { baseURL: auth.baseURL } : {}),
    });
    transport = auth.transport;
    defaultModel = auth.defaultModel;
  }

  const model = options.model || process.env.OPENAI_MODEL || defaultModel;
  const textFormat = zodTextFormat(ClinicalAssessmentSchema, "psychiatric_assessment_v04");

  const { parsed, response, attempts, parser } = await requestParsedAssessment(client, {
    model,
    store: false,
    background: false,
    reasoning: { effort: "medium" },
    max_output_tokens: 16000,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Genera el borrador clínico estructurado en JSON según el esquema. " +
              "Trabaja únicamente con la siguiente entrevista ficticia o previamente anonimizada:\n\n" +
              transcript.trim(),
          },
        ],
      },
    ],
    text: { format: textFormat },
  });

  const invariantResult = applyClinicalInvariants(parsed);
  let assessment = invariantResult.assessment;
  const warnings = [...invariantResult.warnings];
  let medicationMeta = {
    medication_verification_enabled: false,
    medication_verification_source: "not_run",
  };

  // En producción se contrasta cada nombre farmacológico con CIMA (AEMPS).
  // En pruebas con cliente inyectado no se toca la red salvo que se aporte un verificador explícito.
  const shouldVerifyMedications = !options.client || typeof options.medicationVerifier === "function";
  if (shouldVerifyMedications) {
    const verifier = options.medicationVerifier || verifyAssessmentMedications;
    const medicationResult = await verifier(assessment, options.medicationVerificationOptions || {});
    assessment = medicationResult.assessment;
    warnings.push(...(medicationResult.warnings || []));
    medicationMeta = medicationResult.meta || medicationMeta;
  }

  // Segunda capa determinista: usa la transcripción para corregir temporalidad farmacológica,
  // sincroniza las tarjetas con las entidades verificadas y elimina pseudodiscrepancias
  // subjetivo/objetivo que no representan versiones incompatibles.
  const postprocessResult = applyClinicalPostprocessing(assessment, transcript);
  assessment = postprocessResult.assessment;
  warnings.push(...postprocessResult.warnings);

  // Si existe exploración psicopatológica sustantiva y la transcripción contiene una
  // observación clínica explícita del psiquiatra, el apartado no puede quedar marcado
  // como insuficiente por un simple desacople del modelo.
  const mseGroundResult = groundExplicitMseAssessment(assessment, transcript);
  assessment = mseGroundResult.assessment;
  warnings.push(...mseGroundResult.warnings);

  // La identidad de PSQ Guardia nunca se acepta por inferencia ni por memoria del modelo.
  // Solo puede conservarse si el profesional se identifica explícitamente en la transcripción.
  const psqGuardResult = groundPsqGuardiaToTranscript(assessment, transcript);
  assessment = psqGuardResult.assessment;
  warnings.push(...psqGuardResult.warnings);

  const violations = collectClinicalInvariantViolations(assessment);

  return {
    assessment,
    report: renderClinicalReport(assessment),
    meta: {
      model,
      transport,
      store: false,
      structured_output_parser: parser,
      structured_output_attempts: attempts,
      request_id: response?._request_id || "",
      warnings,
      invariant_violations: violations,
      mse_explicit_observation_grounded: true,
      psq_guardia_transcript_grounded: true,
      ...medicationMeta,
      ...postprocessResult.meta,
    },
  };
}
