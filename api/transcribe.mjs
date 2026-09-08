import { transcribeAudioPayload } from "../server/transcribe.mjs";
import { attributeClinicalSpeakerRoles } from "../server/speaker-attribution.mjs";

function setPrivacyHeaders(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export default async function handler(req, res) {
  setPrivacyHeaders(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const acoustic = await transcribeAudioPayload(body);

    try {
      const attributed = await attributeClinicalSpeakerRoles(acoustic.segments);
      return res.status(200).json({
        ...acoustic,
        acoustic_transcript: acoustic.transcript,
        transcript: attributed.transcript,
        segments: attributed.segments,
        participants: attributed.participants,
        review_items: attributed.review_items,
        attribution_meta: attributed.meta,
        meta: {
          ...acoustic.meta,
          automatic_role_attribution: true,
          role_model: attributed.meta.role_model,
          role_transport: attributed.meta.role_transport,
          role_attribution_store: false,
          critical_role_review_count: attributed.meta.critical_review_count,
          speaker_role_confirmation_required: attributed.meta.critical_review_count > 0,
        },
      });
    } catch (attributionError) {
      // La transcripción no se pierde si falla la segunda capa. Se conserva solo en la respuesta
      // efímera y se bloquea el análisis hasta que pueda resolverse la fuente.
      return res.status(200).json({
        ...acoustic,
        acoustic_transcript: acoustic.transcript,
        participants: [],
        review_items: [],
        attribution_error: {
          code: attributionError?.name || "SpeakerAttributionError",
          message: "No se pudo atribuir automáticamente el rol clínico de los interlocutores.",
        },
        meta: {
          ...acoustic.meta,
          automatic_role_attribution: false,
          speaker_role_confirmation_required: true,
        },
      });
    }
  } catch (error) {
    const status = error instanceof TypeError || error instanceof RangeError ? 400 : 502;
    return res.status(status).json({
      error: error.code || error.name || "TranscriptionError",
      message: error.message || "No se pudo transcribir el audio.",
    });
  }
}
