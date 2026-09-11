import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { resolveModelAuth } from "./model-auth.mjs";
import { PERSON_NAME_MASK } from "./person-name-redaction.mjs";
import { deduplicateClearAdjacentOverlaps } from "./speaker-attribution.mjs";
import { anchorExplicitFamilyRole } from "./family-role-anchor.mjs";

export const PRIVACY_ATTRIBUTION_MODEL = "gpt-5.6-luna";

const RoleSchema = z.enum([
  "psychiatrist", "patient", "mother", "father", "sibling", "caregiver",
  "family", "nurse", "police", "security", "other", "unknown",
]);

const CombinedSchema = z.object({
  items: z.array(z.object({
    segment_id: z.string(),
    redacted_text: z.string(),
    replacements: z.number().int().min(0),
    residual_person_name: z.boolean(),
    role: RoleSchema,
    confidence: z.enum(["high", "medium", "low"]),
  }).strict()),
}).strict();

const ROLE_LABELS = {
  psychiatrist: "PSIQUIATRA", patient: "PACIENTE", mother: "MADRE", father: "PADRE",
  sibling: "HERMANO/A", caregiver: "CUIDADOR/A", family: "FAMILIAR", nurse: "ENFERMERÍA",
  police: "POLICÍA", security: "SEGURIDAD", other: "OTRO", unknown: "INTERLOCUTOR_NO_IDENTIFICADO",
};
const ROLE_DISPLAY = {
  psychiatrist: "Psiquiatra", patient: "Paciente", mother: "Madre", father: "Padre",
  sibling: "Hermano/a", caregiver: "Cuidador/a", family: "Familiar", nurse: "Enfermería",
  police: "Policía", security: "Seguridad", other: "Otro", unknown: "No identificado",
};

const SOURCE_SENSITIVE_PATTERNS = [
  /\b(?:suicid\w*|autol\w*|autoles\w*|hacerse\s+daño|morir|muerte|matarse|cort(?:e|es|arse)|sobredosis|plan\s+suicida)\b/i,
  /\b(?:heteroagres\w*|agresi[oó]n|agredir|golpear|amenaz\w*|violencia)\b/i,
  /\b(?:tratamiento|medicaci[oó]n|f[aá]rmaco|pastill\w*|\d+(?:[.,]\d+)?\s*mg\b|dosis|adherencia|sertralina|lorazepam|olanzapina|risperidona|haloperidol|litio|lamotrigina)\b/i,
  /\b(?:alerg\w*|reacci[oó]n\s+adversa|ram\b|urticaria|diston[ií]a|anafilax\w*)\b/i,
  /\b(?:cannabis|hach[ií]s|marihuana|coca[ií]na|anfetamin\w*|speed|mdma|ketamina|alcohol|benzodiacepin\w*|drogas)\b/i,
  /\b(?:diagn[oó]stic\w*|psicos\w*|depres\w*|man[ií]a|bipolar|ingreso|plan\s+terap[eé]utico|propongo|acepta|rechaza)\b/i,
];

