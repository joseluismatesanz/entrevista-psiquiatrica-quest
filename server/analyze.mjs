import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_PROMPT } from "./prompt.mjs";
import { applyClinicalInvariants, collectClinicalInvariantViolations } from "./clinical-invariants.mjs";
import { renderClinicalReport } from "./render-report.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "..", "schemas", "clinical-assessment-v04.schema.json");

let schemaPromise;
async function loadSchema() {
  if (!schemaPromise) {
    schemaPromise = fs.readFile(schemaPath, "utf8").then((raw) => {
      const schema = JSON.parse(raw);
      // $schema es útil en el repositorio, pero no es necesario en el formato enviado al modelo.
      delete schema.$schema;
      return schema;
    });
  }
  return schemaPromise;
}

function extractRefusal(response) {
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "refusal") return content.refusal || "Solicitud rechazada por el modelo.";
    }
  }
  return "";
}

export async function analyzeTranscript(transcript, options = {}) {
  if (typeof transcript !== "string" || transcript.trim().length < 20) {
    throw new TypeError("La transcripción debe contener texto suficiente para analizar.");
  }

  const schema = await loadSchema();
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

  const response = await client.responses.create({
    model,
    store: false,
    background: false,
    reasoning: { effort: "medium" },
    max_output_tokens: 16000,
    instructions: SYSTEM_PROMPT,
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
    text: {
      format: {
        type: "json_schema",
        name: "psychiatric_assessment_v04",
        strict: true,
        schema,
      },
    },
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
  if (!response.output_text) {
    throw new Error("El modelo no devolvió contenido estructurado.");
  }

  let parsed;
  try {
    parsed = JSON.parse(response.output_text);
  } catch (cause) {
    const error = new Error("No se pudo interpretar el JSON estructurado devuelto por el modelo.");
    error.cause = cause;
    throw error;
  }

  const { assessment, warnings } = applyClinicalInvariants(parsed);
  const violations = collectClinicalInvariantViolations(assessment);

  return {
    assessment,
    report: renderClinicalReport(assessment),
    meta: {
      model,
      transport,
      store: false,
      warnings,
      invariant_violations: violations,
    },
  };
}
