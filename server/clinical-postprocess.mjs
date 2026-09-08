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

function sourceKindMap(assessment) {
  return new Map((assessment.sources || []).map((source) => [source.id, source.kind]));
}

function transcriptUnits(transcript) {
  return String(transcript || "")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function medicationMentionUnits(transcript, rawName) {
  const wanted = normalize(rawName);
  if (!wanted) return [];
  return transcriptUnits(transcript).filter((unit) => normalize(unit).includes(wanted));
}

const HISTORICAL_MEDICATION_PATTERN = /\b(?:alguna\s+vez|en\s+el\s+pasado|antes|anteriormente|previamente|tratamiento\s+previo|me\s+dieron|le\s+dieron|tomaba|tomé|tome|había\s+tomado|habia\s+tomado|usaba|utilicé|utilice|se\s+retiró|se\s+retiro|retiraron|dejé\s+de|deje\s+de|dejó\s+de|dejo\s+de|suspendí|suspendi|suspendió|suspendio|ya\s+no\s+(?:tomo|toma)|tratad[oa]\s+con)\b/i;
const ACTIVE_MEDICATION_PATTERN = /\b(?:actualmente|ahora|tomo|toma|tomando|mantengo|mantiene|por\s+la\s+mañana|por\s+la\s+noche|cada\s+d[ií]a|todos\s+los\s+d[ií]as|a\s+diario|habitualmente|tratamiento\s+habitual|sigo\s+con|contin[uú]o|contin[uú]a\s+con)\b/i;

function inferMedicationTemporality(transcript, rawName) {
  const mentions = medicationMentionUnits(transcript, rawName);
  if (!mentions.length) return "unknown";

  let historical = 0;
  let active = 0;
  for (const mention of mentions) {
    if (HISTORICAL_MEDICATION_PATTERN.test(mention)) historical += 1;
    if (ACTIVE_MEDICATION_PATTERN.test(mention)) active += 1;
  }

  if (historical > 0 && active === 0) return "historical";
  if (active > 0 && historical === 0) return "active";
  return "ambiguous";
}

function cleanAdherence(value) {
  return clean(value).replace(/^adherencia\s*:?\s*/i, "").trim();
}

function medicationLine(med) {
  const name = clean(med.display_name) || clean(med.raw_name) || "Medicamento no identificado";
  const dose = clean(med.dose);
  const schedule = clean(med.schedule);
  const route = clean(med.route);
  const adherence = cleanAdherence(med.adherence_text);

  let line = name;
  if (dose) line += ` ${dose}`;
  if (schedule) line += `: ${schedule}`;
  else if (med.prn) line += ": a demanda";
  if (route && !/oral/i.test(route)) line += ` (${route})`;
  if (adherence && med.adherence_status !== "not_applicable") line += `. Adherencia: ${adherence}`;
  return line.replace(/\.\./g, ".").trim();
}

function syncMedicationSection(assessment, group, sectionKey, statuses) {
  const list = assessment.medications?.[group] || [];
  const allowed = new Set(statuses);
  const visible = list.filter((med) => allowed.has(med?.status));
  const section = assessment.sections?.[sectionKey];
  if (!section) return;

  if (visible.length) {
    section.text = visible.map(medicationLine).filter(Boolean).join("\n");
    section.evidence_status = "supported";
    section.source_ids = [...new Set(visible.flatMap((med) => Array.isArray(med.source_ids) ? med.source_ids : []))];
    return;
  }

  // Si solo hay medicación histórica, no convertirla en tratamiento habitual/actual.
  if (list.length) {
    section.text = "";
    section.evidence_status = "not_provided";
    section.source_ids = [];
  }
}

const SUBJECTIVE_AGITATION_PATTERN = /\b(?:me\s+siento\s+(?:muy\s+)?agitad[oa]|se\s+siente\s+(?:muy\s+)?agitad[oa]|refiere\s+(?:encontrarse|estar)?\s*(?:muy\s+)?agitad[oa]|manifiesta\s+(?:encontrarse|estar)?\s*(?:muy\s+)?agitad[oa]|(?:estoy|esta|está)\s+(?:muy\s+)?agitad[oa]|nervios[oa]|nerviosismo|agitacion\s+subjetiva)\b/i;
const OBSERVED_NO_MOTOR_ACTIVATION_PATTERN = /\b(?:sin\s+inquietud\s+motora|no\s+se\s+objetiva\s+inquietud\s+motora|sin\s+agitacion\s+psicomotriz|permanece\s+sentad[oa]|psicomotricidad\s+sin\s+alteraciones)\b/i;

function isSubjectiveAgitationVsObservedMotorNonConflict(conflict, kinds) {
  const accounts = Array.isArray(conflict?.accounts) ? conflict.accounts : [];

  // Vía preferente: exige que el malestar subjetivo proceda del paciente y la ausencia de
  // activación motora proceda de psiquiatra/observación clínica. Son dominios compatibles,
  // no versiones mutuamente excluyentes.
  const patientSubjective = accounts.some((account) => {
    const kind = kinds.get(account?.source_id);
    return kind === "patient" && SUBJECTIVE_AGITATION_PATTERN.test(normalize(account?.statement));
  });
  const clinicianObserved = accounts.some((account) => {
    const kind = kinds.get(account?.source_id);
    return (kind === "psychiatrist" || kind === "clinician_observation")
      && OBSERVED_NO_MOTOR_ACTIVATION_PATTERN.test(normalize(account?.statement));
  });
  if (patientSubjective && clinicianObserved) return true;

  // Fallback conservador para salidas antiguas sin tipado de fuente suficiente.
  const topic = normalize(conflict?.topic);
  const statements = accounts.map((account) => normalize(account?.statement)).filter(Boolean);
  const combined = statements.join(" ");
  const agitationTopic = /\bagitacion\b|\bpsicomotric/.test(topic);
  return agitationTopic
    && SUBJECTIVE_AGITATION_PATTERN.test(combined)
    && OBSERVED_NO_MOTOR_ACTIVATION_PATTERN.test(combined);
}

export function applyClinicalPostprocessing(inputAssessment, transcript) {
  const assessment = structuredClone(inputAssessment);
  const warnings = [];

  // Temporalidad farmacológica: una mención inequívocamente pasada no puede aparecer
  // como tratamiento habitual activo aunque el modelo la haya clasificado así.
  for (const med of assessment.medications?.habitual || []) {
    const rawName = clean(med.raw_name) || clean(med.display_name);
    if (!rawName || med.status !== "active") continue;
    const temporality = inferMedicationTemporality(transcript, rawName);
    if (temporality === "historical") {
      med.status = "historical";
      med.adherence_status = "not_applicable";
      med.adherence_text = "";
      warnings.push(`medication_temporality_corrected_to_historical:${rawName}`);
    }
  }

  // Las tarjetas y el informe deben usar la entidad farmacológica ya verificada, no el
  // texto libre previo del modelo. Esto hace visible p. ej. Risperidona (Risperdal).
  syncMedicationSection(assessment, "habitual", "tratamiento_habitual", ["active"]);
  syncMedicationSection(assessment, "current", "tratamiento_actual", ["active", "administered_once"]);

  // Sentirse agitado y no mostrar inquietud motora son dimensiones compatibles; no es
  // una discrepancia entre fuentes por sí misma.
  const kinds = sourceKindMap(assessment);
  const originalConflicts = Array.isArray(assessment.conflicts) ? assessment.conflicts : [];
  assessment.conflicts = originalConflicts.filter((conflict) => {
    const prune = isSubjectiveAgitationVsObservedMotorNonConflict(conflict, kinds);
    if (prune) warnings.push("subjective_agitation_vs_observed_psychomotor_pseudoconflict_pruned");
    return !prune;
  });

  return {
    assessment,
    warnings,
    meta: {
      medication_temporality_grounded_in_transcript: true,
      medication_sections_synced_from_structured_entities: true,
      subjective_objective_pseudoconflict_guard: true,
      adherence_label_deduplicated: true,
    },
  };
}
