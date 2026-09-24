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

const META_ABSENCE_SENTENCE_PATTERN = /^(?:otros?\s+dominios?\s+psicopatologicos?\s+no\s+(?:explorados?|documentados?)(?:\s+en\s+la\s+entrevista\s+disponible)?|no\s+se\s+documentan?(?:\s+(?:de\s+forma\s+suficiente|suficientemente))?(?:\s+en\s+(?:esta|la)\s+evidencia)?\s+(?:otros?\s+)?(?:elementos?|componentes?|dominios?)(?:\s+de(?:l)?\s+(?:examen\s+psicopatologico|estado\s+mental(?:\s+actual)?|exploracion\s+psicopatologica))?|no\s+se\s+exploraron?(?:\s+de\s+forma\s+(?:documentada|suficiente))?\s+otros?\s+(?:elementos?|componentes?|dominios?)(?:\s+(?:psicopatologicos?|de(?:l)?\s+(?:examen\s+psicopatologico|estado\s+mental|exploracion\s+psicopatologica)))?|no\s+consta\s+(?:una\s+)?exploracion\s+(?:suficiente|completa)\s+de\s+otros?\s+(?:elementos?|componentes?|dominios?)(?:\s+psicopatologicos?)?|no\s+constan?\s+otros?\s+(?:elementos?|componentes?|dominios?)\s+de(?:l)?\s+estado\s+mental(?:\s+actual)?\s+(?:explorados?|observados?)(?:\s+[uy]\s+(?:explorados?|observados?))?|no\s+constan?\s+datos?\s+(?:suficientes?\s+)?sobre|no\s+constan?\s+(?:otras?\s+)?indicacion(?:es)?\s+(?:sobre|de)|no\s+consta\s+(?:ingreso(?:\s+ni\s+no\s+ingreso)?|alta|unidad\s+asistencial|pruebas?\s+complementarias?|seguimiento\s+programado|medidas?\s+especificas?\s+de\s+seguridad)|no\s+se\s+aportan?\s+datos?\s+sobre|no\s+constan?\s+otros?\s+datos?\s+sobre|no\s+se\s+dispone\s+de\s+(?:una\s+)?exploracion\s+(?:psicopatologica\s+)?(?:completa|suficiente)(?:\s+de\s+otros?\s+dominios?\s+psicopatologicos?)?|no\s+se\s+(?:ha\s+realizado|realiza)\s+(?:una\s+)?exploracion\s+psicopatologica\s+completa(?:\s+en\s+la\s+entrevista\s+aportada)?)\b/i;
const SOCIOFAMILY_META_ABSENCE_SENTENCE_PATTERN = /^(?:(?:no\s+se\s+exploraron?|no\s+constan?\s+datos?\s+sobre)\s+(?:la\s+)?(?:convivencia|apoyo|red\s+(?:social|de\s+apoyo)|escolarizacion|situacion\s+laboral|empleo)|se\s+menciona\s+a\s+(?:la|el)\s+(?:madre|padre)\s+en\s+el\s+contexto\s+de\s+la\s+relacion\s+actual)\b/i;
const FAMILY_SELF_SYMPTOM_SENTENCE_PATTERN = /^(?:se\s+menciona\s+a\s+(?:la|el)\s+(?:madre|padre)|(?:(?:la\s+)?paciente\s+)?expresa\s+preocupacion\s+por\s+el\s+estado\s+de\s+su\s+(?:madre|padre)|(?:la\s+)?paciente\s+(?:describe|refiere)(?:\s+que)?\s+(?:a\s+)?su\s+(?:madre|padre)|(?:durante\s+la\s+entrevista\s+)?menciona(?:\s+tambien)?\s+que\s+su\s+(?:madre|padre))\b[^.!?]*\b(?:agobiad[oa]|cansad[oa]|falta\s+de\s+sueno|duerme\s+mal|insomnio|nervios[oa]|ansiedad)\b/i;

