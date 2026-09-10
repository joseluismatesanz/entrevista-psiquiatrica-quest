import { transcribeAudioPayload } from "../server/transcribe.mjs";
import { redactAndAttributeSegments } from "../server/privacy-attribution.mjs";
import { redactPersonNamesInSegments } from "../server/person-name-redaction.mjs";
import { attributeClinicalSpeakerRoles } from "../server/speaker-attribution.mjs";
import { createPrivacyProof } from "../server/privacy-proof.mjs";

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

  const totalStartedAt = Date.now();
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const transcriptionStartedAt = Date.now();
    const acoustic = await transcribeAudioPayload(body);
    const transcriptionMs = Date.now() - transcriptionStartedAt;

    // Vía normal: una sola llamada estructurada hace anonimización + atribución.
    // Si esa llamada falla, se activa el camino anterior como fallback seguro.
    const privatePassStartedAt = Date.now();
    let processed;
    let fallbackUsed = false;
    try {
      processed = await redactAndAttributeSegments(acoustic.segments);
    } catch {
      fallbackUsed = true;
      const redaction = await redactPersonNamesInSegments(acoustic.segments);
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

    // Prueba firmada efímera: permite a /api/analyze verificar que ESTA transcripción
    // exacta ya fue desidentificada por el servidor. El token no contiene texto clínico.
    const privacyProof = createPrivacyProof(processed.transcript);

    return res.status(200).json({
      ...acoustic,
      transcript: processed.transcript,
      acoustic_transcript: processed.segments.map((s) => `HABLANTE ${s.acoustic_speaker || s.speaker}: ${s.text}`).join("\n"),
      segments: processed.segments,
      participants: processed.participants,
      review_items: processed.review_items,
      ...(privacyProof ? { privacy_proof: privacyProof } : {}),
      meta: {
        ...acoustic.meta,
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
          transcription: transcriptionMs,
          privacy_and_speaker_attribution: privatePassMs,
          total_audio_pipeline: Date.now() - totalStartedAt,
        },
      },
    });
  } catch (error) {
    const status = error instanceof TypeError || error instanceof RangeError ? 400 : 502;
    return res.status(status).json({
      error: error.code || error.name || "TranscriptionError",
      message: error.message || "No se pudo transcribir o desidentificar el audio.",
    });
  }
}
