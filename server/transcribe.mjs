import { resolveModelAuth } from "./model-auth.mjs";
import { normalizeMedicationAsrSegments } from "./medication-asr-normalization.mjs";

export const AUDIO_PILOT_MAX_BYTES = 3_000_000;
export const AUDIO_TRANSCRIPTION_MODEL = "gpt-4o-transcribe-diarize";

const MIME_EXTENSION = new Map([
  ["audio/webm", "webm"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/ogg", "ogg"],
  ["audio/x-m4a", "m4a"],
]);

function cleanMime(value) {
  return String(value || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function extensionForMime(mime) {
  return MIME_EXTENSION.get(cleanMime(mime)) || "webm";
}

function decodeBase64(value) {
  const text = String(value || "").trim();
  const normalized = text.includes(",") ? text.slice(text.indexOf(",") + 1) : text;
  if (!normalized || !/^[A-Za-z0-9+/=\s]+$/.test(normalized)) {
    throw new TypeError("El audio codificado no es válido.");
  }
  return Buffer.from(normalized.replace(/\s+/g, ""), "base64");
}

function normalizeSegments(response) {
  const raw = Array.isArray(response?.segments) ? response.segments : [];
  const segments = raw
    .map((segment, index) => ({
      id: String(segment?.id || `segment-${index + 1}`),
      speaker: String(segment?.speaker || "A").trim() || "A",
      start: Number.isFinite(Number(segment?.start)) ? Number(segment.start) : 0,
      end: Number.isFinite(Number(segment?.end)) ? Number(segment.end) : 0,
      text: String(segment?.text || "").trim(),
      source_order: index,
    }))
    .filter((segment) => segment.text)
    .sort((left, right) => {
      const byStart = left.start - right.start;
      if (byStart) return byStart;
      const byEnd = left.end - right.end;
      if (byEnd) return byEnd;
      return left.source_order - right.source_order;
    })
    .map(({ source_order, ...segment }) => segment);

  if (segments.length === 0 && String(response?.text || "").trim()) {
    segments.push({
      id: "segment-1",
      speaker: "A",
      start: 0,
      end: Number.isFinite(Number(response?.duration)) ? Number(response.duration) : 0,
      text: String(response.text).trim(),
    });
  }

  return segments;
}

export async function transcribeAudioPayload(payload, options = {}) {
  const mimeType = cleanMime(payload?.mime_type);
  if (!MIME_EXTENSION.has(mimeType)) {
    throw new TypeError(`Formato de audio no admitido en el piloto: ${mimeType || "desconocido"}.`);
  }

  const buffer = decodeBase64(payload?.audio_base64);
  if (buffer.length === 0) throw new TypeError("El audio está vacío.");
  if (buffer.length > AUDIO_PILOT_MAX_BYTES) {
    const error = new RangeError("El audio supera el tamaño máximo del piloto de 2 minutos.");
    error.code = "audio_too_large";
    throw error;
  }

  let client = options.client;
  let transport = client ? "injected-test-client" : "";
  let fileFactory = options.fileFactory;

  if (!client) {
    const { default: OpenAI, toFile } = await import("openai");
    const auth = await resolveModelAuth();
    if (!auth) throw new Error("No hay credenciales de modelo configuradas.");

    client = new OpenAI({
      apiKey: auth.apiKey,
      ...(auth.baseURL ? { baseURL: auth.baseURL } : {}),
    });
    transport = auth.transport;
    fileFactory = async (data, filename, mime) => toFile(data, filename, { type: mime });
  }

  if (typeof client.audio?.transcriptions?.create !== "function") {
    throw new TypeError("El cliente de modelo no expone Audio Transcriptions API.");
  }
  if (typeof fileFactory !== "function") {
    throw new TypeError("No hay un adaptador de archivo disponible para transcripción.");
  }

  const filename = `entrevista-piloto.${extensionForMime(mimeType)}`;
  const file = await fileFactory(buffer, filename, mimeType);

  const response = await client.audio.transcriptions.create({
    model: AUDIO_TRANSCRIPTION_MODEL,
    file,
    response_format: "diarized_json",
    chunking_strategy: "auto",
  });

  const rawSegments = normalizeSegments(response);
  const medicationNormalization = normalizeMedicationAsrSegments(rawSegments);
  const segments = medicationNormalization.segments;
  if (segments.length === 0) {
    if (options.allowEmptySegments === true) {
      return {
        transcript: "",
        segments: [],
        speakers: [],
        meta: {
          model: AUDIO_TRANSCRIPTION_MODEL,
          transport,
          duration_seconds: Number.isFinite(Number(response?.duration)) ? Number(response.duration) : null,
          audio_bytes: buffer.length,
          persistent_audio_storage: false,
          speaker_role_confirmation_required: false,
          chronological_segment_order_enforced: true,
          medication_asr_normalization_enabled: true,
          medication_asr_normalization_replacements: 0,
          medication_asr_normalization_aliases: [],
          silent_audio_block: true,
        },
      };
    }
    const error = new Error("La transcripción no devolvió segmentos de voz.");
    error.name = "EmptyTranscriptionError";
    throw error;
  }

  const speakers = [...new Set(segments.map((segment) => segment.speaker))];
  const transcript = segments.map((segment) => `HABLANTE ${segment.speaker}: ${segment.text}`).join("\n");

  return {
    transcript,
    segments,
    speakers,
    meta: {
      model: AUDIO_TRANSCRIPTION_MODEL,
      transport,
      duration_seconds: Number.isFinite(Number(response?.duration)) ? Number(response.duration) : null,
      audio_bytes: buffer.length,
      persistent_audio_storage: false,
      speaker_role_confirmation_required: true,
      chronological_segment_order_enforced: true,
      medication_asr_normalization_enabled: true,
      medication_asr_normalization_replacements: medicationNormalization.replacements,
      medication_asr_normalization_aliases: medicationNormalization.applied_aliases,
      silent_audio_block: false,
    },
  };
}