function pruneMetaAbsenceSentences(
  section,
  warnings,
  warningCode,
  { pattern = META_ABSENCE_SENTENCE_PATTERN, emptyStatus = "not_provided" } = {},
) {
  if (!section?.text) return;
  const sentences = splitSentences(section.text);
  const kept = sentences.filter((sentence) => !pattern.test(normalize(sentence)));
  if (kept.length === sentences.length) return;

  section.text = kept.join(" ").trim();
  if (!section.text) {
    section.evidence_status = emptyStatus;
    section.source_ids = [];
  }
  warnings.push(warningCode);
}

const CURRENT_PLAN_SENTENCE_PATTERN = /\b(?:durante\s+la\s+valoracion\s+se\s+(?:revisa|indica|pauta|prescribe|informa|recoge|detalla|explica)|(?:se|le)\s+(?:indica|pauta|prescribe|inicia)|(?:el|la)\s+(?:psiquiatra|profesional|facultativ[oa])\s+(?:indica|pauta|prescribe|inicia)|pauta\s+(?:farmacologica|terapeutica)(?:\s+a\s+seguir)?|pauta\s+indicada|tratamiento\s+final)\b/i;
const MEDICATION_REGIMEN_PATTERN = /\b(?:medicacion|tratamiento|farmaco|\d+(?:[.,]\d+)?\s*(?:mg|miligramos?)|por\s+la\s+manana|antes\s+de\s+dormir|de\s+rescate|a\s+demanda)\b/i;
const ACUTE_MEDICATION_EVENT_PATTERN = /\b(?:se\s+administr[oa]|recibi[oa]|tras\s+la\s+administracion|dosis\s+administrada|intramuscular|contencion)\b/i;
const CURRENT_MEDICATION_ASSERTION_PATTERN = /\b(?:(?:actualmente|ahora\s+mismo|en\s+la\s+actualidad)\s+(?:se\s+)?(?:toma|tomando|esta\s+tomando)|(?:durante\s+la\s+entrevista\s+)?(?:refiere|informa(?:\s+de)?)\s+(?:(?:que\s+)?(?:estar\s+)?tomando|tratamiento\s+actual)|tratamiento\s+habitual)\b/i;

function pruneFamilySelfSymptoms(section, warnings, warningCode, emptyStatus = "insufficient") {
  if (!section?.text) return;
  const sentences = splitSentences(section.text);
  const kept = sentences.filter((sentence) => !FAMILY_SELF_SYMPTOM_SENTENCE_PATTERN.test(normalize(sentence)));
  if (kept.length === sentences.length) return;

  section.text = kept.join(" ").trim();
  if (!section.text) {
    section.evidence_status = emptyStatus;
    section.source_ids = [];
  }
  warnings.push(warningCode);
}

function clarifyMaternalCollateralSubject(section, warnings) {
  if (!section?.text) return;
  let changed = false;
  const sentences = splitSentences(section.text).map((sentence) => {
    const punctuation = sentence.match(/[.!?]$/)?.[0] || "";
    const body = punctuation ? sentence.slice(0, -1).trim() : sentence.trim();

    let match = body.match(/^la madre la describe\s+(.+)$/i);
    if (match) {
      const predicate = match[1]
        .replace(/,\s*observ[aá]ndole\s+aspecto\s+cansad[oa]$/i, " y presenta aspecto cansado")
        .replace(/,\s*con\s+aspecto\s+cansad[oa]$/i, " y presenta aspecto cansado");
      changed = true;
      return `Según la madre, la paciente se muestra ${predicate}${punctuation}`;
    }

    match = body.match(/^la madre describe que (?:est[aá]|se encuentra)\s+(.+)$/i);
    if (match) {
      const predicate = match[1].replace(/,\s*que\s+/gi, ", ");
      changed = true;
      return `Según la madre, la paciente está ${predicate}${punctuation}`;
    }

    return sentence;
  });

  if (!changed) return;
  section.text = sentences.join(" ").trim();
  warnings.push("report_maternal_collateral_subject_clarified");
}

