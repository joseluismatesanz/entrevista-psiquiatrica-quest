function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function psychiatristLines(transcript) {
  return String(transcript || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /^PSIQUIATRA\s*:/i.test(line))
    .map((line) => line.replace(/^PSIQUIATRA\s*:\s*/i, "").trim());
}

const EXPLICIT_CLINICIAN_OBSERVATION_PATTERN = /\b(?:durante\s+la\s+entrevista|a\s+la\s+exploracion|en\s+la\s+exploracion|se\s+objetiv\w*|no\s+se\s+objetiv\w*|se\s+observ\w*|se\s+muestra\w*|estas?\s+consciente|orientad[oa]|colaborador[ae]?|discurso\s+organizado|sin\s+alteraciones\s+del\s+lenguaje|sin\s+agitacion\s+(?:observable|psicomotriz))\b/i;

const SUBSTANTIVE_MSE_TEXT_PATTERN = /\b(?:consciente|orientad[oa]|colaborador[ae]?|discurso|lenguaje|psicomotric|agitacion|afecto|estado\s+de\s+animo|pensamiento|percepcion|alucin|ideacion|juicio|insight|conciencia)\b/i;

export function hasExplicitClinicianMseObservation(transcript) {
  return psychiatristLines(transcript).some((line) =>
    EXPLICIT_CLINICIAN_OBSERVATION_PATTERN.test(normalize(line))
  );
}

export function groundExplicitMseAssessment(inputAssessment, transcript) {
  const assessment = structuredClone(inputAssessment);
  const warnings = [];
  const section = assessment.sections?.exploracion_psicopatologica;

  if (!section?.text?.trim()) return { assessment, warnings };
  if (section.evidence_status === "supported") return { assessment, warnings };
  if (!SUBSTANTIVE_MSE_TEXT_PATTERN.test(normalize(section.text))) return { assessment, warnings };
  if (!hasExplicitClinicianMseObservation(transcript)) return { assessment, warnings };

  const directSources = (assessment.sources || [])
    .filter((source) => source.kind === "clinician_observation" || source.kind === "psychiatrist")
    .map((source) => source.id);

  section.evidence_status = "supported";
  section.source_ids = [...new Set([...(section.source_ids || []), ...directSources])];
  warnings.push("mse_status_promoted_from_explicit_clinician_observation");

  return { assessment, warnings };
}
