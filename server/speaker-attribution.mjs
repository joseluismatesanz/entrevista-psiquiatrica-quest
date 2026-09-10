import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { resolveModelAuth } from "./model-auth.mjs";

export const SPEAKER_ROLE_MODEL = "gpt-5.6-luna";

const RoleSchema = z.enum([
  "psychiatrist",
  "patient",
  "mother",
  "father",
  "sibling",
  "caregiver",
  "family",
  "nurse",
  "police",
  "security",
  "other",
  "unknown",
]);

const AttributionSchema = z.object({
  assignments: z.array(z.object({
    segment_id: z.string(),
    role: RoleSchema,
    confidence: z.enum(["high", "medium", "low"]),
  }).strict()),
}).strict();

const ROLE_LABELS = {
  psychiatrist: "PSIQUIATRA",
  patient: "PACIENTE",
  mother: "MADRE",
  father: "PADRE",
  sibling: "HERMANO/A",
  caregiver: "CUIDADOR/A",
  family: "FAMILIAR",
  nurse: "ENFERMERÍA",
  police: "POLICÍA",
  security: "SEGURIDAD",
  other: "OTRO",
  unknown: "INTERLOCUTOR_NO_IDENTIFICADO",
};

const ROLE_DISPLAY = {
  psychiatrist: "Psiquiatra",
  patient: "Paciente",
  mother: "Madre",
  father: "Padre",
  sibling: "Hermano/a",
  caregiver: "Cuidador/a",
  family: "Familiar",
  nurse: "Enfermería",
  police: "Policía",
  security: "Seguridad",
  other: "Otro",
  unknown: "No identificado",
};

const SOURCE_SENSITIVE_PATTERNS = [
  /\b(?:suicid\w*|autol\w*|autoles\w*|hacerse\s+daño|morir|muerte|matarse|cort(?:e|es|arse)|sobredosis|plan\s+suicida)\b/i,
  /\b(?:heteroagres\w*|agresi[oó]n|agredir|golpear|matar\s+a|hacer\s+daño\s+a|amenaz\w*|violencia)\b/i,
  /\b(?:tratamiento|medicaci[oó]n|f[aá]rmaco|pastill\w*|\d+(?:[.,]\d+)?\s*mg\b|dosis|adherencia|toma\w*|sertralina|lorazepam|olanzapina|risperidona|haloperidol|litio|lamotrigina)\b/i,
  /\b(?:alerg\w*|reacci[oó]n\s+adversa|ram\b|urticaria|diston[ií]a|anafilax\w*)\b/i,
  /\b(?:madre|padre|herman\w*|t[ií]o|t[ií]a|abuelo|abuela|familia)\b.*\b(?:depres\w*|bipolar|esquizofren\w*|psicos\w*|suicid\w*|alcohol\w*)\b/i,
  /\b(?:cannabis|hach[ií]s|marihuana|coca[ií]na|anfetamin\w*|speed|mdma|ketamina|alcohol|benzodiacepin\w*|t[oó]xicos|drogas)\b/i,
  /\b(?:diagn[oó]stic\w*|psicos\w*|depres\w*|man[ií]a|bipolar|ingreso|unidad\s+de\s+agudos|alta|seguimiento|plan\s+terap[eé]utico|propongo|acepta|rechaza|se\s+niega)\b/i,
];

const FILLER_WORDS = new Set([
  "pues", "bueno", "vale", "sí", "si", "no", "y", "ya", "eh", "mmm", "ajá", "aja",
]);

