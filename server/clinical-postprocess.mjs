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

const FAMILY_SPEAKER_LABELS = new Set([
  "MADRE",
  "PADRE",
  "FAMILIAR",
  "CUIDADOR",
  "CUIDADORA",
  "CUIDADOR/A",
  "HERMANO",
  "HERMANA",
  "HERMANO/A",
]);
const FAMILY_SELF_MEDICATION_PATTERN = /\b(?:yo\s+)?(?:ahora\s+mismo\s+)?(?:estoy\s+tomando|estaba\s+tomando|tomo|tomaba|he\s+tomado|me\s+tomo)\b/i;
const COLLATERAL_PATIENT_MEDICATION_PATTERN = /\b(?:ella|el|él|mi\s+hij[oa]|la\s+paciente|le\s+(?:doy|damos|administro|administramos)|se\s+(?:la|lo)?\s*toma)\b/i;
const CURRENT_PLAN_ANCHOR_PATTERN = /\b(?:a\s+partir\s+de\s+(?:este\s+momento|ahora|hoy)|desde\s+ahora|tratamiento\s+que\s+tiene\s+que\s+hacer|le\s+voy\s+a\s+explicar\s+como\s+es\s+el\s+tratamiento|(?:voy|vamos)\s+a\s+(?:iniciar|poner|pautar|prescribir|indicar|dejar)|(?:inicio|iniciamos|pauto|pautamos|prescribo|prescribimos|indico|indicamos)\b)\b/i;
const CLINICIAN_PRESCRIPTION_PATTERN = /\b(?:debe(?:s)?\s+(?:de\s+)?tomar|debera\s+tomar|tomara|tome|se\s+toma|se\s+(?:indica|pauta|prescribe|inicia)|(?:voy|vamos)\s+a\s+(?:iniciar|poner|pautar|prescribir|indicar|dejar)|(?:inicio|iniciamos|pauto|pautamos|prescribo|prescribimos|indico|indicamos)|de\s+rescate|a\s+demanda|antes\s+de\s+dormir)\b/i;
const FAMILY_ADDRESS_PATTERN = /\b(?:señora|senora|madre|padre|familiar|cuidador(?:a)?)\b/i;
const FORMAL_ADDRESS_PATTERN = /\busted\b/i;
const MEDICATION_QUESTION_PATTERN = /\b(?:medicacion|medicación|tratamiento|pastillas?|toma(?:r|s)?|tomando)\b/i;
const HABITUAL_MEDICATION_QUESTION_PATTERN = /\b(?:(?:que|qué)\s+(?:tratamiento|medicacion|medicación)\s+(?:tomas?|toma)|(?:tomas?|toma)\s+(?:alguna\s+)?medicacion|tratamiento\s+habitual)\b/i;
const NO_CURRENT_MEDICATION_PATTERN = /\b(?:no\s+(?:tomo|toma|estoy\s+tomando|esta\s+tomando|está\s+tomando)|ningun[ao]?\s+(?:medicacion|medicación|tratamiento)|sin\s+(?:medicacion|medicación|tratamiento))\b/i;

function speakerLines(transcript) {
  return String(transcript || "")
    .split(/\n+/)
    .map((line, index) => {
      const match = line.match(/^\s*([A-ZÁÉÍÓÚÜÑ_/ ]+)\s*:\s*(.*)$/u);
      if (!match) return null;
      return { index, speaker: match[1].toUpperCase(), text: match[2].trim() };
    })
    .filter(Boolean);
}

function previousSpeakerLine(lines, line) {
  const position = lines.indexOf(line);
  return position > 0 ? lines[position - 1] : null;
}

function previousPsychiatristLine(lines, line) {
  const position = lines.indexOf(line);
  for (let index = position - 1; index >= 0; index -= 1) {
    if (lines[index]?.speaker === "PSIQUIATRA") return lines[index];
  }
  return null;
}

function previousNonPsychiatristLine(lines, line) {
  const position = lines.indexOf(line);
  for (let index = position - 1; index >= 0; index -= 1) {
    if (lines[index]?.speaker !== "PSIQUIATRA") return lines[index];
  }
  return null;
}

