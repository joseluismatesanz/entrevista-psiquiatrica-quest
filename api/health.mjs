import { resolveModelAuth } from "../server/model-auth.mjs";
import { AUDIO_TRANSCRIPTION_MODEL } from "../server/transcribe.mjs";

function setPrivacyHeaders(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export default async function handler(req, res) {
  setPrivacyHeaders(res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  let auth = null;
  try {
    auth = await resolveModelAuth();
  } catch {
    auth = null;
  }

  let clinicalEngineLoadable = false;
  let clinicalEngineProbe = "not_checked";
  let speakerAttributionLoadable = false;
  let medicationVerificationLoadable = false;
  let clinicalPostprocessLoadable = false;
  try {
    const module = await import("../server/analyze.mjs");
    clinicalEngineLoadable = typeof module.analyzeTranscript === "function";
    clinicalEngineProbe = clinicalEngineLoadable ? "ok" : "missing_export";
  } catch {
    clinicalEngineLoadable = false;
    clinicalEngineProbe = "import_failed";
  }

  try {
    const module = await import("../server/speaker-attribution.mjs");
    speakerAttributionLoadable = typeof module.attributeClinicalSpeakerRoles === "function";
  } catch {
    speakerAttributionLoadable = false;
  }

  try {
    const module = await import("../server/medication-verification.mjs");
    medicationVerificationLoadable = typeof module.verifyAssessmentMedications === "function";
  } catch {
    medicationVerificationLoadable = false;
  }

  try {
    const module = await import("../server/clinical-postprocess.mjs");
    clinicalPostprocessLoadable = typeof module.applyClinicalPostprocessing === "function";
  } catch {
    clinicalPostprocessLoadable = false;
  }

  return res.status(200).json({
    ok: true,
    version: "0.6.0",
    mode: "long_interview_blocks",
    recording_enabled: true,
    transcription_enabled: true,
    transcription_model: AUDIO_TRANSCRIPTION_MODEL,
    max_audio_seconds: 1800,
    audio_block_seconds: 60,
    incremental_audio_processing: true,
    signed_block_privacy_proofs: true,
    automatic_role_attribution_enabled: true,
    role_attribution_abstention_enabled: true,
    critical_only_role_review: true,
    explicit_family_role_anchor_enabled: true,
    voice_calibration_required: false,
    segment_role_correction_default: false,
    medication_verification_enabled: true,
    medication_verification_source: "AEMPS_CIMA",
    medication_name_only_external_query: true,
    medication_similarity_autocorrection: false,
    medication_formulation_inference: false,
    medication_temporality_grounded_in_transcript: true,
    medication_sections_synced_from_structured_entities: true,
    sociofamily_encounter_presence_guard: true,
    objective_mse_requires_observation_source: true,
    subjective_objective_pseudoconflict_guard: true,
    organization_status_labels_enabled: true,
    organization_attention_summary_enabled: true,
    report_draft_pending_summary_enabled: true,
    persistent_audio_storage: false,
    persistent_clinical_storage: false,
    response_cache: "no-store",
    model_transport_available: auth?.transport || "missing",
    clinical_engine_loadable: clinicalEngineLoadable,
    clinical_engine_probe: clinicalEngineProbe,
    speaker_attribution_loadable: speakerAttributionLoadable,
    medication_verification_loadable: medicationVerificationLoadable,
    clinical_postprocess_loadable: clinicalPostprocessLoadable,
  });
}
