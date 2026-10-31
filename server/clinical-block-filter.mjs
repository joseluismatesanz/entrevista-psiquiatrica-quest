import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { resolveModelAuth } from "./model-auth.mjs";

export const CLINICAL_BLOCK_FILTER_MODEL = "gpt-5.6-luna";

const SelectionSchema = z.object({
  keep_indices: z.array(z.number().int().min(0)).max(200),
}).strict();

const MUST_KEEP_PATTERNS = [
  /\b(?:suicid\w*|autoles\w*|autol[ií]tic\w*|matarse|morir|hacerse\s+daño|sobredosis)\b/i,
  /\b(?:alucin\w*|delir\w*|psicos\w*|paranoi\w*|voces|agresi[oó]n|violencia|amenaz\w*)\b/i,
  /\b(?:medicaci[oó]n|tratamiento|f[aá]rmaco\w*|pastill\w*|sertralina|lorazepam|risperidona|olanzapina|haloperidol|litio|lamotrigina|\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|ml|ui))\b/i,
  /\b(?:alerg\w*|ram\b|reacci[oó]n\s+adversa|cannabis|alcohol|coca[ií]na|drogas)\b/i,
  /\b(?:madre|padre|herman[oa]|cuidador\w*|familia\w*|conviv\w*|colegio|instituto|trabajo)\b/i,
  /\b(?:duerm\w*|sueñ\w*|apetit\w*|nervios\w*|triste\w*|irritab\w*|ansiedad|[aá]nimo)\b/i,
  /\b(?:diagn[oó]stic\w*|ingreso|alta|seguimiento|propongo|acepta|rechaza|plan|exploraci[oó]n)\b/i,
  /^PSIQUIATRA:\s*(?:soy|me llamo|mi nombre)/i,
];

function splitLines(transcript) {
  return String(transcript || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function mustKeepIndices(lines) {
  const keep = new Set();
  lines.forEach((line, index) => {
    if (MUST_KEEP_PATTERNS.some((pattern) => pattern.test(line))) keep.add(index);
  });
  return keep;
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

async function resolveClient(options = {}) {
  if (options.client) return { client: options.client, model: options.model || CLINICAL_BLOCK_FILTER_MODEL, transport: "injected-test-client" };
  const { default: OpenAI } = await import("openai");
  const auth = await resolveModelAuth();
  if (!auth) throw new Error("No hay credenciales para el filtrado clínico incremental.");
  return {
    client: new OpenAI({ apiKey: auth.apiKey, ...(auth.baseURL ? { baseURL: auth.baseURL } : {}) }),
    model: options.model || process.env.CLINICAL_BLOCK_FILTER_MODEL || CLINICAL_BLOCK_FILTER_MODEL,
    transport: auth.transport,
  };
}

export async function filterClinicalBlockTranscript(transcript, options = {}) {
  const lines = splitLines(transcript);
  if (!lines.length) throw new TypeError("El bloque no contiene texto clínico utilizable.");

  const required = mustKeepIndices(lines);
  if (lines.length <= 3) {
    return {
      clinical_transcript: lines.join("\n"),
      kept_indices: lines.map((_, index) => index),
      meta: { model: "deterministic-short-block", transport: "local", store: false, conservative: true },
    };
  }

  const runtime = await resolveClient(options);
  const numbered = lines.map((line, index) => `${index}\t${line}`).join("\n");
  const response = await runtime.client.responses.parse({
    model: runtime.model,
    store: false,
    background: false,
    reasoning: { effort: "none" },
    max_output_tokens: 1200,
    instructions: `Selecciona de un bloque YA DESIDENTIFICADO de entrevista psiquiátrica las líneas que deben conservarse para construir después un borrador clínico.\n\nREGLA: sé conservador. Si dudas, CONSERVA la línea. No diagnostiques, no resumas, no reformules y no inventes. Devuelve únicamente índices.\n\nCONSERVA cualquier línea que pueda aportar: motivo, síntomas, cronología, intensidad, repercusión funcional, sueño/apetito, riesgo autolítico o heteroagresivo, sustancias, medicación/adherencia/efectos adversos, alergias, antecedentes somáticos o psiquiátricos, antecedentes familiares, situación sociofamiliar/escolar/laboral, observaciones del psiquiatra, exploración psicopatológica, diagnóstico expresado explícitamente, pruebas, intervención/propuesta y respuesta, plan, ingreso/alta/seguimiento.\n\nEXCLUYE solo saludos, despedidas, agradecimientos, muletillas o preguntas/respuestas puramente conversacionales sin información clínica.`,
    input: [{ role: "user", content: [{ type: "input_text", text: numbered }] }],
    text: { format: zodTextFormat(SelectionSchema, "clinical_block_selection_v06") },
  });

  if (response.status !== "completed") throw new Error(`Filtrado clínico incremental incompleto: ${response.status}`);
  const parsed = extractParsed(response);
  if (!parsed) throw new Error("No se obtuvo una selección clínica estructurada.");

  const selected = new Set(required);
  for (const rawIndex of parsed.keep_indices || []) {
    const index = Number(rawIndex);
    if (Number.isInteger(index) && index >= 0 && index < lines.length) selected.add(index);
  }

  // Fail-safe de documentación: si el clasificador fuera excesivamente agresivo,
  // conservar al menos la mitad del bloque en lugar de perder evidencia clínica.
  if (selected.size < Math.ceil(lines.length / 2)) {
    lines.forEach((_, index) => selected.add(index));
  }

  const kept = [...selected].sort((a, b) => a - b);
  return {
    clinical_transcript: kept.map((index) => lines[index]).join("\n"),
    kept_indices: kept,
    meta: {
      model: runtime.model,
      transport: runtime.transport,
      store: false,
      conservative: true,
      original_lines: lines.length,
      kept_lines: kept.length,
      request_id: response?._request_id || "",
    },
  };
}