function pruneUnsupportedHabitualMedicationFromIllness(section, assessment, warnings) {
  if (!section?.text) return;
  const hasActiveHabitual = (assessment.medications?.habitual || [])
    .some((medication) => medication?.status === "active");
  if (hasActiveHabitual) return;

  const sentences = splitSentences(section.text);
  const kept = sentences.filter((sentence) => {
    const text = normalize(sentence);
    return !CURRENT_MEDICATION_ASSERTION_PATTERN.test(text);
  });
  if (kept.length === sentences.length) return;

  section.text = kept.join(" ").trim();
  if (!section.text) {
    section.evidence_status = "not_provided";
    section.source_ids = [];
  }
  warnings.push("report_unsupported_habitual_medication_pruned_from_current_illness");
}

function pruneCurrentTreatmentPlanFromIllness(section, warnings) {
  if (!section?.text) return;
  const sentences = splitSentences(section.text);
  const kept = sentences.filter((sentence) => {
    const text = normalize(sentence);
    const isPlanRegimen = CURRENT_PLAN_SENTENCE_PATTERN.test(text)
      && MEDICATION_REGIMEN_PATTERN.test(text)
      && !ACUTE_MEDICATION_EVENT_PATTERN.test(text);
    return !isPlanRegimen;
  });
  if (kept.length === sentences.length) return;

  section.text = kept.join(" ").trim();
  if (!section.text) {
    section.evidence_status = "not_provided";
    section.source_ids = [];
  }
  warnings.push("report_current_treatment_plan_pruned_from_current_illness");
}

