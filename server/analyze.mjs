import { zodTextFormat } from "openai/helpers/zod";
import { SYSTEM_PROMPT } from "./prompt.mjs";
import { ClinicalAssessmentSchema } from "./clinical-schema.mjs";
import { applyClinicalInvariants, collectClinicalInvariantViolations } from "./clinical-invariants.mjs";
import { renderClinicalReport } from "./render-report.mjs";

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

  for (const item of response?.output || []) {
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

async function requestParsedAssessment(client, baseParams) {
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await client.responses.parse({
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

      const parsed = extractParsed(response);
      if (!parsed) {
        throw structuredOutputError("El modelo no devolvió una salida estructurada validable.");
      }

      return { parsed, response, attempts: attempt };
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
    const gatewayToken = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;

    if (gatewayToken) {
      client = new OpenAI({
        apiKey: gatewayToken,
        baseURL: "https://ai-gateway.vercel.sh/v1",
      });
      transport = process.env.AI_GATEWAY_API_KEY
        ? "vercel-ai-gateway-key"
        : "vercel-ai-gateway-oidc";
      defaultModel = "openai/gpt-5.6-sol";
    } else if (process.env.OPENAI_API_KEY) {
      client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      transport = "openai-direct";
      defaultModel = "gpt-5.6";
    } else {
      throw new Error(
        "No hay credenciales de modelo configuradas. En Vercel se espera OIDC/AI Gateway; en local, OPENAI_API_KEY."
      );
    }
  }

  const model = options.model || process.env.OPENAI_MODEL || defaultModel;
  const textFormat = zodTextFormat(ClinicalAssessmentSchema, "psychiatric_assessment_v04");

  const { parsed, response, attempts } = await requestParsedAssessment(client, {
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
              "Genera el borrador clínico estructurado según el esquema. " +
              "Trabaja únicamente con la siguiente entrevista ficticia o previamente anonimizada:\n\n" +
              transcript.trim(),
          },
        ],
      },
    ],
    text: { format: textFormat },
  });

  const { assessment, warnings } = applyClinicalInvariants(parsed);
  const violations = collectClinicalInvariantViolations(assessment);

  return {
    assessment,
    report: renderClinicalReport(assessment),
    meta: {
      model,
      transport,
      store: false,
      structured_output_parser: "responses.parse+zod",
      structured_output_attempts: attempts,
      request_id: response?._request_id || "",
      warnings,
      invariant_violations: violations,
    },
  };
}
