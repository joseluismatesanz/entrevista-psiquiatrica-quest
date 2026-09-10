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

  const topic = normalize(conflict?.topic);
  const statements = accounts.map((account) => normalize(account?.statement)).filter(Boolean);
  const combined = statements.join(" ");
  const agitationTopic = /\bagitacion\b|\bpsicomotric/.test(topic);
  return agitationTopic
    && SUBJECTIVE_AGITATION_PATTERN.test(combined)
    && OBSERVED_NO_MOTOR_ACTIVATION_PATTERN.test(combined);
}

const IDENTITY_SUBSTITUTION_BELIEF_PATTERN = /\b(?:no\s+es\s+(?:realmente\s+)?mi\s+(?:madre|padre)|podria\s+haber\s+sido\s+sustituid[oa]|puede\s+haber\s+sido\s+sustituid[oa]|ha\s+sido\s+sustituid[oa]|fue\s+sustituid[oa]|reemplazad[oa]|impostor(?:a)?|persona\s+distinta)\b/i;
const IDENTITY_REALITY_CHECK_PATTERN = /\b(?:soy\s+su\s+(?:madre|padre)\s+biologic[oa]|es\s+su\s+(?:madre|padre)\s+biologic[oa]|no\s+ha\s+habido\s+adopcion|no\s+hubo\s+adopcion|niega\s+adopcion|no\s+ha\s+habido\s+(?:ningun\s+)?cambio\s+de\s+cuidador|no\s+hubo\s+cambio\s+de\s+cuidador|niega\s+(?:un\s+)?cambio\s+de\s+cuidador)\b/i;

function isIdentitySubstitutionRealityCheckNonConflict(conflict, kinds) {
  const accounts = Array.isArray(conflict?.accounts) ? conflict.accounts : [];
  const patientBelief = accounts.some((account) => {
    const kind = kinds.get(account?.source_id);
    return kind === "patient" && IDENTITY_SUBSTITUTION_BELIEF_PATTERN.test(normalize(account?.statement));
  });
  if (!patientBelief) return false;

  const collateralRealityCheck = accounts.some((account) => {
    const kind = kinds.get(account?.source_id);
    return ["mother", "father", "family", "caregiver", "psychiatrist", "clinician_observation"].includes(kind)
      && IDENTITY_REALITY_CHECK_PATTERN.test(normalize(account?.statement));
  });

  return collateralRealityCheck;
}

const ENCOUNTER_ACCOMPANIMENT_PATTERN = /\b(?:acude\s+acompanad[oa]|acude\s+con\s+(?:su\s+)?(?:madre|padre|familiar|acompanante)|acompanad[oa]\s+por\s+(?:su\s+)?(?:madre|padre|familiar|acompanante)|participa\s+en\s+(?:la\s+)?(?:valoracion|entrevista)|esta\s+presente\s+(?:en|durante))\b/i;
const CONCRETE_SOCIOFAMILY_PATTERN = /\b(?:vive|convive|reside|domicilio|hogar|relacion|se\s+lleva|apoyo|red\s+de\s+apoyo|contacto\s+(?:frecuente|diario|semanal)|pareja|hij[oa]s?|custodia|escolariz|instituto|colegio|trabaj|emple|desemple|amig)\w*/i;

function pruneEncounterPresenceFromSociofamily(assessment, warnings) {
  const section = assessment.sections?.situacion_sociofamiliar;
  if (!section?.text) return;

  const sentences = String(section.text)
    .match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
  const retained = [];
  let pruned = false;

  for (const sentence of sentences) {
    const normalized = normalize(sentence);
    const encounterOnly = ENCOUNTER_ACCOMPANIMENT_PATTERN.test(normalized)
      && !CONCRETE_SOCIOFAMILY_PATTERN.test(normalized);
    if (encounterOnly) {
      pruned = true;
      continue;
    }
    retained.push(sentence);
  }

  if (!pruned) return;
  warnings.push("sociofamily_encounter_accompaniment_pruned_postprocess");
  section.text = retained.join(" ").trim();
  if (!section.text) {
    section.evidence_status = "insufficient";
    section.source_ids = [];
  }
}

function transcriptWithoutSpeakerLabels(transcript) {
  return String(transcript || "")
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:PSIQUIATRA|PACIENTE|MADRE|PADRE|HERMAN[OA]|CUIDADOR(?:A)?|ENFERMER[OA]|POLIC[IÍ]A|SEGURIDAD|OTRO)\s*:\s*/i, ""))
    .join("\n");
}