function isFamilySelfMedicationLine(lines, line) {
  const text = normalize(line?.text);
  const previousQuestion = previousPsychiatristLine(lines, line);
  const previousQuestionText = normalize(previousQuestion?.text);
  const priorRespondent = previousQuestion
    ? previousNonPsychiatristLine(lines, previousQuestion)
    : null;
  const continuesFormalFamilyTurn = FORMAL_ADDRESS_PATTERN.test(previousQuestionText)
    && FAMILY_SPEAKER_LABELS.has(priorRespondent?.speaker);
  const familyDirectedMedicationQuestion = previousQuestion
    && (FAMILY_ADDRESS_PATTERN.test(previousQuestionText) || continuesFormalFamilyTurn)
    && MEDICATION_QUESTION_PATTERN.test(previousQuestionText);

  // Si la pregunta del psiquiatra iba expresamente dirigida a la madre/padre,
  // una respuesta elíptica como «la medicación que toma es...» pertenece al
  // familiar salvo que nombre de forma inequívoca a la paciente.
  if (familyDirectedMedicationQuestion && !COLLATERAL_PATIENT_MEDICATION_PATTERN.test(text)) {
    return true;
  }

  if (!FAMILY_SELF_MEDICATION_PATTERN.test(text)) return false;
  if (FAMILY_SPEAKER_LABELS.has(line?.speaker)) return true;

  // La atribución automática puede etiquetar como PACIENTE la respuesta de la
  // madre. Una pregunta inmediatamente anterior dirigida de forma explícita a
  // la señora/madre/padre fija la propiedad aunque falle esa etiqueta.
  return familyDirectedMedicationQuestion;
}

function medicationCandidateNames(med) {
  const values = [
    med?.raw_name,
    med?.display_name,
    med?.medication_verification?.queriedName,
    ...(med?.medication_verification?.activeIngredients || []),
  ].map(normalize).filter(Boolean);
  const expanded = [];
  for (const value of values) {
    expanded.push(value);
    const withoutParentheses = value.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    if (withoutParentheses) expanded.push(withoutParentheses);
    for (const part of value.split(/[()/,;+]/).map((x) => x.trim()).filter(Boolean)) expanded.push(part);
  }
  return [...new Set(expanded.filter((value) => value.length >= 4))];
}

function lineMentionsMedication(line, med) {
  const text = normalize(line?.text);
  return medicationCandidateNames(med).some((candidate) => text.includes(candidate));
}

function medicationPlanCutoffIndex(lines, med, planAnchorIndex) {
  const firstExplicitPrescription = lines.find((line) =>
    line.speaker === "PSIQUIATRA"
    && lineMentionsMedication(line, med)
    && CLINICIAN_PRESCRIPTION_PATTERN.test(normalize(line.text))
  );
  return Math.min(planAnchorIndex, firstExplicitPrescription?.index ?? Number.POSITIVE_INFINITY);
}

