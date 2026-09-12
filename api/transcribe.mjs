import { transcribeAudioPayload } from "../server/transcribe.mjs";
import { redactAndAttributeSegments } from "../server/privacy-attribution.mjs";
import { redactPersonNamesInSegments } from "../server/person-name-redaction.mjs";
import { attributeClinicalSpeakerRoles } from "../server/speaker-attribution.mjs";
import {
  createPrivacyProof,
  verifyPrivacyProof,
  LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
} from "../server/privacy-proof.mjs";

export const SILENT_LONG_INTERVIEW_BLOCK = "SISTEMA: [BLOQUE_SILENCIOSO]";

function setPrivacyHeaders(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function verifiedPriorContext(body) {
  if (body?.long_interview_block !== true) return "";
  const context = typeof body?.previous_safe_context === "string"
    ? body.previous_safe_context.trim()
    : "";
  const proof = typeof body?.previous_context_proof === "string"
    ? body.previous_context_proof
    : "";
  if (!context || !proof || context.length > 100_000) return "";
  const verified = verifyPrivacyProof(context, proof, {
    maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
  });
  return verified ? context.slice(-2400) : "";
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
    const longInterviewBlock = body.long_interview_block === true;
    const previousSafeContext = verifiedPriorContext(body);

    const transcriptionStartedAt = Date.now();
    const acoustic = await transcribeAudioPayload(body, {
      allowEmptySegments: longInterviewBlock,
    });
    const transcriptionMs = Date.now() - transcriptionStartedAt;

    // Una pausa clínica dentro de una entrevista larga es un bloque válido sin contenido.
    // Se firma una marca técnica para que el controlador estable pueda transportarlo de
    // forma verificable; una capa de navegador la elimina antes de mostrar/analizar texto.
    if (longInterviewBlock && acoustic.segments.length === 0) {
      const silentProof = createPrivacyProof(SILENT_LONG_INTERVIEW_BLOCK, {
        ttlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
        maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
      });
      if (!silentProof) throw new Error("No se pudo firmar el bloque silencioso de la entrevista larga.");
      return res.status(200).json({
        ...acoustic,
        transcript: SILENT_LONG_INTERVIEW_BLOCK,
        acoustic_transcript: "",
        participants: [],
        review_items: [],
        privacy_proof: silentProof,
        meta: {
          ...acoustic.meta,
          long_interview_block: true,
          silent_block: true,
          person_name_redaction_enabled: true,
          person_name_redaction_replacements: 0,
          person_name_redaction_store: false,
          person_name_redaction_fail_closed: true,
          automatic_role_attribution: true,
          signed_privacy_proof_issued: true,
          previous_safe_context_verified: Boolean(previousSafeContext),
          previous_safe_context_used: false,
          privacy_proof_ttl_seconds: Math.round(LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS / 1000),
          performance_ms: {
            transcription: transcriptionMs,
            privacy_and_speaker_attribution: 0,
            total_audio_pipeline: Date.now() - totalStartedAt,
          },
        },
      });
    }

    // Vía normal: una sola llamada estructurada hace anonimización + atribución.
    // En V0.6 puede recibir únicamente contexto previo ya desidentificado y firmado,
    // para mantener continuidad de roles entre bloques. Si falla, se conserva el
    // camino anterior como fallback seguro.
    const privatePassStartedAt = Date.now();
    let processed;
    let fallbackUsed = false;
    try {
      processed = await redactAndAttributeSegments(acoustic.segments, { previousSafeContext });
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
          previous_safe_context_used: false,
        },
      };
    }
    const privatePassMs = Date.now() - privatePassStartedAt;

    const privacyProof = longInterviewBlock
      ? createPrivacyProof(processed.transcript, {
          ttlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
          maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
        })
      : createPrivacyProof(processed.transcript);

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
        silent_block: false,
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
        long_interview_block: longInterviewBlock,
        previous_safe_context_verified: Boolean(previousSafeContext),
        previous_safe_context_used: Boolean(processed.meta.previous_safe_context_used),
        privacy_proof_ttl_seconds: longInterviewBlock
          ? Math.round(LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS / 1000)
          : 600,
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