function cleanClinicalMetaPhrasing(section, warnings, warningCode) {
  if (!section?.text) return;
  const original = section.text;
  let text = String(original)
    .replace(/^\s*pauta\s+indicada\s+durante\s+la\s+valoraci[oó]n\s*:\s*/i, "")
    .replace(/\bun\s+f[aá]rmaco\s+referido\s+como\s+([«\"][^»\"]+[»\"])/gi, "$1")
    .replace(/\s*,?\s*cuyo\s+principio\s+activo\s+no\s+(?:queda|qued[oó]|ha\s+quedado)\s+(?:establecido|identificado|confirmado)(?:\s+en\s+la\s+transcripci[oó]n)?/gi, "")
    .replace(/\s*,?\s*sin\s+principio\s+activo\s+(?:confirmado|establecido|identificado)/gi, "")
    .replace(/\s*,?\s*(?:seg[uú]n|de\s+acuerdo\s+con)\s+la\s+transcripci[oó]n/gi, "")
    .replace(/seguimiento\s+en\s+(?:la\s+)?pr[oó]xima\s+(?:visita|consulta)\s+mencionado\s*,?\s*sin\s+fecha\s+ni\s+dispositivo\s+especificados\.?/gi, "Seguimiento en próxima consulta.")
    .replace(/se\s+har[aá]\s+referencia\s+a\s+(?:una\s+)?pr[oó]xima\s+(?:visita|consulta)\.?/gi, "Seguimiento en próxima consulta.")
    .replace(/se\s+menciona\s+(?:una\s+)?pr[oó]xima\s+(?:visita|consulta)\s*,?\s*sin\s+fecha\s+ni\s+(?:condiciones|dispositivo)\s+especificad[oa]s\.?/gi, "Seguimiento en próxima consulta.")
    .replace(/\s*,?\s*y\s+expresa\s+(?:la\s+)?expectativa\s+de\s+mejor[ií]a\s+en\s+(?:la\s+)?pr[oó]xima\s+(?:visita|consulta)\.?/gi, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();

  const normalizedText = normalize(text);
  const hasPositiveSertralineSchedule = /\bsertralina\b/.test(normalizedText)
    && /\bpor\s+la\s+manana\b/.test(normalizedText)
    && /\b(?:una\s+sola\s+(?:dosis|toma)|con\s+el\s+desayuno)\b/.test(normalizedText);
  if (hasPositiveSertralineSchedule) {
    text = splitSentences(text)
      .filter((sentence) => !/\bno\s+tomar(?:la|\s+(?:la|medicacion))?\b.*\bcomida\b.*\bcena\b/i.test(normalize(sentence)))
      .join(" ")
      .trim();
  }

  if (text === original) return;
  section.text = text;
  if (!text) {
    section.evidence_status = "not_provided";
    section.source_ids = [];
  }
  warnings.push(warningCode);
}

const COLLATERAL_MSE_CLAUSE_PATTERN = /^(?:la\s+)?(?:madre|padre|familia(?:r|res)?|acompanante|cuidador(?:a)?)\s+(?:refiere|describe|observa|senala|informa|comenta|explica)\b/i;

function pruneCollateralContentFromMse(section, assessment, warnings) {
  if (!section?.text) return;
  let pruned = false;
  const keptSentences = [];

  for (const sentence of splitSentences(section.text)) {
    const terminal = sentence.match(/[.!?]$/)?.[0] || "";
    const clauses = sentence.split(/\s*;\s*/).map((clause) => clause.trim()).filter(Boolean);
    const keptClauses = clauses.filter((clause) => {
      const remove = COLLATERAL_MSE_CLAUSE_PATTERN.test(normalize(clause));
      if (remove) pruned = true;
      return !remove;
    });
    if (!keptClauses.length) continue;
    let rebuilt = keptClauses.join("; ").replace(/[.!?]+$/, "").trim();
    if (terminal) rebuilt += terminal;
    keptSentences.push(rebuilt);
  }

  if (!pruned) return;
  section.text = keptSentences.join(" ").trim();
  const sourceKinds = new Map((assessment.sources || []).map((source) => [source.id, source.kind]));
  const collateralKinds = new Set(["mother", "father", "family", "caregiver"]);
  section.source_ids = (section.source_ids || []).filter((id) => !collateralKinds.has(sourceKinds.get(id)));
  if (!section.text) {
    section.evidence_status = "insufficient";
    section.source_ids = [];
  }
  warnings.push("report_collateral_content_pruned_from_mse");
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

  pruneCurrentTreatmentPlanFromIllness(
    assessment.sections?.enfermedad_actual,
    warnings,
  );

  pruneUnsupportedHabitualMedicationFromIllness(
    assessment.sections?.enfermedad_actual,
    assessment,
    warnings,
  );

  cleanClinicalMetaPhrasing(
    assessment.sections?.enfermedad_actual,
    warnings,
    "report_meta_phrasing_pruned_from_current_illness",
  );

  pruneFamilySelfSymptoms(
    assessment.sections?.enfermedad_actual,
    warnings,
    "report_family_self_symptoms_pruned_from_current_illness",
    "not_provided",
  );

  clarifyMaternalCollateralSubject(
    assessment.sections?.enfermedad_actual,
    warnings,
  );

  removeInferredSchooling(
    assessment.sections?.situacion_sociofamiliar,
    lines,
    warnings,
  );

  pruneFamilySelfSymptoms(
    assessment.sections?.situacion_sociofamiliar,
    warnings,
    "report_family_self_symptoms_pruned_from_sociofamily",
  );

  pruneMetaAbsenceSentences(
    assessment.sections?.situacion_sociofamiliar,
    warnings,
    "report_meta_absence_pruned_from_sociofamily",
    {
      pattern: SOCIOFAMILY_META_ABSENCE_SENTENCE_PATTERN,
      emptyStatus: "insufficient",
    },
  );

  enrichPlanFromExplicitPsychiatristAssessment(
    assessment.sections?.plan_terapeutico,
    assessment,
    lines,
    warnings,
  );

  cleanClinicalMetaPhrasing(
    assessment.sections?.plan_terapeutico,
    warnings,
    "report_meta_phrasing_pruned_from_plan",
  );

  pruneCollateralContentFromMse(
    assessment.sections?.exploracion_psicopatologica,
    assessment,
    warnings,
  );

  pruneMetaAbsenceSentences(
    assessment.sections?.exploracion_psicopatologica,
    warnings,
    "report_meta_absence_pruned_from_mse",
  );
  pruneMetaAbsenceSentences(
    assessment.sections?.plan_terapeutico,
    warnings,
    "report_meta_absence_pruned_from_plan",
  );

  return { assessment, warnings };
}