function pruneFamilySelfMedicationOwnership(assessment, transcript, warnings) {
  const lines = speakerLines(transcript);
  if (!lines.length) return;
  const planAnchor = lines.find((line) => line.speaker === "PSIQUIATRA" && CURRENT_PLAN_ANCHOR_PATTERN.test(normalize(line.text)));
  const planAnchorIndex = planAnchor?.index ?? Number.POSITIVE_INFINITY;

  const hasFamilySelfMention = (med) => lines.some((line) =>
    lineMentionsMedication(line, med)
    && isFamilySelfMedicationLine(lines, line)
  );

  const hasHabitualPatientEvidence = (med) => lines.some((line) => {
    const medicationPlanIndex = medicationPlanCutoffIndex(lines, med, planAnchorIndex);
    if (line.index >= medicationPlanIndex || !lineMentionsMedication(line, med)) return false;
    if (line.speaker === "PACIENTE") return !isFamilySelfMedicationLine(lines, line);
    if (FAMILY_SPEAKER_LABELS.has(line.speaker)) {
      const text = normalize(line.text);
      return !FAMILY_SELF_MEDICATION_PATTERN.test(text)
        && COLLATERAL_PATIENT_MEDICATION_PATTERN.test(text);
    }
    return false;
  });

  const hasCurrentPatientEvidence = (med) => lines.some((line) => {
    const medicationPlanIndex = medicationPlanCutoffIndex(lines, med, planAnchorIndex);
    if (!lineMentionsMedication(line, med)) return false;
    if (line.speaker === "PACIENTE" && line.index >= medicationPlanIndex) return true;
    if (FAMILY_SPEAKER_LABELS.has(line.speaker)) {
      const text = normalize(line.text);
      return !FAMILY_SELF_MEDICATION_PATTERN.test(text)
        && COLLATERAL_PATIENT_MEDICATION_PATTERN.test(text);
    }
    if (line.speaker !== "PSIQUIATRA") return false;
    const text = normalize(line.text);
    return line.index >= medicationPlanIndex || CLINICIAN_PRESCRIPTION_PATTERN.test(text);
  });

  for (const [group, hasPatientEvidence] of [
    ["habitual", hasHabitualPatientEvidence],
    ["current", hasCurrentPatientEvidence],
  ]) {
    const list = assessment.medications?.[group];
    if (!Array.isArray(list) || !list.length) continue;
    const filtered = list.filter((med) => {
      if (!hasFamilySelfMention(med) || hasPatientEvidence(med)) return true;
      const name = clean(med.display_name) || clean(med.raw_name) || "medicamento";
      warnings.push(`medication_family_self_use_pruned_from_patient_${group}:${name}`);
      return false;
    });
    assessment.medications[group] = filtered;

    if (filtered.length === 0 && filtered.length !== list.length) {
      const sectionKey = group === "habitual" ? "tratamiento_habitual" : "tratamiento_actual";
      const section = assessment.sections?.[sectionKey];
      if (section) {
        section.text = "";
        section.evidence_status = "not_provided";
        section.source_ids = [];
      }
    }
  }

  const habitual = Array.isArray(assessment.medications?.habitual)
    ? assessment.medications.habitual
    : [];
  const current = Array.isArray(assessment.medications?.current)
    ? assessment.medications.current
    : [];

  const overlaps = (left, right) => {
    const a = new Set(medicationCandidateNames(left));
    return medicationCandidateNames(right).some((name) => a.has(name));
  };

  const retainedHabitual = [];
  for (const med of habitual) {
    const onlyNewPrescription = !hasHabitualPatientEvidence(med) && hasCurrentPatientEvidence(med);
    if (!onlyNewPrescription) {
      retainedHabitual.push(med);
      continue;
    }

    if (!current.some((existing) => overlaps(existing, med))) {
      current.push({ ...med, status: "active" });
    }
    const name = clean(med.display_name) || clean(med.raw_name) || "medicamento";
    warnings.push(`medication_new_prescription_moved_habitual_to_current:${name}`);
  }

  assessment.medications.habitual = retainedHabitual;
  assessment.medications.current = current;

  // Una pauta iniciada en esta consulta todavía no tiene adherencia observable.
  // Si el único respaldo del fármaco es una prescripción del psiquiatra posterior
  // al anclaje del nuevo plan, se elimina cualquier adherencia arrastrada por el modelo.
  for (const med of assessment.medications.current || []) {
    const newlyPrescribed = !hasHabitualPatientEvidence(med) && hasCurrentPatientEvidence(med);
    if (!newlyPrescribed) continue;
    if (med.adherence_status !== "unknown" || clean(med.adherence_text)) {
      med.adherence_status = "unknown";
      med.adherence_text = "";
      const name = clean(med.display_name) || clean(med.raw_name) || "medicamento";
      warnings.push(`medication_new_prescription_adherence_cleared:${name}`);
    }
  }

  if (retainedHabitual.length !== habitual.length && retainedHabitual.length === 0) {
    const section = assessment.sections?.tratamiento_habitual;
    if (section) {
      section.text = "";
      section.evidence_status = "not_provided";
      section.source_ids = [];
    }
  }
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

function lineSupportsPreexistingMedication(lines, line, med, planAnchorIndex) {
  if (line.index >= planAnchorIndex) return false;
  if (med && !lineMentionsMedication(line, med)) return false;
  if (isFamilySelfMedicationLine(lines, line)) return false;

  const evidenceTexts = med
    ? transcriptUnits(line.text)
      .filter((unit) => lineMentionsMedication({ ...line, text: unit }, med))
      .map(normalize)
    : [normalize(line.text)];

  if (line.speaker === "PACIENTE") {
    const previous = previousSpeakerLine(lines, line);
    return evidenceTexts.some((text) => {
      if (NO_CURRENT_MEDICATION_PATTERN.test(text)) return false;
      if (ACTIVE_MEDICATION_PATTERN.test(text) && !HISTORICAL_MEDICATION_PATTERN.test(text)) return true;
      return previous?.speaker === "PSIQUIATRA"
        && HABITUAL_MEDICATION_QUESTION_PATTERN.test(normalize(previous.text))
        && !HISTORICAL_MEDICATION_PATTERN.test(text);
    });
  }

  if (FAMILY_SPEAKER_LABELS.has(line.speaker)) {
    return evidenceTexts.some((text) =>
      !NO_CURRENT_MEDICATION_PATTERN.test(text)
      && COLLATERAL_PATIENT_MEDICATION_PATTERN.test(text)
      && !FAMILY_SELF_MEDICATION_PATTERN.test(text)
    );
  }

  return false;
}

function enforceHabitualMedicationEvidence(assessment, transcript, warnings) {
  const lines = speakerLines(transcript);
  if (!lines.length) return;

  const planAnchor = lines.find((line) =>
    line.speaker === "PSIQUIATRA" && CURRENT_PLAN_ANCHOR_PATTERN.test(normalize(line.text))
  );
  const planAnchorIndex = planAnchor?.index ?? Number.POSITIVE_INFINITY;
  const habitual = Array.isArray(assessment.medications?.habitual)
    ? assessment.medications.habitual
    : [];

  const retained = habitual.filter((med) => {
    if (med?.status !== "active") return true;
    const medicationPlanIndex = medicationPlanCutoffIndex(lines, med, planAnchorIndex);
    const supported = lines.some((line) =>
      lineSupportsPreexistingMedication(lines, line, med, medicationPlanIndex)
    );
    if (!supported) {
      const name = clean(med.display_name) || clean(med.raw_name) || "medicamento";
      warnings.push(`medication_habitual_pruned_without_preexisting_evidence:${name}`);
    }
    return supported;
  });

  assessment.medications.habitual = retained;

  const hasActiveStructuredMedication = retained.some((med) => med?.status === "active");
  const hasAnyExplicitPreexistingMedication = lines.some((line) =>
    lineSupportsPreexistingMedication(lines, line, null, planAnchorIndex)
  );

  if (!hasActiveStructuredMedication && !hasAnyExplicitPreexistingMedication) {
    const section = assessment.sections?.tratamiento_habitual;
    if (section) {
      section.text = "";
      section.evidence_status = "not_provided";
      section.source_ids = [];
    }
  }
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
const MEDICATION_SUPERVISION_PATTERN = /(?:\b(?:supervis|control|comprueb|vigil|administra|se\s+asegura)\w*\b[^.!?]*\b(?:medicacion|tratamiento|pastill\w*|dosis|toma(?:r|s|n)?)\b|\b(?:medicacion|tratamiento|pastill\w*|dosis|toma(?:r|s|n)?)\b[^.!?]*\b(?:supervis|control|comprueb|vigil|administra|se\s+asegura)\w*\b)/i;

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

function pruneMedicationSupervisionFromSociofamily(assessment, warnings) {
  const section = assessment.sections?.situacion_sociofamiliar;
  if (!section?.text) return;

  const sentences = String(section.text)
    .match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
  const retained = [];
  let pruned = false;

  for (const sentence of sentences) {
    const normalized = normalize(sentence);
    const medicationOnly = MEDICATION_SUPERVISION_PATTERN.test(normalized)
      && !CONCRETE_SOCIOFAMILY_PATTERN.test(normalized);
    if (medicationOnly) {
      pruned = true;
      continue;
    }
    retained.push(sentence);
  }

  if (!pruned) return;
  warnings.push("sociofamily_medication_supervision_pruned_postprocess");
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

  pruneFamilySelfMedicationOwnership(assessment, transcript, warnings);

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

  // Guarda final: tras CIMA, correcciones de temporalidad y enriquecimiento de
  // adherencia, solo puede quedar como habitual una pauta inequívocamente previa.
  enforceHabitualMedicationEvidence(assessment, transcript, warnings);

  syncMedicationSection(assessment, "habitual", "tratamiento_habitual", ["active"]);
  syncMedicationSection(assessment, "current", "tratamiento_actual", ["active", "administered_once"]);

  pruneEncounterPresenceFromSociofamily(assessment, warnings);
  pruneMedicationSupervisionFromSociofamily(assessment, warnings);
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
      sociofamily_medication_supervision_guard: true,
      mental_history_medication_only_guard: true,
      motive_generic_family_concern_guard: true,
      medication_family_self_use_guard: true,
      medication_new_prescription_temporality_guard: true,
      medication_new_prescription_adherence_guard: true,
      medication_habitual_preexisting_evidence_guard: true,
    },
  };
}