// Anclajes deterministas de parentesco. Una relación explícita en el diálogo tiene
// prioridad sobre etiquetas genéricas como caregiver/family y sobre una inferencia del modelo.
// No se usa voz, sexo, edad ni biometría: solo texto conversacional explícito.
const EXPLICIT_FAMILY_ROLE_RULES = [
  {
    role: "mother",
    self: /\b(?:yo\s+)?soy\s+(?:su|la)\s+madre\b/i,
    addressed: /\b(?:es\s+usted|usted\s+es)\s+(?:la|su)\s+madre\b|\busted\s+qu[eé]\s+es\s*[,;:]?\s*(?:la|su)?\s*madre\b/i,
  },
  {
    role: "father",
    self: /\b(?:yo\s+)?soy\s+(?:su|el)\s+padre\b/i,
    addressed: /\b(?:es\s+usted|usted\s+es)\s+(?:el|su)\s+padre\b|\busted\s+qu[eé]\s+es\s*[,;:]?\s*(?:el|su)?\s*padre\b/i,
  },
  {
    role: "sibling",
    self: /\b(?:yo\s+)?soy\s+(?:su|el|la)\s+herman[oa]\b/i,
    addressed: /\b(?:es\s+usted|usted\s+es)\s+(?:el|la|su)\s+herman[oa]\b|\busted\s+qu[eé]\s+es\s*[,;:]?\s*(?:el|la|su)?\s*herman[oa]\b/i,
  },
];

function isSourceSensitive(text) {
  return SOURCE_SENSITIVE_PATTERNS.some((pattern) => pattern.test(String(text || "")));
}

function normalizeSegments(segments) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment, index) => ({
      id: String(segment?.id || `segment-${index + 1}`),
      speaker: String(segment?.speaker || "?").trim() || "?",
      start: Number.isFinite(Number(segment?.start)) ? Number(segment.start) : 0,
      end: Number.isFinite(Number(segment?.end)) ? Number(segment.end) : 0,
      text: String(segment?.text || "").trim(),
    }))
    .filter((segment) => segment.text);
}

function normalizedWords(text) {
  return String(text || "")
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9áéíóúüñ]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function endsWithWords(haystack, needle) {
  if (!needle.length || needle.length > haystack.length) return false;
  const offset = haystack.length - needle.length;
  return needle.every((word, index) => haystack[offset + index] === word);
}

function startsWithWords(haystack, needle) {
  if (!needle.length || needle.length > haystack.length) return false;
  return needle.every((word, index) => haystack[index] === word);
}

function maximalSuffixPrefixOverlap(leftWords, rightWords) {
  const max = Math.min(leftWords.length, rightWords.length);
  for (let size = max; size >= 4; size -= 1) {
    const suffix = leftWords.slice(leftWords.length - size);
    const prefix = rightWords.slice(0, size);
    if (suffix.every((word, index) => word === prefix[index])) return size;
  }
  return 0;
}

function isClearDuplicateTail(previousText, currentText) {
  const previousWords = normalizedWords(previousText);
  const currentWords = normalizedWords(currentText);
  if (previousWords.length < 4 || currentWords.length < 4) return false;

  if (previousWords.length === currentWords.length
      && previousWords.every((word, index) => word === currentWords[index])) {
    return true;
  }

  if (currentWords.length <= previousWords.length && endsWithWords(previousWords, currentWords)) {
    return true;
  }

  if (previousWords.length <= currentWords.length && startsWithWords(currentWords, previousWords)) {
    const tail = currentWords.slice(previousWords.length);
    return tail.length <= 2 && tail.every((word) => FILLER_WORDS.has(word));
  }

  const overlap = maximalSuffixPrefixOverlap(previousWords, currentWords);
  if (overlap < 4) return false;
  const tail = currentWords.slice(overlap);
  return tail.length <= 2 && tail.every((word) => FILLER_WORDS.has(word));
}

export function deduplicateClearAdjacentOverlaps(inputSegments) {
  const segments = normalizeSegments(inputSegments);
  const output = [];
  let removed = 0;

  for (const segment of segments) {
    const previous = output.at(-1);
    if (previous && previous.speaker === segment.speaker && isClearDuplicateTail(previous.text, segment.text)) {
      previous.end = Math.max(previous.end, segment.end);
      previous.merged_from_ids = [...(previous.merged_from_ids || [previous.id]), segment.id];
      removed += 1;
      continue;
    }
    output.push({ ...segment });
  }

  return { segments: output, removed };
}

function buildPromptInput(segments) {
  return JSON.stringify(segments.map((segment) => ({
    segment_id: segment.id,
    acoustic_speaker: segment.speaker,
    text: segment.text,
  })));
}

