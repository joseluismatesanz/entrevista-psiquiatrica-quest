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

function medicationLine(med) {
  const name = clean(med.display_name) || clean(med.raw_name) || "Medicamento no identificado";
  const dose = clean(med.dose);
  const schedule = clean(med.schedule);
  const route = clean(med.route);
  const adherence = clean(med.adherence_text);

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

function isSubjectiveAgitationVsObservedMotorNonConflict(conflict) {
  const topic = normalize(conflict?.topic);
  const statements = (conflict?.accounts || []).map((account) => normalize(account?.statement)).filter(Boolean);
  const combined = [topic, ...statements].join(" ");

  const subjective = /\b(?:agitacion\s+subjetiva|subjetiv\w*|se\s+siente\s+agitad|refiere\s+(?:estar\s+)?agitad|manifiesta\s+(?:estar\s+)?agitad|nervios\w*)\b/i.test(combined);
  const observedNoMotorActivation = /\b(?:sin\s+inquietud\s+motora|no\s+se\s+objetiva\s+inquietud\s+motora|sin\s+agitacion\s+psicomotriz|permanece\s+sentad[oa]|psicomotricidad\s+sin\s+alteraciones)\b/i.test(combined);
  const framing = /\b(?:frente\s+a|versus|vs\.?|discrepancia|contradiccion)\b/i.test(topic);

  return subjective && observedNoMotorActivation && (framing || /subjetiv/.test(topic));
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
  const originalConflicts = Array.isArray(assessment.conflicts) ? assessment.conflicts : [];
  assessment.conflicts = originalConflicts.filter((conflict) => {
    const prune = isSubjectiveAgitationVsObservedMotorNonConflict(conflict);
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
    },
  };
}
