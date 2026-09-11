import {
  verifyPrivacyProof,
  LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
} from "../server/privacy-proof.mjs";
import { verifyClinicalEvidenceProof } from "../server/clinical-evidence-proof.mjs";

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

export function verifyLongInterviewBlocks(normalizedTranscript, rawBlocks, options = {}) {
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) return { verified: false, count: 0, blocks: [] };
  // Con bloques de 20 s, una entrevista de 30 min produce hasta 90 bloques.
  if (rawBlocks.length > 100) return { verified: false, count: rawBlocks.length, blocks: [] };

  const transcripts = [];
  const blocks = [];
  for (let position = 0; position < rawBlocks.length; position += 1) {
    const raw = rawBlocks[position];
    const blockTranscript = typeof raw?.transcript === "string" ? raw.transcript.trim() : "";
    const proof = typeof raw?.privacy_proof === "string" ? raw.privacy_proof : "";
    const blockIndex = Number.isInteger(Number(raw?.block_index)) ? Number(raw.block_index) : position + 1;
    if (!blockTranscript || blockTranscript.length > 100_000 || !proof || blockIndex < 1) {
      return { verified: false, count: rawBlocks.length, blocks: [] };
    }
    if (!verifyPrivacyProof(blockTranscript, proof, {
      ...options,
      maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
    })) {
      return { verified: false, count: rawBlocks.length, blocks: [] };
    }
    transcripts.push(blockTranscript);
    blocks.push({ block_index: blockIndex, transcript: blockTranscript });
  }

  const joined = transcripts.join("\n").trim();
  return {
    verified: joined === normalizedTranscript,
    count: rawBlocks.length,
    blocks,
  };
}

export function verifyLongInterviewEvidence(blockProofs, rawEvidence, options = {}) {
  if (!blockProofs?.verified || !Array.isArray(rawEvidence) || rawEvidence.length !== blockProofs.blocks.length) {
    return { verified: false, count: Array.isArray(rawEvidence) ? rawEvidence.length : 0, transcript: "" };
  }

  const sourceByIndex = new Map(blockProofs.blocks.map((block) => [block.block_index, block.transcript]));
  const evidenceByIndex = new Map();
  for (const raw of rawEvidence) {
    const blockIndex = Number(raw?.block_index);
    const clinicalTranscript = typeof raw?.clinical_transcript === "string" ? raw.clinical_transcript.trim() : "";
    const evidenceProof = typeof raw?.evidence_proof === "string" ? raw.evidence_proof : "";
    const sourceTranscript = sourceByIndex.get(blockIndex);
    if (!Number.isInteger(blockIndex) || blockIndex < 1 || !sourceTranscript || !clinicalTranscript || clinicalTranscript.length > 100_000 || !evidenceProof) {
      return { verified: false, count: rawEvidence.length, transcript: "" };
    }
    if (!verifyClinicalEvidenceProof(blockIndex, sourceTranscript, clinicalTranscript, evidenceProof, options)) {
      return { verified: false, count: rawEvidence.length, transcript: "" };
    }
    evidenceByIndex.set(blockIndex, clinicalTranscript);
  }

  if (evidenceByIndex.size !== sourceByIndex.size) {
    return { verified: false, count: rawEvidence.length, transcript: "" };
  }

  const ordered = [...sourceByIndex.keys()].sort((a, b) => a - b).map((index) => evidenceByIndex.get(index));
  return {
    verified: ordered.every(Boolean),
    count: ordered.length,
    transcript: ordered.filter(Boolean).join("\n").trim(),
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

    const evidenceBundle = blockProofs.verified
      ? verifyLongInterviewEvidence(blockProofs, body.verified_evidence)
      : { verified: false, count: 0, transcript: "" };

    stage = "load_clinical_engine";
    const { analyzeTranscript } = await import("../server/analyze.mjs");

    stage = "clinical_analysis";
    const fastRoute = useFastClinicalRoute(safeTranscript);
    const analysisStartedAt = Date.now();
    const result = await analyzeTranscript(safeTranscript, {
      ...(fastRoute ? { model: "gpt-5.6-luna" } : {}),
      ...(evidenceBundle.verified ? { modelTranscript: evidenceBundle.transcript } : {}),
    });
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
        long_interview_evidence_verified: evidenceBundle.verified,
        long_interview_evidence_block_count: evidenceBundle.verified ? evidenceBundle.count : 0,
        long_interview_model_input_compacted: evidenceBundle.verified,
        long_interview_model_input_characters: evidenceBundle.verified ? evidenceBundle.transcript.length : safeTranscript.length,
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
