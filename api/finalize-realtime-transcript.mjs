import { redactAndAttributeSegments } from "../server/privacy-attribution.mjs";
import { redactPersonNamesInSegments } from "../server/person-name-redaction.mjs";
import { attributeClinicalSpeakerRoles } from "../server/speaker-attribution.mjs";
import { createPrivacyProof } from "../server/privacy-proof.mjs";

const REALTIME_TRANSCRIPTION_MODEL = "gpt-live-transcribe";
const MAX_SEGMENTS = 300;
const MAX_TRANSCRIPT_CHARS = 100_000;

function setPrivacyHeaders(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function normalizeRealtimeSegments(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_SEGMENTS) {
    throw new TypeError("La transcripción en tiempo real no contiene segmentos válidos.");
  }

  let totalChars = 0;
  const segments = input.map((segment, index) => {
    const text = String(segment?.text || "").trim();
    if (!text || text.length > 4_000) throw new TypeError("Un segmento de transcripción no es válido.");
    totalChars += text.length;
    if (totalChars > MAX_TRANSCRIPT_CHARS) throw new RangeError("La transcripción supera el tamaño permitido.");

    const start = Number(segment?.start);
    const end = Number(segment?.end);
    return {
      id: `rt-${index + 1}`,
      // Realtime live transcription no aporta identidad acústica. Una etiqueta neutra evita
      // convertir el orden de los turnos en una falsa identidad de voz.
      speaker: "RT",
      start: Number.isFinite(start) && start >= 0 ? start : index,
      end: Number.isFinite(end) && end >= 0 ? end : index,
      text,
    };
  });

  return segments;
}

export default async function handler(req, res) {
  setPrivacyHeaders(res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const totalStartedAt = Date.now();
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const rawSegments = normalizeRealtimeSegments(body.segments);

    const privatePassStartedAt = Date.now();
    let processed;
    let fallbackUsed = false;
    try {
      processed = await redactAndAttributeSegments(rawSegments);
    } catch {
      fallbackUsed = true;
      const redaction = await redactPersonNamesInSegments(rawSegments);
      const attributed = await attributeClinicalSpeakerRoles(redaction.segments);
      processed = {
        transcript: attributed.transcript,
        segments: attributed.segments,
        participants: attributed.participants,
        review_items: attributed.review_items,
        replacements: redaction.replacements,
        meta: {
          model: `${redaction.meta.model}+${attributed.meta.role_model}`,
          transport: attributed.meta.role_transport,
          store: false,
          mask: redaction.meta.mask,
          fail_closed: true,
          automatic_role_attribution: true,
          critical_review_count: attributed.meta.critical_review_count,
        },
      };
    }
    const privatePassMs = Date.now() - privatePassStartedAt;
    const privacyProof = createPrivacyProof(processed.transcript);

    return res.status(200).json({
      transcript: processed.transcript,
      acoustic_transcript: processed.segments.map((s) => `HABLANTE RT: ${s.text}`).join("\n"),
      segments: processed.segments,
      speakers: ["RT"],
      participants: processed.participants,
      review_items: processed.review_items,
      ...(privacyProof ? { privacy_proof: privacyProof } : {}),
      meta: {
        model: REALTIME_TRANSCRIPTION_MODEL,
        transport: "openai-realtime-webrtc",
        persistent_audio_storage: false,
        realtime_transcription: true,
        transcription_during_recording: true,
        person_name_redaction_enabled: true,
        person_name_redaction_mask: processed.meta.mask,
        person_name_redaction_replacements: processed.replacements,
        person_name_redaction_store: false,
        person_name_redaction_fail_closed: true,
        automatic_role_attribution: true,
        role_model: processed.meta.model,
        role_transport: processed.meta.transport,
        role_attribution_store: false,
        critical_role_review_count: processed.meta.critical_review_count,
        speaker_role_confirmation_required: processed.meta.critical_review_count > 0,
        combined_privacy_attribution: !fallbackUsed,
        signed_privacy_proof_issued: Boolean(privacyProof),
        performance_ms: {
          transcription: 0,
          privacy_and_speaker_attribution: privatePassMs,
          total_audio_pipeline: Date.now() - totalStartedAt,
        },
      },
    });
  } catch (error) {
    const status = error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError ? 400 : 502;
    return res.status(status).json({
      error: error.code || error.name || "RealtimeFinalizationError",
      message: status === 400
        ? (error.message || "La transcripción en tiempo real no es válida.")
        : "No se pudo verificar la transcripción en tiempo real; se utilizará el modo compatible.",
    });
  }
}
