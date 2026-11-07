import transcribeHandler from "./transcribe.mjs";

// V0.6 long-interview endpoint.
// Reuses exactly the stable diarization + privacy + clinical-role pipeline from /api/transcribe.
// Keeping a separate route prevents per-block responses from being mistaken for the final
// transcript by the existing V0.5 browser attribution UI.
export default transcribeHandler;
