import { verifyPrivacyProof, LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS } from "../server/privacy-proof.mjs";
import { filterClinicalBlockTranscript } from "../server/clinical-block-filter.mjs";
import { createClinicalEvidenceProof } from "../server/clinical-evidence-proof.mjs";

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

  const startedAt = Date.now();
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    const privacyProof = typeof body.privacy_proof === "string" ? body.privacy_proof : "";
    const blockIndex = Number(body.block_index);

    if (!transcript || transcript.length > 100_000 || !Number.isInteger(blockIndex) || blockIndex < 1) {
      return res.status(400).json({ error: "invalid_block_evidence_request", message: "Bloque clínico no válido." });
    }

    const verified = verifyPrivacyProof(transcript, privacyProof, {
      maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
    });
    if (!verified) {
      return res.status(400).json({ error: "unverified_private_block", message: "El bloque no dispone de una prueba de privacidad válida." });
    }

    const filterStartedAt = Date.now();
    const filtered = await filterClinicalBlockTranscript(transcript);
    const filterMs = Date.now() - filterStartedAt;
    const evidenceProof = createClinicalEvidenceProof(blockIndex, transcript, filtered.clinical_transcript);
    if (!evidenceProof) throw new Error("No se pudo firmar la evidencia clínica incremental.");

    return res.status(200).json({
      block_index: blockIndex,
      clinical_transcript: filtered.clinical_transcript,
      evidence_proof: evidenceProof,
      meta: {
        ...filtered.meta,
        source_privacy_proof_verified: true,
        evidence_signed: true,
        performance_ms: {
          clinical_filter: filterMs,
          total: Date.now() - startedAt,
        },
      },
    });
  } catch (error) {
    return res.status(502).json({
      error: error?.name || "ClinicalBlockEvidenceError",
      message: String(error?.message || "No se pudo preparar la evidencia clínica del bloque.").slice(0, 500),
    });
  }
}
