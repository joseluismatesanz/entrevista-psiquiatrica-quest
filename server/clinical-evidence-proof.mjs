import {
  createPrivacyProof,
  verifyPrivacyProof,
  LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
} from "./privacy-proof.mjs";

export function clinicalEvidenceProofPayload(blockIndex, sourceTranscript, clinicalTranscript) {
  const index = Number(blockIndex);
  return [
    "clinical-evidence-v1",
    `block=${Number.isFinite(index) ? index : -1}`,
    "SOURCE",
    String(sourceTranscript || "").trim(),
    "EVIDENCE",
    String(clinicalTranscript || "").trim(),
  ].join("\n");
}

export function createClinicalEvidenceProof(blockIndex, sourceTranscript, clinicalTranscript, options = {}) {
  const payload = clinicalEvidenceProofPayload(blockIndex, sourceTranscript, clinicalTranscript);
  return createPrivacyProof(payload, {
    ...options,
    ttlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
    maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
  });
}

export function verifyClinicalEvidenceProof(blockIndex, sourceTranscript, clinicalTranscript, token, options = {}) {
  const payload = clinicalEvidenceProofPayload(blockIndex, sourceTranscript, clinicalTranscript);
  return verifyPrivacyProof(payload, token, {
    ...options,
    maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
  });
}