function clinicalRoleInstructions() {
  return `Eres un clasificador de interlocutores de una entrevista psiquiátrica transcrita. Debes atribuir un ROL CLÍNICO a cada segmento usando el contenido verbal, el orden de turnos y la etiqueta acústica solo como una pista secundaria.

REGLAS CRÍTICAS:
- La diarización acústica puede fusionar personas distintas bajo la misma letra. Por tanto, dos segmentos con acoustic_speaker=B PUEDEN pertenecer a roles humanos diferentes.
- No hagas biometría de voz ni infieras identidad por sexo, edad aparente, acento o timbre. Solo usa el texto y la estructura conversacional.
- psychiatrist: preguntas clínicas, exploración, síntesis/observaciones del clínico, propuestas y plan.
- patient: habla en primera persona sobre sus propios síntomas, historia, consumo, tratamiento o experiencia.
- mother/father/sibling/caregiver/family: información colateral sobre el paciente. Usa mother/father/etc. solo si el diálogo lo hace explícito; si solo consta que es un familiar, usa family.
- Si el psiquiatra identifica explícitamente al siguiente interlocutor como madre/padre/hermano (p. ej. «¿usted es su madre?» o «¿y usted qué es, su madre?»), el turno de respuesta debe conservar ese parentesco; NUNCA lo rebajes a caregiver/family.
- Si una persona dice explícitamente «soy su madre/padre/hermano», conserva ese parentesco y no lo sustituyas por caregiver/family.
- nurse/police/security: solo cuando el contenido o contexto lo haga explícito.
- unknown: cuando no pueda distinguirse razonablemente la fuente.
- confidence=high solo con evidencia contextual clara; medium cuando es probable pero no inequívoco; low cuando es débil.
- No diagnostiques, no resumas y no cambies el contenido. Devuelve exactamente una asignación por segment_id.`;
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

function explicitFamilyRoleFromOwnText(text, proposedRole) {
  if (!["mother", "father", "sibling", "caregiver", "family", "other", "unknown"].includes(proposedRole)) return null;
  const rule = EXPLICIT_FAMILY_ROLE_RULES.find((candidate) => candidate.self.test(String(text || "")));
  return rule?.role || null;
}

function explicitFamilyRoleFromPriorClinicianTurn(segments, index, assignments) {
  if (index <= 0) return null;
  const previous = segments[index - 1];
  const previousAssignment = assignments.get(previous.id);
  if (previousAssignment?.role !== "psychiatrist") return null;
  const rule = EXPLICIT_FAMILY_ROLE_RULES.find((candidate) => candidate.addressed.test(previous.text));
  return rule?.role || null;
}

function anchoredFamilyRole(segments, index, assignments, proposedRole) {
  const own = explicitFamilyRoleFromOwnText(segments[index]?.text, proposedRole);
  if (own) return own;
  if (proposedRole === "psychiatrist") return null;
  return explicitFamilyRoleFromPriorClinicianTurn(segments, index, assignments);
}

async function resolveClient(options = {}) {
  if (options.client) {
    return { client: options.client, transport: "injected-test-client", model: options.model || SPEAKER_ROLE_MODEL };
  }

  const { default: OpenAI } = await import("openai");
  const auth = await resolveModelAuth();
  if (!auth) throw new Error("No hay credenciales de modelo configuradas para atribuir interlocutores.");

  return {
    client: new OpenAI({ apiKey: auth.apiKey, ...(auth.baseURL ? { baseURL: auth.baseURL } : {}) }),
    transport: auth.transport,
    // Clasificación estrecha: modelo rápido dedicado, sin heredar el modelo clínico principal.
    model: options.model || process.env.SPEAKER_ROLE_MODEL || SPEAKER_ROLE_MODEL,
  };
}

export async function attributeClinicalSpeakerRoles(inputSegments, options = {}) {
  const deduplication = deduplicateClearAdjacentOverlaps(inputSegments);
  const segments = deduplication.segments;
  if (!segments.length) throw new TypeError("No hay segmentos para atribuir interlocutores.");

  const { client, transport, model } = await resolveClient(options);
  if (typeof client.responses?.parse !== "function") {
    throw new TypeError("El cliente de modelo no expone Responses.parse para atribución de interlocutores.");
  }

  const format = zodTextFormat(AttributionSchema, "clinical_speaker_roles_v054");
  const response = await client.responses.parse({
    model,
    store: false,
    background: false,
    reasoning: { effort: "low" },
    max_output_tokens: Math.max(1800, Math.min(12000, segments.length * 90)),
    instructions: clinicalRoleInstructions(),
    input: [{
      role: "user",
      content: [{
        type: "input_text",
        text: `Atribuye el rol clínico de cada segmento. Segmentos JSON:\n${buildPromptInput(segments)}`,
      }],
    }],
    text: { format },
  });

  if (response.status !== "completed") {
    throw new Error(`Atribución de interlocutores incompleta: ${response.status}`);
  }

  const parsed = extractParsed(response);
  if (!parsed) throw new Error("No se obtuvo una atribución estructurada de interlocutores.");

  const byId = new Map((parsed.assignments || []).map((item) => [String(item.segment_id), item]));
  let explicitFamilyRoleAnchors = 0;
  const attributedSegments = segments.map((segment, index) => {
    const assignment = byId.get(segment.id) || { role: "unknown", confidence: "low" };
    const proposedRole = ROLE_LABELS[assignment.role] ? assignment.role : "unknown";
    const anchoredRole = anchoredFamilyRole(segments, index, byId, proposedRole);
    const role = anchoredRole || proposedRole;
    const confidence = anchoredRole ? "high" : (["high", "medium", "low"].includes(assignment.confidence) ? assignment.confidence : "low");
    if (anchoredRole && anchoredRole !== proposedRole) explicitFamilyRoleAnchors += 1;
    const sourceSensitive = isSourceSensitive(segment.text);
    const reviewRequired = sourceSensitive && (role === "unknown" || confidence !== "high");
    return {
      ...segment,
      acoustic_speaker: segment.speaker,
      role,
      role_label: ROLE_LABELS[role],
      role_display: ROLE_DISPLAY[role],
      role_confidence: confidence,
      role_anchor: anchoredRole ? "explicit_family_relationship" : "",
      source_sensitive: sourceSensitive,
      review_required: reviewRequired,
    };
  });

  const participantRoles = [...new Set(attributedSegments.map((segment) => segment.role).filter((role) => role !== "unknown"))];
  const reviewItems = attributedSegments
    .filter((segment) => segment.review_required)
    .map((segment) => ({
      segment_id: segment.id,
      text: segment.text,
      suggested_role: segment.role,
      confidence: segment.role_confidence,
      acoustic_speaker: segment.acoustic_speaker,
    }));

  const transcript = attributedSegments
    .map((segment) => `${segment.role_label}: ${segment.text}`)
    .join("\n");

  return {
    transcript,
    segments: attributedSegments,
    participants: participantRoles.map((role) => ({ role, label: ROLE_DISPLAY[role] })),
    review_items: reviewItems,
    meta: {
      automatic_role_attribution: true,
      role_model: model,
      role_transport: transport,
      store: false,
      abstention_enabled: true,
      critical_review_count: reviewItems.length,
      explicit_family_role_anchors: explicitFamilyRoleAnchors,
      deduplicated_overlap_segments: deduplication.removed,
      request_id: response?._request_id || "",
    },
  };
}

export function applyReviewedSpeakerRoles(attributedSegments, corrections = {}) {
  const segments = normalizeSegments(attributedSegments).map((base) => {
    const original = (attributedSegments || []).find((item) => String(item?.id) === base.id) || {};
    const correctedRole = corrections[base.id];
    const role = ROLE_LABELS[correctedRole] ? correctedRole : (ROLE_LABELS[original.role] ? original.role : "unknown");
    return {
      ...original,
      ...base,
      acoustic_speaker: original.acoustic_speaker || base.speaker,
      role,
      role_label: ROLE_LABELS[role],
      role_display: ROLE_DISPLAY[role],
      role_confidence: correctedRole ? "human_confirmed" : (original.role_confidence || "low"),
      review_required: false,
    };
  });

  return {
    segments,
    transcript: segments.map((segment) => `${segment.role_label}: ${segment.text}`).join("\n"),
  };
}
