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

  return res.status(200).json({
    ok: true,
    version: "0.5.1",
    mode: "audio_pilot",
    recording_enabled: true,
    transcription_enabled: true,
    transcription_model: AUDIO_TRANSCRIPTION_MODEL,
    max_audio_seconds: 120,
    speaker_role_confirmation_required: true,
    persistent_audio_storage: false,
    persistent_clinical_storage: false,
    response_cache: "no-store",
    model_transport_available: auth?.transport || "missing",
  });
}
