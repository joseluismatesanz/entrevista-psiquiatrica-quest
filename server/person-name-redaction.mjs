import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { resolveModelAuth } from "./model-auth.mjs";

export const PERSON_NAME_MASK = "XXXXXXXXXXX";
export const PERSON_NAME_REDACTION_MODEL = "gpt-5.6-luna";

const RedactionItemSchema = z.object({
  segment_id: z.string(),
  redacted_text: z.string(),
  replacements: z.number().int().min(0),
  residual_person_name: z.boolean(),
}).strict();

const RedactionSchema = z.object({
  items: z.array(RedactionItemSchema),
}).strict();

function normalizeSegments(inputSegments) {
  return (Array.isArray(inputSegments) ? inputSegments : [])
    .map((segment, index) => ({
      ...segment,
      id: String(segment?.id || `segment-${index + 1}`),
      text: String(segment?.text || "").trim(),
    }))
    .filter((segment) => segment.text);
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
  if (options.client) {
    return {
      client: options.client,
      transport: "injected-test-client",
      model: options.model || PERSON_NAME_REDACTION_MODEL,
    };
  }

  const { default: OpenAI } = await import("openai");
  const auth = await resolveModelAuth();
  if (!auth) throw new Error("No hay credenciales configuradas para desidentificar la transcripción.");

  return {
    client: new OpenAI({ apiKey: auth.apiKey, ...(auth.baseURL ? { baseURL: auth.baseURL } : {}) }),
    transport: auth.transport,
    model: options.model || process.env.PERSON_NAME_REDACTION_MODEL || PERSON_NAME_REDACTION_MODEL,
  };
}

function redactionInstructions() {
  return `Tu única tarea es DESIDENTIFICAR nombres propios de PERSONAS en fragmentos de una entrevista clínica en español.

REGLAS OBLIGATORIAS:
- Sustituye cada nombre, apellido, nombre compuesto, apodo identificativo o nombre de profesional/tercero por exactamente: ${PERSON_NAME_MASK}
- Si aparece un nombre completo de varias palabras, sustituye el conjunto completo por un solo ${PERSON_NAME_MASK}.
- Incluye nombres de paciente, familiares, psiquiatras, médicos, profesores, amistades y cualquier otra persona.
- Conserva títulos o roles: "Dra. García" -> "Dra. ${PERSON_NAME_MASK}"; "mi hija Ana" -> "mi hija ${PERSON_NAME_MASK}".
- NO sustituyas parentescos o roles genéricos como madre, padre, paciente, psiquiatra, enfermera.
- NO sustituyas medicamentos, diagnósticos, hospitales, centros sanitarios, ciudades, países, calles, organismos, marcas ni fechas.
- No resumas, no corrijas, no reformules y no cambies ninguna otra palabra.
- Si el texto ya contiene ${PERSON_NAME_MASK}, consérvalo exactamente y no lo cuentes como una nueva sustitución.
- residual_person_name debe ser true si después de tu redacción queda algún nombre o apellido de persona explícito en redacted_text. Debe ser false solo si no queda ninguno.
- Devuelve exactamente un item por segment_id y nunca devuelvas los nombres originales en campos auxiliares.`;
}

function chunkSegments(segments, maxChars = 24_000) {
  const chunks = [];
  let current = [];
  let chars = 0;

  for (const segment of segments) {
    const size = segment.text.length + 80;
    if (current.length && chars + size > maxChars) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(segment);
    chars += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function redactBatch(batch, runtime) {
  const format = zodTextFormat(RedactionSchema, "person_name_redaction_v056");
  const input = batch.map((segment) => ({ segment_id: segment.id, text: segment.text }));

  const response = await runtime.client.responses.parse({
    model: runtime.model,
    store: false,
    background: false,
    reasoning: { effort: "none" },
    max_output_tokens: Math.max(1200, Math.min(12000, batch.length * 190)),
    instructions: redactionInstructions(),
    input: [{
      role: "user",
      content: [{
        type: "input_text",
        text: `Desidentifica únicamente nombres de personas. Fragmentos JSON:\n${JSON.stringify(input)}`,
      }],
    }],
    text: { format },
  });

  if (response.status !== "completed") {
    throw new Error(`Desidentificación incompleta: ${response.status}`);
  }

  const parsed = extractParsed(response);
  if (!parsed) throw new Error("No se obtuvo una respuesta estructurada de desidentificación.");

  const byId = new Map();
  for (const item of parsed.items || []) {
    if (byId.has(item.segment_id)) throw new Error("La desidentificación devolvió identificadores duplicados.");
    byId.set(String(item.segment_id), item);
  }

  if (byId.size !== batch.length) {
    throw new Error("La desidentificación no devolvió todos los fragmentos.");
  }

  return batch.map((segment) => {
    const item = byId.get(segment.id);
    if (!item || item.residual_person_name) {
      throw new Error("No se pudo verificar la eliminación de nombres personales en la transcripción.");
    }
    const text = String(item.redacted_text || "").trim();
    if (!text) throw new Error("La desidentificación devolvió un fragmento vacío.");
    return {
      ...segment,
      text,
      person_name_replacements: Number(item.replacements) || 0,
    };
  });
}

export async function redactPersonNamesInSegments(inputSegments, options = {}) {
  const segments = normalizeSegments(inputSegments);
  if (!segments.length) throw new TypeError("No hay texto para desidentificar.");

  const runtime = await resolveClient(options);
  if (typeof runtime.client.responses?.parse !== "function") {
    throw new TypeError("El cliente de modelo no expone Responses.parse para desidentificación.");
  }

  const redactedSegments = [];
  for (const batch of chunkSegments(segments)) {
    redactedSegments.push(...await redactBatch(batch, runtime));
  }

  const replacements = redactedSegments.reduce((total, segment) => total + (segment.person_name_replacements || 0), 0);
  const transcript = redactedSegments
    .map((segment) => `${segment.role_label || `HABLANTE ${segment.speaker || "?"}`}: ${segment.text}`)
    .join("\n");

  return {
    segments: redactedSegments,
    transcript,
    replacements,
    meta: {
      enabled: true,
      mask: PERSON_NAME_MASK,
      model: runtime.model,
      transport: runtime.transport,
      store: false,
      fail_closed: true,
    },
  };
}

export async function redactPersonNamesInTranscript(inputTranscript, options = {}) {
  const transcript = String(inputTranscript || "").trim();
  if (!transcript) throw new TypeError("No hay transcripción para desidentificar.");

  const lines = transcript.split(/\r?\n/);
  const segments = lines
    .map((text, index) => ({ id: `line-${index + 1}`, speaker: "LINE", text }))
    .filter((segment) => segment.text.trim());

  const result = await redactPersonNamesInSegments(segments, options);
  const byId = new Map(result.segments.map((segment) => [segment.id, segment.text]));
  const redactedTranscript = lines
    .map((line, index) => line.trim() ? (byId.get(`line-${index + 1}`) || line) : line)
    .join("\n");

  return {
    transcript: redactedTranscript,
    replacements: result.replacements,
    meta: result.meta,
  };
}
