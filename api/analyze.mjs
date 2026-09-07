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

export default async function handler(req, res) {
  setPrivacyHeaders(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  let stage = "request_validation";

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const transcript = body.transcript;

    if (typeof transcript !== "string" || transcript.trim().length < 20) {
      return res.status(400).json({
        error: "invalid_transcript",
        stage,
        message: "La transcripción debe contener texto suficiente para analizar.",
      });
    }

    if (transcript.length > 1_500_000) {
      return res.status(413).json({
        error: "transcript_too_large",
        stage,
        message: "La transcripción supera el tamaño permitido para esta fase de pruebas.",
      });
    }

    // Importación diferida: si el bundle clínico no puede cargarse en Vercel,
    // el error queda atrapado y llega al cliente como diagnóstico técnico legible.
    stage = "load_clinical_engine";
    const { analyzeTranscript } = await import("../server/analyze.mjs");

    stage = "clinical_analysis";
    // No se registra ni persiste deliberadamente el texto de la entrevista.
    const result = await analyzeTranscript(transcript);
    return res.status(200).json(result);
  } catch (error) {
    const isClientError = error instanceof SyntaxError || error instanceof TypeError;
    const status = stage === "load_clinical_engine" ? 500 : (isClientError ? 400 : 502);

    return res.status(status).json({
      error: stage === "load_clinical_engine" ? "clinical_engine_unavailable" : safeErrorName(error),
      stage,
      message:
        stage === "load_clinical_engine"
          ? "No se pudo cargar el motor clínico en el backend."
          : safeErrorMessage(error),
    });
  }
}
