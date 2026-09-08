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

  return res.status(200).json({
    ok: true,
    version: "0.5.4",
    mode: "audio_pilot",
    recording_enabled: true,
    transcription_enabled: true,
    transcription_model: AUDIO_TRANSCRIPTION_MODEL,
    max_audio_seconds: 120,
    automatic_role_attribution_enabled: true,
    role_attribution_abstention_enabled: true,
    critical_only_role_review: true,
    voice_calibration_required: false,
    segment_role_correction_default: false,
    persistent_audio_storage: false,
    persistent_clinical_storage: false,
    response_cache: "no-store",
    model_transport_available: auth?.transport || "missing",
    clinical_engine_loadable: clinicalEngineLoadable,
    clinical_engine_probe: clinicalEngineProbe,
    speaker_attribution_loadable: speakerAttributionLoadable,
  });
}
