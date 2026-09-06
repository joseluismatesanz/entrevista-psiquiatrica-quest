import { analyzeTranscript } from "../server/analyze.mjs";

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

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const transcript = body.transcript;

    if (typeof transcript !== "string" || transcript.trim().length < 20) {
      return res.status(400).json({
        error: "invalid_transcript",
        message: "La transcripción debe contener texto suficiente para analizar.",
      });
    }

    if (transcript.length > 1_500_000) {
      return res.status(413).json({
        error: "transcript_too_large",
        message: "La transcripción supera el tamaño permitido para esta fase de pruebas.",
      });
    }

    // No se registra ni persiste deliberadamente el texto de la entrevista.
    const result = await analyzeTranscript(transcript);
    return res.status(200).json(result);
  } catch (error) {
    const status = error instanceof SyntaxError || error instanceof TypeError ? 400 : 502;
    return res.status(status).json({
      error: error.name || "AnalysisError",
      message: error.message || "No se pudo completar el análisis.",
    });
  }
}