function isSourceSensitive(text) {
  return SOURCE_SENSITIVE_PATTERNS.some((pattern) => pattern.test(String(text || "")));
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

function priorContext(options = {}) {
  return String(options.previousSafeContext || "").trim().slice(-2400);
}

async function resolveClient(options = {}) {
  if (options.client) return { client: options.client, transport: "injected-test-client", model: options.model || PRIVACY_ATTRIBUTION_MODEL };
  const { default: OpenAI } = await import("openai");
  const auth = await resolveModelAuth();
  if (!auth) throw new Error("No hay credenciales para el procesamiento privado de la transcripción.");
  return {
    client: new OpenAI({ apiKey: auth.apiKey, ...(auth.baseURL ? { baseURL: auth.baseURL } : {}) }),
    transport: auth.transport,
    model: options.model || process.env.PRIVACY_ATTRIBUTION_MODEL || PRIVACY_ATTRIBUTION_MODEL,
  };
}

function instructions() {
  return `Procesa segmentos de una entrevista psiquiátrica realizando DOS tareas en la MISMA respuesta: desidentificar nombres de PERSONAS y atribuir rol clínico.

PRIVACIDAD OBLIGATORIA:
- Sustituye cada nombre, apellido, nombre compuesto, apodo identificativo o nombre de profesional/tercero por exactamente ${PERSON_NAME_MASK}.
- Un nombre completo de varias palabras se sustituye por un solo ${PERSON_NAME_MASK}.
- Conserva roles/títulos: "Dra. García" -> "Dra. ${PERSON_NAME_MASK}".
- NO sustituyas medicamentos, diagnósticos, hospitales, centros, ciudades, países, calles, organismos, marcas ni fechas.
- No reformules ninguna otra palabra.
- residual_person_name=true si queda cualquier nombre/apellido de persona explícito. Si ocurre, la aplicación bloqueará la salida.

ATRIBUCIÓN:
- Usa contenido verbal, orden de turnos y acoustic_speaker solo como pista secundaria; una misma letra acústica puede contener personas distintas.
- psychiatrist: preguntas/exploración/síntesis/plan del clínico; patient: primera persona sobre síntomas/historia propia.
- mother/father/sibling/caregiver/family solo si el contexto lo hace explícito.
- Si el psiquiatra identifica explícitamente al siguiente interlocutor como madre/padre/hermano, conserva ese parentesco; nunca lo rebajes a caregiver/family.
- Si una persona dice explícitamente "soy su madre/padre/hermano", conserva ese parentesco.
- Si se aporta CONTEXTO PREVIO DESIDENTIFICADO, úsalo solo para mantener continuidad de interlocutores entre bloques. No lo copies, no lo resumas y no lo devuelvas: la salida debe contener exclusivamente los segmentos actuales.
- nurse/police/security solo si es explícito; unknown si no puede saberse razonablemente.
- confidence=high solo con evidencia contextual clara.
- No diagnostiques ni resumas.
- Devuelve exactamente un item por segment_id y nunca devuelvas los nombres originales en campos auxiliares.`;
}

export async function redactAndAttributeSegments(inputSegments, options = {}) {
  const deduplication = deduplicateClearAdjacentOverlaps(inputSegments);
  const segments = deduplication.segments;
  if (!segments.length) throw new TypeError("No hay segmentos para procesar.");
  const runtime = await resolveClient(options);
  const format = zodTextFormat(CombinedSchema, "privacy_attribution_v056");
  const context = priorContext(options);
  const inputText = `${context ? `CONTEXTO PREVIO DESIDENTIFICADO (solo referencia de continuidad):\n${context}\n\n` : ""}Segmentos JSON:\n${JSON.stringify(segments.map((s) => ({ segment_id: s.id, acoustic_speaker: s.speaker, text: s.text })))}`;
  const response = await runtime.client.responses.parse({
    model: runtime.model,
    store: false,
    background: false,
    reasoning: { effort: "none" },
    max_output_tokens: Math.max(1200, Math.min(12000, segments.length * 170)),
    instructions: instructions(),
    input: [{ role: "user", content: [{ type: "input_text", text: inputText }] }],
    text: { format },
  });
  if (response.status !== "completed") throw new Error(`Procesamiento privado incompleto: ${response.status}`);
  const parsed = extractParsed(response);
  if (!parsed) throw new Error("No se obtuvo una salida estructurada del procesamiento privado.");
  const byId = new Map((parsed.items || []).map((item) => [String(item.segment_id), item]));
  if (byId.size !== segments.length) throw new Error("El procesamiento privado no devolvió todos los segmentos.");

  let replacements = 0;
  let explicitFamilyRoleAnchors = 0;
  const attributedSegments = segments.map((segment, index) => {
    const item = byId.get(segment.id);
    if (!item || item.residual_person_name) throw new Error("No se pudo verificar la eliminación de nombres personales.");
    const text = String(item.redacted_text || "").trim();
    if (!text) throw new Error("La desidentificación devolvió un fragmento vacío.");
    replacements += Number(item.replacements) || 0;

    const proposedRole = ROLE_LABELS[item.role] ? item.role : "unknown";
    const previousItem = index > 0 ? byId.get(segments[index - 1].id) : null;
    const role = anchorExplicitFamilyRole({
      segments,
      index,
      proposedRole,
      previousRole: previousItem?.role,
    });
    if (role !== proposedRole) explicitFamilyRoleAnchors += 1;

    const confidence = role !== proposedRole
      ? "high"
      : (["high", "medium", "low"].includes(item.confidence) ? item.confidence : "low");
    const sourceSensitive = isSourceSensitive(text);
    return {
      ...segment,
      text,
      person_name_replacements: Number(item.replacements) || 0,
      acoustic_speaker: segment.speaker,
      role,
      role_label: ROLE_LABELS[role],
      role_display: ROLE_DISPLAY[role],
      role_confidence: confidence,
      source_sensitive: sourceSensitive,
      review_required: sourceSensitive && (role === "unknown" || confidence !== "high"),
    };
  });

  const participants = [...new Set(attributedSegments.map((s) => s.role).filter((r) => r !== "unknown"))]
    .map((role) => ({ role, label: ROLE_DISPLAY[role] }));
  const reviewItems = attributedSegments.filter((s) => s.review_required).map((s) => ({
    segment_id: s.id, text: s.text, suggested_role: s.role, confidence: s.role_confidence, acoustic_speaker: s.acoustic_speaker,
  }));
  const transcript = attributedSegments.map((s) => `${s.role_label}: ${s.text}`).join("\n");

  return {
    transcript,
    segments: attributedSegments,
    participants,
    review_items: reviewItems,
    replacements,
    meta: {
      model: runtime.model,
      transport: runtime.transport,
      store: false,
      mask: PERSON_NAME_MASK,
      fail_closed: true,
      automatic_role_attribution: true,
      critical_review_count: reviewItems.length,
      explicit_family_role_anchors: explicitFamilyRoleAnchors,
      previous_safe_context_used: Boolean(context),
      deduplicated_overlap_segments: deduplication.removed,
      request_id: response?._request_id || "",
    },
  };
}
