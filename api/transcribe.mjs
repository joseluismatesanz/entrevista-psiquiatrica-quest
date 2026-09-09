import { transcribeAudioPayload } from "../server/transcribe.mjs";
import { attributeClinicalSpeakerRoles } from "../server/speaker-attribution.mjs";
import { redactPersonNamesInSegments } from "../server/person-name-redaction.mjs";

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

    // Privacidad por diseño: antes de devolver o analizar cualquier texto procedente
    // del audio, se sustituyen los nombres/apellidos de personas por XXXXXXXXXXX.
    // Si esta capa falla, no se devuelve la transcripción nominal (fail closed).
    const redaction = await redactPersonNamesInSegments(acoustic.segments);
    const safeAcoustic = {
      ...acoustic,
      transcript: redaction.transcript,
      segments: redaction.segments,
      meta: {
        ...acoustic.meta,
        person_name_redaction_enabled: true,
        person_name_redaction_mask: redaction.meta.mask,
        person_name_redaction_replacements: redaction.replacements,
        person_name_redaction_store: false,
        person_name_redaction_fail_closed: true,
      },
    };

    try {
      const attributed = await attributeClinicalSpeakerRoles(safeAcoustic.segments);
      return res.status(200).json({
        ...safeAcoustic,
        acoustic_transcript: safeAcoustic.transcript,
        transcript: attributed.transcript,
        segments: attributed.segments,
        participants: attributed.participants,
        review_items: attributed.review_items,
        attribution_meta: attributed.meta,
        meta: {
          ...safeAcoustic.meta,
          automatic_role_attribution: true,
          role_model: attributed.meta.role_model,
          role_transport: attributed.meta.role_transport,
          role_attribution_store: false,
          critical_role_review_count: attributed.meta.critical_review_count,
          speaker_role_confirmation_required: attributed.meta.critical_review_count > 0,
        },
      });
    } catch (attributionError) {
      // La transcripción ya está desidentificada. Si falla la atribución de roles,
      // se conserva únicamente esa versión en la respuesta efímera y se bloquea el análisis.
      return res.status(200).json({
        ...safeAcoustic,
        acoustic_transcript: safeAcoustic.transcript,
        participants: [],
        review_items: [],
        attribution_error: {
          code: attributionError?.name || "SpeakerAttributionError",
          message: "No se pudo atribuir automáticamente el rol clínico de los interlocutores.",
        },
        meta: {
          ...safeAcoustic.meta,
          automatic_role_attribution: false,
          speaker_role_confirmation_required: true,
        },
      });
    }
  } catch (error) {
    const status = error instanceof TypeError || error instanceof RangeError ? 400 : 502;
    return res.status(status).json({
      error: error.code || error.name || "TranscriptionError",
      message: error.message || "No se pudo transcribir o desidentificar el audio.",
    });
  }
}