const MENTAL_HISTORY_EXPLORATION_PATTERN = /\b(?:antecedentes?\s+(?:psiquiatricos?|de\s+salud\s+mental)|diagnostic\w*\s+(?:previo|anterior|de|con)|ingres\w*\s+(?:previo|anterior|en\s+(?:psiquiatria|salud\s+mental|unidad))|hospitaliz\w*\s+(?:psiquiatr|salud\s+mental)|seguimiento\s+(?:por|en|con)\s+(?:salud\s+mental|psiquiatr|psicolog)|(?:voy|acudo|me\s+siguen|me\s+lleva[n]?)\s+(?:a|en|por|con)\s+(?:salud\s+mental|psiquiatr|psicolog)|psicoterapia\s+(?:previa|anterior|desde|actual)|episodio\s+(?:previo|anterior|psicotico|depresivo|maniaco)|intento\s+(?:autolitico|de\s+suicidio)\s+(?:previo|anterior)?|autolesion(?:es)?\s+(?:previas|anteriores)|urgencias\s+psiquiatricas?|tratamiento\s+(?:psiquiatrico|psicofarmacologico)\s+(?:previo|anterior)|desde\s+hace\s+\w+\s+(?:anos?|meses?)\s+(?:en|con)\s+(?:salud\s+mental|psiquiatr|psicolog))\b/i;

function guardMentalHistoryFromMedicationOnly(assessment, transcript, warnings) {
  const section = assessment.sections?.antecedentes_salud_mental;
  if (!section?.text || section.evidence_status === "not_explored") return;

  const explored = MENTAL_HISTORY_EXPLORATION_PATTERN.test(normalize(transcriptWithoutSpeakerLabels(transcript)));
  if (explored) return;

  const text = normalize(section.text);
  const medicationDerived = /\b(?:en\s+tratamiento\s+(?:psicofarmacologico|farmacologico)|tratamiento\s+(?:psicofarmacologico|farmacologico)\s+(?:habitual|actual|vigente)|medicacion\s+(?:psiquiatrica|psicofarmacologica)\s+(?:habitual|actual))\b/i.test(text);
  const onlyUnexploredRemainder = /\b(?:diagnostico|evolucion|antecedentes?\s+asistenciales?|ingresos?|seguimiento)\b.*\b(?:no\s+explorad|sin\s+explorar|no\s+consta|sin\s+datos)\b/i.test(text);

  if (!medicationDerived && !onlyUnexploredRemainder) return;

  section.text = "";
  section.evidence_status = "not_explored";
  section.source_ids = [];
  warnings.push("mental_history_not_inferred_from_current_psychotropic_medication");
}

const GENERIC_UNSPECIFIED_CONCERN_PATTERN = /\b(?:preocupacion\s+(?:materna|paterna|familiar)\s+(?:no\s+especificada|no\s+concretada|sin\s+especificar|sin\s+concretar)|(?:madre|padre|familia)\s+(?:preocupad[oa]|manifiesta\s+preocupacion)\s+(?:sin\s+especificar|sin\s+concretar))\b/i;

function pruneGenericUnspecifiedConcernFromMotive(assessment, warnings) {
  const section = assessment.sections?.motivo_consulta;
  if (!section?.text) return;

  const clauses = String(section.text)
    .split(/\s*;\s*|(?<=[.!?])\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (clauses.length < 2) return;

  const retained = clauses.filter((clause) => !GENERIC_UNSPECIFIED_CONCERN_PATTERN.test(normalize(clause)));
  if (!retained.length || retained.length === clauses.length) return;

  section.text = retained.join("; ").replace(/[;,.\s]+$/, "").trim();
  warnings.push("generic_unspecified_family_concern_pruned_from_motive");
}

export function applyClinicalPostprocessing(inputAssessment, transcript) {
  const assessment = structuredClone(inputAssessment);
  const warnings = [];

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

  syncMedicationSection(assessment, "habitual", "tratamiento_habitual", ["active"]);
  syncMedicationSection(assessment, "current", "tratamiento_actual", ["active", "administered_once"]);

  pruneEncounterPresenceFromSociofamily(assessment, warnings);
  guardMentalHistoryFromMedicationOnly(assessment, transcript, warnings);
  pruneGenericUnspecifiedConcernFromMotive(assessment, warnings);

  const kinds = sourceKindMap(assessment);
  const originalConflicts = Array.isArray(assessment.conflicts) ? assessment.conflicts : [];
  assessment.conflicts = originalConflicts.filter((conflict) => {
    if (isSubjectiveAgitationVsObservedMotorNonConflict(conflict, kinds)) {
      warnings.push("subjective_agitation_vs_observed_psychomotor_pseudoconflict_pruned");
      return false;
    }
    if (isIdentitySubstitutionRealityCheckNonConflict(conflict, kinds)) {
      warnings.push("identity_substitution_reality_check_pseudoconflict_pruned");
      return false;
    }
    return true;
  });

  return {
    assessment,
    warnings,
    meta: {
      medication_temporality_grounded_in_transcript: true,
      medication_sections_synced_from_structured_entities: true,
      subjective_objective_pseudoconflict_guard: true,
      identity_substitution_reality_check_guard: true,
      adherence_label_deduplicated: true,
      sociofamily_encounter_accompaniment_guard: true,
      mental_history_medication_only_guard: true,
      motive_generic_family_concern_guard: true,
    },
  };
}
