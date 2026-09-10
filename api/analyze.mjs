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

const COMPLEX_CLINICAL_PATTERNS = [
  /\b(?:suicid\w*|autoles\w*|autol[ií]tic\w*|matarse|morir|sobredosis|hacerse\s+daño)\b/i,
  /\b(?:alucin\w*|delir\w*|psicos\w*|paranoi\w*|persecut\w*|voces|ideas?\s+de\s+referencia)\b/i,
  /\b(?:heteroagres\w*|agresi[oó]n|violencia|contenci[oó]n|fuga|amenaz\w*)\b/i,
  /\b(?:cannabis|coca[ií]na|anfetamin\w*|speed|mdma|ketamina|alcohol|benzodiacepin\w*|drogas)\b/i,
  /\b(?:man[ií]a|maniforme|bipolar|esquizofren\w*)\b/i,
  /\b(?:\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|ml|ui)\b|sertralina|risperidona|olanzapina|haloperidol|litio|lamotrigina|lorazepam)\b/i,
];

function useFastClinicalRoute(transcript) {
  const text = String(transcript || "");
  if (text.length > 5000) return false;
  return !COMPLEX_CLINICAL_PATTERNS.some((pattern) => pattern.test(text));
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

    stage = "person_name_redaction";
    const redactionStartedAt = Date.now();
    const { redactPersonNamesInTranscript } = await import("../server/person-name-redaction.mjs");
    const redaction = await redactPersonNamesInTranscript(transcript);
    const redactionMs = Date.now() - redactionStartedAt;

    stage = "load_clinical_engine";
    const { analyzeTranscript } = await import("../server/analyze.mjs");

    stage = "clinical_analysis";
    const fastRoute = useFastClinicalRoute(redaction.transcript);
    const analysisStartedAt = Date.now();
    const result = await analyzeTranscript(redaction.transcript, fastRoute ? { model: "gpt-5.6-luna" } : {});
    const clinicalAnalysisMs = Date.now() - analysisStartedAt;

    return res.status(200).json({
      ...result,
      deidentified_transcript: redaction.transcript,
      meta: {
        ...(result?.meta || {}),
        person_name_redaction_enabled: true,
        person_name_redaction_mask: redaction.meta.mask,
        person_name_redaction_model: redaction.meta.model,
        person_name_redaction_replacements: redaction.replacements,
        person_name_redaction_store: false,
        person_name_redaction_fail_closed: true,
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
