import { verifyPrivacyProof } from "../server/privacy-proof.mjs";

function setPrivacyHeaders(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function safeErrorName(error) {
  return String(error?.name || "AnalysisError").slice(0, 120);
}

function safeErrorMessage(error) {
  const message = String(error?.message || "No se pudo completar el análisis.");
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

// Señales que por sí mismas justifican la ruta clínica completa.
// La mera presencia de un medicamento o una dosis NO entra aquí: CIMA y las guardas
// farmacológicas posteriores siguen verificando esa información en ambas rutas.
const HIGH_COMPLEXITY_PATTERNS = [
  /\b(?:suicid\w*|autoles\w*|autol[ií]tic\w*|matarse|morir|sobredosis|hacerse\s+daño)\b/i,
  /\b(?:alucin\w*|delir\w*|psicos\w*|paranoi\w*|persecut\w*|voces|ideas?\s+de\s+referencia)\b/i,
  /\b(?:heteroagres\w*|agresi[oó]n|violencia|contenci[oó]n|fuga|amenaz\w*)\b/i,
  /\b(?:cannabis|coca[ií]na|anfetamin\w*|speed|mdma|ketamina|alcohol|benzodiacepin\w*|drogas)\b/i,
  /\b(?:man[ií]a|maniforme|bipolar|esquizofren\w*)\b/i,
];

const MEDICATION_TOKEN_PATTERN = /\b(?:medicaci[oó]n|tratamiento|f[aá]rmaco\w*|\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|ml|ui)|sertralina|risperidona|olanzapina|haloperidol|litio|lamotrigina|lorazepam)\b/i;
const MEDICATION_COMPLEXITY_ACTION_PATTERN = /\b(?:iniciar|introducir|suspender|retirar|aumentar|subir|reducir|bajar|cambiar|ajustar|titular|pautar|prescribir|duplicar|sobredosis|intoxicaci[oó]n|efectos?\s+adversos?|reacci[oó]n\s+adversa|alergia|ram|adherencia|abandona\w*|olvida\w*|incumpl\w*|no\s+(?:(?:la|lo|las|los)\s+)?tom[oa]\w*|no\s+estoy\s+tomando|deja\w*\s+de\s+tomar)\b/i;

function hasMedicationComplexity(text) {
  return MEDICATION_TOKEN_PATTERN.test(text) && MEDICATION_COMPLEXITY_ACTION_PATTERN.test(text);
}

export function useFastClinicalRoute(transcript) {
  const text = String(transcript || "");
  if (text.length > 5000) return false;
  if (HIGH_COMPLEXITY_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (hasMedicationComplexity(text)) return false;
  return true;
}

function verifyLongInterviewBlocks(normalizedTranscript, rawBlocks) {
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
    return { verified: false, count: 0 };
  }
  if (rawBlocks.length > 60) {
    return { verified: false, count: rawBlocks.length };
  }

  const transcripts = [];
  for (const raw of rawBlocks) {
    const blockTranscript = typeof raw?.transcript === "string" ? raw.transcript.trim() : "";
    const proof = typeof raw?.privacy_proof === "string" ? raw.privacy_proof : "";
    if (!blockTranscript || blockTranscript.length > 100_000 || !proof) {
      return { verified: false, count: rawBlocks.length };
    }
    if (!verifyPrivacyProof(blockTranscript, proof)) {
      return { verified: false, count: rawBlocks.length };
    }
    transcripts.push(blockTranscript);
  }

  const joined = transcripts.join("\n").trim();
  return {
    verified: joined === normalizedTranscript,
    count: rawBlocks.length,
  };
}

export default async function handler(req, res) {
  setPrivacyHeaders(res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  let stage = "request_validation";
  const totalStartedAt = Date.now();

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const transcript = body.transcript;

    if (typeof transcript !== "string" || transcript.trim().length < 20) {
      return res.status(400).json({ error: "invalid_transcript", stage, message: "La transcripción debe contener texto suficiente para analizar." });
    }
    if (transcript.length > 1_500_000) {
      return res.status(413).json({ error: "transcript_too_large", stage, message: "La transcripción supera el tamaño permitido para esta fase de pruebas." });
    }

    const normalizedTranscript = transcript.trim();
    const singleProofVerified = verifyPrivacyProof(normalizedTranscript, body.privacy_proof);
    const blockProofs = verifyLongInterviewBlocks(normalizedTranscript, body.verified_blocks);
    const privacyProofVerified = singleProofVerified || blockProofs.verified;

    let safeTranscript = normalizedTranscript;
    let redactionMs = 0;
    let redactionMeta = {
      mask: "XXXXXXXXXXX",
      model: blockProofs.verified ? "verified-upstream-audio-blocks" : "verified-upstream-audio",
      replacements: 0,
    };

    if (!privacyProofVerified) {
      stage = "person_name_redaction";
      const redactionStartedAt = Date.now();
      const { redactPersonNamesInTranscript } = await import("../server/person-name-redaction.mjs");
      const redaction = await redactPersonNamesInTranscript(normalizedTranscript);
      redactionMs = Date.now() - redactionStartedAt;
      safeTranscript = redaction.transcript;
      redactionMeta = {
        mask: redaction.meta.mask,
        model: redaction.meta.model,
        replacements: redaction.replacements,
      };
    }

    stage = "load_clinical_engine";
    const { analyzeTranscript } = await import("../server/analyze.mjs");

    stage = "clinical_analysis";
    const fastRoute = useFastClinicalRoute(safeTranscript);
    const analysisStartedAt = Date.now();
    const result = await analyzeTranscript(safeTranscript, fastRoute ? { model: "gpt-5.6-luna" } : {});
    const clinicalAnalysisMs = Date.now() - analysisStartedAt;

    return res.status(200).json({
      ...result,
      deidentified_transcript: safeTranscript,
      meta: {
        ...(result?.meta || {}),
        person_name_redaction_enabled: true,
        person_name_redaction_mask: redactionMeta.mask,
        person_name_redaction_model: redactionMeta.model,
        person_name_redaction_replacements: redactionMeta.replacements,
        person_name_redaction_store: false,
        person_name_redaction_fail_closed: true,
        privacy_proof_verified: privacyProofVerified,
        duplicate_redaction_skipped: privacyProofVerified,
        long_interview_block_proofs_verified: blockProofs.verified,
        long_interview_verified_block_count: blockProofs.verified ? blockProofs.count : 0,
        adaptive_fast_route: fastRoute,
        request_performance_ms: {
          person_name_redaction: redactionMs,
          clinical_analysis: clinicalAnalysisMs,
          total_request: Date.now() - totalStartedAt,
        },
      },
    });
  } catch (error) {
    const isClientError = error instanceof SyntaxError || error instanceof TypeError;
    const status = stage === "load_clinical_engine" ? 500 : (isClientError ? 400 : 502);
    return res.status(status).json({
      error: stage === "load_clinical_engine" ? "clinical_engine_unavailable" : stage === "person_name_redaction" ? "person_name_redaction_failed" : safeErrorName(error),
      stage,
      message: stage === "load_clinical_engine" ? "No se pudo cargar el motor clínico en el backend." : stage === "person_name_redaction" ? "No se pudo verificar la desidentificación de nombres personales. No se ha generado ningún documento." : safeErrorMessage(error),
    });
  }
}
