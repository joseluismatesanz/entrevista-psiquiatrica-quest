function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text) {
  return String(text || "")
    .match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
}

function parseTranscript(transcript) {
  return String(transcript || "")
    .split(/\n+/)
    .map((line) => {
      const match = line.match(/^\s*([A-ZÁÉÍÓÚÜÑ ]+)\s*:\s*(.+)$/i);
      if (!match) return null;
      return {
        speaker: normalize(match[1]),
        text: match[2].trim(),
      };
    })
    .filter(Boolean);
}

function sourceIdForKind(assessment, kinds) {
  const wanted = new Set(kinds);
  return (assessment.sources || []).find((source) => wanted.has(source.kind))?.id || "";
}

function patientExplicitlyAddressesAutolesions(lines) {
  const patientText = lines
    .filter((line) => line.speaker === "paciente")
    .map((line) => line.text)
    .join(" ");

  // "Hacerme daño" se conserva como ideación/intención autoagresiva, pero no se
  // convierte por sí solo en una negación específica de autolesiones/NSSI.
  return /\b(?:autolesi(?:o|ó)n(?:es)?|autolesionarme|cortarme|me\s+he\s+cortado|me\s+corto|lesionarme)\b/i.test(patientText);
}

function removeUngroundedPatientAutolesionDenial(section, lines, warnings) {
  const text = String(section?.text || "").trim();
  if (!text || patientExplicitlyAddressesAutolesions(lines)) return;

  let changed = false;
  const sentences = splitSentences(text).map((sentence) => {
    if (!/^la paciente\s+niega\b/i.test(sentence) || !/\bautolesiones\b/i.test(sentence)) {
      return sentence;
    }

    let next = sentence
      .replace(/,\s*autolesiones(?=\s*,|\s+y\b|\.)/i, "")
      .replace(/\bautolesiones\s*,\s*/i, "")
      .replace(/\bautolesiones\s+y\s+/i, "")
      .replace(/\s{2,}/g, " ")
      .replace(/,\s*,/g, ",")
      .trim();

    if (next !== sentence) changed = true;
    return next;
  });

  if (!changed) return;
  section.text = sentences.join(" ");
  warnings.push("report_patient_autolesion_denial_removed_without_explicit_patient_evidence");
}

function transcriptExplicitlyStatesSchooling(lines) {
  const relevantText = lines
    .filter((line) => ["paciente", "madre", "padre", "cuidador", "cuidadora"].includes(line.speaker))
    .map((line) => line.text)
    .join(" ");

  return /\b(?:estudio|estudia|estudiando|curso|cursa|escolarizad[oa]|voy\s+al\s+instituto|va\s+al\s+instituto|acude\s+al\s+instituto)\b/i.test(relevantText);
}

function removeInferredSchooling(section, lines, warnings) {
  const text = String(section?.text || "").trim();
  if (!text || transcriptExplicitlyStatesSchooling(lines)) return;

  const sentences = splitSentences(text);
  const kept = sentences.filter((sentence) => !/\b(?:escolarizad[oa]|estudia|cursa|instituto)\b/i.test(sentence));
  if (kept.length === sentences.length) return;

  section.text = kept.join(" ").trim();
  if (!section.text) {
    section.evidence_status = "not_provided";
    section.source_ids = [];
  }
  warnings.push("report_inferred_schooling_removed_without_explicit_transcript_statement");
}

const PLAN_ASSESSMENT_PATTERN = /\b(?:(?:necesitamos|debemos|hay\s+que|conviene|procede|se\s+debe)\s+)?(?:ampliar|explorar|evaluar|valorar|descartar|revisar)\b/i;

function normalizePlanAssessmentSentence(sentence) {
  return String(sentence || "")
    .replace(/^\s*(?:necesitamos|debemos|hay\s+que|conviene|procede|se\s+debe)\s+(?=(?:ampliar|explorar|evaluar|valorar|descartar|revisar)\b)/i, "")
    .replace(/^\s*([a-záéíóúñ])/i, (match) => match.toUpperCase())
    .trim();
}

function enrichPlanFromExplicitPsychiatristAssessment(section, assessment, lines, warnings) {
  if (!section) return;

  const candidates = [];
  for (const line of lines) {
    if (line.speaker !== "psiquiatra") continue;
    for (const sentence of splitSentences(line.text)) {
      if (!PLAN_ASSESSMENT_PATTERN.test(sentence)) continue;
      const normalized = normalizePlanAssessmentSentence(sentence);
      if (normalized && !candidates.some((item) => normalize(item) === normalize(normalized))) {
        candidates.push(normalized);
      }
    }
  }

  if (!candidates.length) return;

  const existing = String(section.text || "").trim();
  const existingNormalized = normalize(existing);
  const additions = candidates.filter((candidate) => {
    const words = normalize(candidate).split(" ").filter((word) => word.length > 4);
    if (!words.length) return !existingNormalized.includes(normalize(candidate));
    const overlap = words.filter((word) => existingNormalized.includes(word)).length / words.length;
    return overlap < 0.7;
  });

  if (!additions.length) return;

  section.text = [existing, ...additions].filter(Boolean).join(" ").trim();
  section.evidence_status = "supported";
  const psychiatristId = sourceIdForKind(assessment, ["psychiatrist"]);
  if (psychiatristId && !section.source_ids.includes(psychiatristId)) section.source_ids.push(psychiatristId);
  warnings.push("report_plan_enriched_from_explicit_psychiatrist_assessment");
}

export function groundReportContentToTranscript(inputAssessment, transcript) {
  const assessment = structuredClone(inputAssessment);
  const warnings = [];
  const lines = parseTranscript(transcript);

  removeUngroundedPatientAutolesionDenial(
    assessment.sections?.enfermedad_actual,
    lines,
    warnings,
  );

  removeInferredSchooling(
    assessment.sections?.situacion_sociofamiliar,
    lines,
    warnings,
  );

  enrichPlanFromExplicitPsychiatristAssessment(
    assessment.sections?.plan_terapeutico,
    assessment,
    lines,
    warnings,
  );

  return { assessment, warnings };
}
