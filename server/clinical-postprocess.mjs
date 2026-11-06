import { normalizeMedicationAsrText } from "./medication-asr-normalization.mjs";
import { PSYCHIATRIC_MEDICATION_VOCABULARY } from "./medication-name-aliases.mjs";

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
const PATIENT_SPEAKER_PATTERN = /^(?:PACIENTE|ENTREVISTAD[OA]|USUARI[OA])(?:\s+\d+)?$/i;
const FAMILY_SELF_MEDICATION_PATTERN = /\b(?:yo\s+)?(?:ahora\s+mismo\s+)?(?:estoy\s+tomando|estaba\s+tomando|tomo|tomaba|he\s+tomado|me\s+tomo)\b/i;
const COLLATERAL_PATIENT_MEDICATION_PATTERN = /\b(?:ella|el|él|mi\s+hij[oa]|la\s+paciente|le\s+(?:doy|damos|administro|administramos)|se\s+(?:la|lo)?\s*toma)\b/i;
const CURRENT_PLAN_ANCHOR_PATTERN = /\b(?:a\s+partir\s+de\s+(?:este\s+momento|ahora|hoy)|desde\s+ahora|tratamiento\s+que\s+tiene\s+que\s+hacer|le\s+voy\s+a\s+explicar\s+como\s+es\s+el\s+tratamiento|(?:voy|vamos)\s+a\s+(?:iniciar|poner|pautar|prescribir|indicar|dejar)|(?:inicio|iniciamos|pauto|pautamos|prescribo|prescribimos|indico|indicamos)\b)\b/i;
const CLINICIAN_PRESCRIPTION_PATTERN = /\b(?:debe(?:s)?\s+(?:de\s+)?tomar|debera\s+tomar|tomara|tome|se\s+toma|se\s+(?:indica|pauta|prescribe|inicia)|(?:voy|vamos)\s+a\s+(?:iniciar|poner|pautar|prescribir|indicar|dejar)|(?:inicio|iniciamos|pauto|pautamos|prescribo|prescribimos|indico|indicamos)|de\s+rescate|a\s+demanda|antes\s+de\s+dormir)\b/i;
const CLINICIAN_MAINTENANCE_PATTERN = /\b(?:mantener|mantengo|mantenemos|mantenga|continuar|continua|contin\u00fao|seguimos\s+con|seguir\s+con|sin\s+cambios|misma\s+pauta|resto\s+del\s+tratamiento)\b/i;
const CLINICIAN_TREATMENT_CHANGE_PATTERN = /\b(?:iniciar|inicio|inicia|iniciamos|introducir|introduzco|introduce|introducimos|anadir|anado|anade|anadimos|empezar|comenzar|sustituir|sustituye|cambiar|cambio|cambia|cambiamos|aumentar|aumento|aumenta|aumentamos|incrementar|incremento|incrementa|incrementamos|subir|subo|sube|subimos|reducir|reduzco|reduce|reducimos|disminuir|disminuyo|disminuye|disminuimos|bajar|bajo|baja|bajamos|ajustar|ajusto|ajusta|ajustamos|titular|titulo|titula|titulamos)\b/i;
const CLINICIAN_DISCONTINUATION_PATTERN = /\b(?:retirar|retiro|retiramos|suspender|suspendo|suspendemos|suprimir|suprimo|suprimimos|quitar|quito|quitamos|dejar\s+de\s+tomar|no\s+continuar|sustituir|sustituyo|sustituimos)\b/i;
const FAMILY_ADDRESS_PATTERN = /\b(?:señora|senora|madre|padre|familiar|cuidador(?:a)?)\b/i;
const FORMAL_ADDRESS_PATTERN = /\busted\b/i;
const MEDICATION_QUESTION_PATTERN = /\b(?:medicacion|medicación|tratamiento|pastillas?|toma(?:r|s)?|tomando)\b/i;
const HABITUAL_MEDICATION_QUESTION_PATTERN = /\b(?:(?:que|qué)\s+(?:tratamiento|medicacion|medicación)\s+(?:tomas?|toma)|(?:tomas?|toma)\s+(?:alguna\s+)?medicacion|tratamiento\s+habitual)\b/i;
const NO_CURRENT_MEDICATION_PATTERN = /\b(?:no\s+(?:tomo|toma|estoy\s+tomando|esta\s+tomando|está\s+tomando)|ningun[ao]?\s+(?:medicacion|medicación|tratamiento)|sin\s+(?:medicacion|medicación|tratamiento))\b/i;
const MEDICATION_NOUN_PATTERN = /\b(?:medicacion|medicación|tratamiento|pastillas?)\b/i;

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

function isPatientSpeaker(label) {
  return PATIENT_SPEAKER_PATTERN.test(String(label || "").trim());
}

function recoverExplicitPatientHabitualMedications(assessment, transcript, warnings) {
  const lines = speakerLines(transcript);
  if (!lines.length) return;
  assessment.medications ||= {};
  const habitual = Array.isArray(assessment.medications.habitual)
    ? assessment.medications.habitual
    : [];
  const patientSourceId = (assessment.sources || []).find((source) => source.kind === "patient")?.id;

  for (const line of lines) {
    const previous = previousSpeakerLine(lines, line);
    const answersHabitualQuestion = previous?.speaker === "PSIQUIATRA"
      && HABITUAL_MEDICATION_QUESTION_PATTERN.test(normalize(previous.text));
    const explicitClinicianHistory = line.speaker === "PSIQUIATRA"
      && /\b(?:tratamiento\s+habitual|hasta\s+(?:ahora|hoy)|venia\s+tomando|estaba\s+tomando|actualmente\s+toma|esta\s+tomando)\b/i.test(normalize(line.text))
      && !CLINICIAN_TREATMENT_CHANGE_PATTERN.test(normalize(line.text));
    // La atribución por bloques puede marcar como PSIQUIATRA una respuesta corta
    // que enumera medicación. La pregunta inmediatamente anterior fija que esa
    // lista es la pauta previa aunque el rol acústico haya fallado.
    if ((!isPatientSpeaker(line.speaker) && !explicitClinicianHistory && !answersHabitualQuestion) || isFamilySelfMedicationLine(lines, line)) continue;
    const text = normalize(normalizeMedicationAsrText(line.text).text);
    const statesActiveTreatment = ACTIVE_MEDICATION_PATTERN.test(text)
      && !HISTORICAL_MEDICATION_PATTERN.test(text)
      && !NO_CURRENT_MEDICATION_PATTERN.test(text);
    if (!answersHabitualQuestion && !statesActiveTreatment) continue;

    const mentionedMedications = PSYCHIATRIC_MEDICATION_VOCABULARY
      .map((canonical) => {
        const wanted = normalize(canonical);
        const match = new RegExp(`\\b${wanted}\\b`, "i").exec(text);
        return { canonical, wanted, medicationIndex: match?.index ?? -1 };
      })
      .filter(({ medicationIndex }) => medicationIndex >= 0)
      .sort((left, right) => left.medicationIndex - right.medicationIndex);

    for (let index = 0; index < mentionedMedications.length; index += 1) {
      const { canonical, wanted, medicationIndex } = mentionedMedications[index];
      if (habitual.some((med) => medicationCandidateNames(med).includes(wanted))) continue;

      const nextMedicationIndex = mentionedMedications[index + 1]?.medicationIndex;
      const nearbyEnd = Number.isInteger(nextMedicationIndex)
        ? nextMedicationIndex
        : medicationIndex + wanted.length + 100;
      const nearby = text.slice(medicationIndex + wanted.length, nearbyEnd)
        .split(/\s+y\s+(?=[a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}\s+\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|g|ml|ui)\b)/i)[0];
      const dose = nearby.match(/\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|ui|miligramos?)\b/i);
      const schedules = nearby.match(/\b(?:por\s+la\s+manana|por\s+la\s+noche|al\s+mediodia|en\s+la\s+comida|antes\s+de\s+dormir|para\s+dormir|a\s+demanda|cada\s+\d+\s+horas?|\d+\s+veces?\s+al\s+dia)\b/gi);
      habitual.push({
        raw_name: canonical[0].toUpperCase() + canonical.slice(1),
        display_name: canonical[0].toUpperCase() + canonical.slice(1),
        active_ingredient_known: true,
        role: "psychiatric",
        dose: dose ? `${dose[1]} ${/^mili/i.test(dose[2]) ? "mg" : dose[2]}` : "",
        schedule: schedules?.length ? [...new Set(schedules)].join(" y ") : "",
        route: "",
        prn: /\ba\s+demanda\b/i.test(nearby),
        adherence_status: "unknown",
        adherence_text: "",
        status: "active",
        source_ids: patientSourceId ? [patientSourceId] : [],
      });
      warnings.push(`medication_habitual_recovered_from_explicit_patient_statement:${canonical}`);
    }
  const doseMedicationPattern = /\b([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2})\s+(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|µg|g|ml|ui|miligramos?)\b/giu;
    const contextWords = new Set([
      "tomo", "toma", "tomando", "estoy", "estaba", "tratamiento", "medicacion",
      "farmaco", "pauta", "con", "de", "del", "por", "para", "la", "el", "los",
      "las", "un", "una", "al", "en", "cada", "dia", "y", "e", "manana", "noche",
      "mediodia", "dosis", "oral", "actualmente", "habitual", "antes",
    ]);
    for (const match of text.matchAll(doseMedicationPattern)) {
      const words = match[1].split(/\s+/);
      while (words.length && contextWords.has(normalize(words[0]))) words.shift();
      while (words.length && contextWords.has(normalize(words.at(-1)))) words.pop();
      const candidate = words.join(" ").trim();
      if (!candidate || normalize(candidate).length < 4) continue;
      const candidateNames = medicationCandidateNames({ raw_name: candidate, display_name: candidate });
      if (habitual.some((med) => medicationCandidateNames(med).some((name) => candidateNames.includes(name)))) continue;
      const matchingCurrent = (assessment.medications?.current || []).find((med) =>
        medicationCandidateNames(med).some((name) => candidateNames.includes(name))
      );

      const afterDose = text.slice(match.index + match[0].length, match.index + match[0].length + 100);
      const schedules = afterDose.match(/\b(?:por\s+la\s+manana|por\s+la\s+noche|al\s+mediodia|en\s+la\s+comida|antes\s+de\s+dormir|para\s+dormir|a\s+demanda|cada\s+\d+\s+horas?|\d+\s+veces?\s+al\s+dia)\b/gi);
      const canonicalName = candidate.charAt(0).toLocaleUpperCase("es") + candidate.slice(1);
      habitual.push({
        raw_name: canonicalName,
        display_name: clean(matchingCurrent?.display_name) || canonicalName,
        active_ingredient_known: Boolean(matchingCurrent?.active_ingredient_known),
        role: matchingCurrent?.role || "unknown",
        dose: match[2] + " " + (/^mili/i.test(match[3]) ? "mg" : match[3]),
        schedule: schedules?.length ? [...new Set(schedules)].join(" y ") : "",
        route: clean(matchingCurrent?.route),
        prn: /\ba\s+demanda\b/i.test(afterDose),
        adherence_status: "unknown",
        adherence_text: "",
        status: "active",
        source_ids: patientSourceId ? [patientSourceId] : [],
      });
      warnings.push("medication_habitual_recovered_from_explicit_patient_dose_statement:" + canonicalName);
    }
  }


  assessment.medications.habitual = habitual;
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

function recoverExplicitToxicHabits(assessment, transcript, warnings) {
  const lines = speakerLines(transcript);
  const substancePattern = /\b(?:tabaco|fuma|cigarr|alcohol|cerveza|vino|licor|cannabis|porros?|marihuana|cocaina|cocaína|heroina|heroína|anfetaminas?|drogas?|sustancias?)\b/i;
  const answerPattern = /\b(?:nieg[oa]|no\s+(?:fumo|bebo|tomo|consumo)|consum[oa]|fum[oa]|beb[oa]|abstinencia|abstinente|lleva\s+\w+\s+sin)\b/i;
  const candidates = [];

  for (const line of lines) {
    if (!isPatientSpeaker(line.speaker)) continue;
    const text = line.text.trim();
    const previous = previousSpeakerLine(lines, line);
    const answersSubstanceQuestion = previous?.speaker === "PSIQUIATRA" && substancePattern.test(previous.text);
    if (!substancePattern.test(text) && !answersSubstanceQuestion) continue;
    if (!answerPattern.test(text) && !answersSubstanceQuestion) continue;
    candidates.push(text);
  }

  if (!candidates.length) return;
  const section = assessment.sections?.habitos_toxicos;
  if (!section) return;
  section.text = [...new Set(candidates)].join(" ");
  section.evidence_status = "supported";
  const patientSourceId = (assessment.sources || []).find((source) => source.kind === "patient")?.id;
  section.source_ids = patientSourceId ? [patientSourceId] : [];
  warnings.push("toxic_habits_recovered_from_explicit_patient_statement");
}

const EXPLICIT_DIAGNOSIS_CATALOG = [
  { pattern: /\banorexia\s+nerviosa\b/i, name: "Anorexia nerviosa", cie10: "F50.0", dsm5: "307.1" },
  { pattern: /\btrastorno\s+de\s+ansiedad\s+generalizada\b/i, name: "Trastorno de ansiedad generalizada", cie10: "F41.1", dsm5: "300.02" },
  { pattern: /\btrastorno\s+de\s+la\s+conducta\s+alimentaria(?:\s+no\s+especificad[oa])?\b/i, name: "Trastorno de la conducta alimentaria no especificado", cie10: "F50.9", dsm5: "307.50" },
  { pattern: /\bepisodio\s+depresivo\s+moderado\b/i, name: "Episodio depresivo moderado", cie10: "F32.1", dsm5: "296.22" },
  { pattern: /\bpsicosis\s+no\s+especificada\b/i, name: "Psicosis no especificada", cie10: "F29", dsm5: "298.9" },
];

function recoverExplicitClinicianDiagnosis(assessment, transcript, warnings) {
  const explicitAnchor = /\b(?:diagnostico|diagnóstico|juicio\s+clinico|juicio\s+clínico|presenta|padece|se\s+trata\s+de|estamos\s+ante)\b/i;
  const clinicianText = speakerLines(transcript)
    .filter((line) => (line.speaker === "PSIQUIATRA" || isPatientSpeaker(line.speaker))
      && (explicitAnchor.test(line.text) || EXPLICIT_DIAGNOSIS_CATALOG.some((item) => item.pattern.test(line.text))))
    .map((line) => line.text)
    .join(" ");
  if (!clinicianText || clean(assessment.diagnostic_judgment?.primary_diagnosis)) return;

  const match = EXPLICIT_DIAGNOSIS_CATALOG.find((item) => item.pattern.test(clinicianText));
  if (!match) return;
  assessment.diagnostic_judgment ||= {};
  assessment.diagnostic_judgment.primary_diagnosis = match.name;
  assessment.diagnostic_judgment.cie10_code = match.cie10;
  assessment.diagnostic_judgment.dsm5_code = match.dsm5;
  assessment.diagnostic_judgment.provisional = /\b(?:posible|probable|provisional|compatible\s+con|sugiere)\b/i.test(clinicianText);
  assessment.diagnostic_judgment.basis_summary = "Diagnóstico expresamente indicado durante la valoración.";
  assessment.diagnostic_judgment.requires_clinician_validation = true;
  const section = assessment.sections?.orientacion_diagnostica;
  if (section) {
    section.text = `JUICIO CLÍNICO: ${match.name}. CIE-10: ${match.cie10}. DSM-5-TR: ${match.dsm5}.`;
    section.evidence_status = "supported";
    const psychiatristId = (assessment.sources || []).find((source) => source.kind === "psychiatrist")?.id;
    section.source_ids = psychiatristId ? [psychiatristId] : [];
  }
  if (Array.isArray(assessment.missing_or_not_explored)) {
    assessment.missing_or_not_explored = assessment.missing_or_not_explored.filter((item) =>
      !/orientacion\s+diagnostica|diagnostico|juicio\s+clinico/i.test(normalize(item?.topic))
    );
  }
  warnings.push("diagnostic_judgment_recovered_from_explicit_clinician_statement");
}

function recoverMedicationReviewEncounterContext(assessment, transcript, warnings) {
  const lines = speakerLines(transcript);
  const hasExplicitChange = lines.some((line) =>
    line.speaker === "PSIQUIATRA"
    && CLINICIAN_TREATMENT_CHANGE_PATTERN.test(normalize(line.text))
    && (MEDICATION_NOUN_PATTERN.test(normalize(line.text))
      || PSYCHIATRIC_MEDICATION_VOCABULARY.some((name) => normalize(normalizeMedicationAsrText(line.text).text).includes(normalize(name))))
  );
  if (!hasExplicitChange) return;

  const psychiatristId = (assessment.sources || []).find((source) => source.kind === "psychiatrist")?.id;
  const patientId = (assessment.sources || []).find((source) => source.kind === "patient")?.id;
  const sourceIds = [psychiatristId, patientId].filter(Boolean);
  const diagnosis = clean(assessment.diagnostic_judgment?.primary_diagnosis);

  const motive = assessment.sections?.motivo_consulta;
  if (motive && !clean(motive.text)) {
    motive.text = "Revisión y modificación del tratamiento farmacológico.";
    motive.evidence_status = "supported";
    motive.source_ids = sourceIds;
    warnings.push("motive_recovered_from_explicit_medication_change");
  }

  const illness = assessment.sections?.enfermedad_actual;
  if (illness && !clean(illness.text)) {
    illness.text = diagnosis
      ? `En seguimiento por ${diagnosis.toLocaleLowerCase("es")}, acude para revisión y modificación del tratamiento farmacológico.`
      : "Acude para revisión y modificación del tratamiento farmacológico.";
    illness.evidence_status = "supported";
    illness.source_ids = sourceIds;
    warnings.push("current_illness_recovered_from_explicit_medication_change");
  }
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
  const text = normalize(normalizeMedicationAsrText(line?.text).text);
  return medicationCandidateNames(med).some((candidate) => text.includes(candidate));
}

function medicationPlanCutoffIndex(lines, med, planAnchorIndex) {
  const firstExplicitPrescription = lines.find((line) => {
    if (line.speaker !== "PSIQUIATRA" || !(lineMentionsMedication(line, med) || [med.raw_name, med.display_name].some((name) => normalize(name) && normalize(line.text).includes(normalize(name))))) return false;
    const text = normalize(line.text);
    const previous = previousSpeakerLine(lines, line);
    const isHabitualAnswer = previous?.speaker === "PSIQUIATRA"
      && HABITUAL_MEDICATION_QUESTION_PATTERN.test(normalize(previous.text))
      && !CLINICIAN_TREATMENT_CHANGE_PATTERN.test(text)
      && !CLINICIAN_DISCONTINUATION_PATTERN.test(text);
    if (isHabitualAnswer) return false;
    return CLINICIAN_PRESCRIPTION_PATTERN.test(text)
      || CLINICIAN_TREATMENT_CHANGE_PATTERN.test(text)
      || CLINICIAN_DISCONTINUATION_PATTERN.test(text);
  });
  // Una presentación genérica al inicio (p. ej. «soy psiquiatra y voy a
  // valorar...») no puede convertir en pauta nueva la medicación que el
  // paciente enumera después. El corte debe ser específico de cada fármaco.
  if (med) return firstExplicitPrescription?.index ?? Number.POSITIVE_INFINITY;
  return Math.min(planAnchorIndex, firstExplicitPrescription?.index ?? Number.POSITIVE_INFINITY);
}

function substitutionPriorMedicationPhrases(value) {
  const phrases = [];
  for (const clause of String(value || "").split(/[.;\n]+/)) {
    const match = clause.match(/\bsustituir\s+(.+?)\s+por\s+/i);
    if (!match) continue;
    const priorParts = [match[1]];
    const remainder = clause.slice((match.index ?? 0) + match[0].length);
    for (const chained of remainder.matchAll(/\s+y\s+((?:el|la|los|las)\s+)?([^,.;]+?)\s+por\s+(?!la\b|el\b|una?\b)/gi)) {
      priorParts.push(`${chained[1] || ""}${chained[2]}`);
    }
    for (const part of priorParts.flatMap((item) => item.split(/\s+y\s+|\s*,\s*/i))) {
      const cleaned = part
        .replace(/^\s*(?:el|la|los|las)\s+/i, "")
        .replace(/\s+(?:nocturn[oa]|matutin[oa])\s*$/i, "")
        .trim();
      if (cleaned) phrases.push(cleaned);
    }
  }
  return phrases;
}

function medicationFromPriorSubstitutionPhrase(phrase, sourceIds = []) {
  const doseMatch = phrase.match(/\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|ui)\b/i);
  const rawName = phrase
    .slice(0, doseMatch?.index ?? phrase.length)
    .replace(/\s+(?:de|en|por)\s+la\s*$/i, "")
    .trim();
  if (!rawName || rawName.split(/\s+/).length > 4) return null;
  return {
    raw_name: rawName,
    display_name: rawName,
    active_ingredient_known: false,
    role: "psychiatric",
    dose: doseMatch ? `${doseMatch[1]} ${doseMatch[2]}` : "",
    schedule: /\bnocturn[oa]\b/i.test(phrase) ? "por la noche" : "",
    route: "",
    prn: false,
    adherence_status: "unknown",
    adherence_text: "",
    status: "active",
    source_ids: [...new Set(sourceIds)],
  };
}

function recoverHabitualMedicationFromExplicitSubstitutions(assessment, transcript, warnings) {
  const habitual = Array.isArray(assessment.medications?.habitual)
    ? assessment.medications.habitual
    : [];
  const plan = assessment.sections?.plan_terapeutico;
  const sourceIds = Array.isArray(plan?.source_ids) ? plan.source_ids : [];
  const phrases = [
    ...substitutionPriorMedicationPhrases(transcript),
    ...substitutionPriorMedicationPhrases(plan?.text),
  ];

  for (const phrase of phrases) {
    const recovered = medicationFromPriorSubstitutionPhrase(phrase, sourceIds);
    if (!recovered) continue;
    const wanted = normalize(recovered.raw_name);
    const existing = habitual.find((med) => medicationCandidateNames(med).includes(wanted));
    if (existing) {
      if (!clean(existing.dose) && recovered.dose) existing.dose = recovered.dose;
      if (!clean(existing.schedule) && recovered.schedule) existing.schedule = recovered.schedule;
      continue;
    }
    habitual.push(recovered);
    warnings.push(`medication_habitual_recovered_from_explicit_substitution:${recovered.raw_name}`);
  }
  assessment.medications.habitual = habitual;
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
    if (isPatientSpeaker(line.speaker)) return !isFamilySelfMedicationLine(lines, line);
    if (line.speaker === "PSIQUIATRA") {
      const previous = previousSpeakerLine(lines, line);
      return previous?.speaker === "PSIQUIATRA"
        && HABITUAL_MEDICATION_QUESTION_PATTERN.test(normalize(previous.text));
    }
    if (FAMILY_SPEAKER_LABELS.has(line.speaker)) {
      const text = normalize(line.text);
      return !FAMILY_SELF_MEDICATION_PATTERN.test(text)
        && COLLATERAL_PATIENT_MEDICATION_PATTERN.test(text);
    }
    return false;
  });

  const habitualPatientEvidenceLine = (med) => lines.find((line) => {
    const medicationPlanIndex = medicationPlanCutoffIndex(lines, med, planAnchorIndex);
    if (line.index >= medicationPlanIndex || !lineMentionsMedication(line, med)) return false;
    if (isPatientSpeaker(line.speaker)) return !isFamilySelfMedicationLine(lines, line);
    if (line.speaker === "PSIQUIATRA") {
      const previous = previousSpeakerLine(lines, line);
      return previous?.speaker === "PSIQUIATRA"
        && HABITUAL_MEDICATION_QUESTION_PATTERN.test(normalize(previous.text));
    }
    if (!FAMILY_SPEAKER_LABELS.has(line.speaker)) return false;
    const text = normalize(line.text);
    return !FAMILY_SELF_MEDICATION_PATTERN.test(text)
      && COLLATERAL_PATIENT_MEDICATION_PATTERN.test(text);
  });

  const hasClinicianMaintenanceEvidence = (med) => lines.some((line) => {
    if (line.speaker !== "PSIQUIATRA" || !(lineMentionsMedication(line, med) || [med.raw_name, med.display_name].some((name) => normalize(name) && normalize(line.text).includes(normalize(name))))) return false;
    const text = normalize(line.text);
    if (!CLINICIAN_MAINTENANCE_PATTERN.test(text)) return false;

    const medicationIndex = medicationCandidateNames(med)
      .map((name) => text.indexOf(name))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    if (!Number.isInteger(medicationIndex)) return false;

    const before = text.slice(0, medicationIndex);
    const lastIndex = (pattern) => {
      let index = -1;
      for (const match of before.matchAll(pattern)) index = match.index;
      return index;
    };
    const maintenanceIndex = lastIndex(/\b(?:mantener|mantengo|mantenemos|mantenga|continuar|continua|seguimos\s+con|seguir\s+con|sin\s+cambios|misma\s+pauta)\b/gi);
    const newOrModifyIndex = lastIndex(/\b(?:iniciar|inicio|iniciamos|introducir|introduzco|introducimos|anadir|anado|anadimos|empezar|comenzar|subir|subo|subimos|aumentar|aumento|aumentamos|incrementar|incremento|incrementamos|reducir|reduzco|reducimos|disminuir|disminuyo|disminuimos|bajar|bajo|bajamos|ajustar|ajusto|ajustamos|titular|titulo|titulamos)\b/gi);

    // En una frase con varios fármacos ("mantenemos A y añadimos B"), la
    // última orden anterior a cada nombre determina su temporalidad.
    if (maintenanceIndex >= 0) return maintenanceIndex > newOrModifyIndex;
    return newOrModifyIndex < 0;
  });
  const hasGenericMaintenanceEvidence = lines.some((line) =>
    line.speaker === "PSIQUIATRA"
    && /\b(?:(?:mantenga|mantener|mantengo|mantiene|mantienen|mantenemos|mantendremos|continuar|continua|continuaremos|seguimos)\b.{0,90}\b(?:resto(?:\s+del\s+tratamiento)?|mismo\s+tratamiento|misma\s+pauta|tratamiento\s+sin\s+cambios)\b)\b/i.test(normalize(line.text))
  );
  const hasClinicianFutureEvidence = (med) => hasClinicianMaintenanceEvidence(med)
    || (hasGenericMaintenanceEvidence && (assessment.medications?.habitual || []).some((prior) => medicationCandidateNames(prior).some((name) => medicationCandidateNames(med).includes(name))))
    || lines.some((line) => {
      if (line.speaker !== "PSIQUIATRA" || !(lineMentionsMedication(line, med) || [med.raw_name, med.display_name].some((name) => normalize(name) && normalize(line.text).includes(normalize(name))))) return false;
      const planIndex = medicationPlanCutoffIndex(lines, med, planAnchorIndex);
      return line.index >= planIndex
        || CLINICIAN_PRESCRIPTION_PATTERN.test(normalize(line.text))
        || CLINICIAN_TREATMENT_CHANGE_PATTERN.test(normalize(line.text));
    });

  const explicitSubstitutionPriors = [
    ...substitutionPriorMedicationPhrases(transcript),
    ...substitutionPriorMedicationPhrases(assessment.sections?.plan_terapeutico?.text),
  ];
  const hasExplicitSubstitutionPriorEvidence = (med) => {
    const names = medicationCandidateNames(med);
    return explicitSubstitutionPriors.some((phrase) => {
      const normalizedPhrase = normalize(phrase);
      return names.some((name) => normalizedPhrase.includes(name));
    });
  };

  const hasPreexistingEvidence = (med) =>
    hasHabitualPatientEvidence(med)
    || hasClinicianMaintenanceEvidence(med)
    || hasExplicitSubstitutionPriorEvidence(med);

  const hasExplicitTreatmentChange = (med) => lines.some((line) =>
    line.speaker === "PSIQUIATRA"
    && lineMentionsMedication(line, med)
    && CLINICIAN_TREATMENT_CHANGE_PATTERN.test(normalize(line.text))
  );

  const lineExplicitlyDiscontinuesMedication = (line, med) => {
    if (line.speaker !== "PSIQUIATRA" || !lineMentionsMedication(line, med)) return false;
    const text = normalize(line.text);
    const medicationIndex = medicationCandidateNames(med)
      .map((name) => text.indexOf(name))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    if (!Number.isInteger(medicationIndex)) return false;

    const before = text.slice(0, medicationIndex);
    const lastIndex = (pattern) => {
      let index = -1;
      for (const match of before.matchAll(pattern)) index = match.index;
      return index;
    };
    const stopIndex = lastIndex(/\b(?:retirar|retiro|retiramos|suspender|suspendo|suspendemos|suprimir|suprimo|suprimimos|quitar|quito|quitamos|dejar\s+de\s+tomar|no\s+continuar|sustituir|sustituyo|sustituimos)\b/gi);
    if (stopIndex < 0) return false;
    const startOrModifyIndex = lastIndex(/\b(?:iniciar|inicio|iniciamos|introducir|introduzco|introducimos|anadir|anado|anadimos|empezar|comenzar|mantener|mantengo|mantenemos|subir|subo|subimos|aumentar|aumento|aumentamos|incrementar|incremento|incrementamos|reducir|reduzco|reducimos|disminuir|disminuyo|disminuimos|bajar|bajo|bajamos|ajustar|ajusto|ajustamos|titular|titulo|titulamos)\b/gi);
    if (startOrModifyIndex > stopIndex) return false;

    // En "sustituir A por B", solo A se retira; B es la nueva incorporación.
    const replacementIndex = lastIndex(/\bpor\b/gi);
    return replacementIndex < stopIndex;
  };

  const hasExplicitDiscontinuation = (med) => lines.some((line) =>
    CLINICIAN_DISCONTINUATION_PATTERN.test(normalize(line.text))
    && lineExplicitlyDiscontinuesMedication(line, med)
  ) || hasExplicitSubstitutionPriorEvidence(med);

  const priorSnapshot = (med) => {
    const prior = { ...med, status: "active" };
    const evidence = habitualPatientEvidenceLine(med);
    if (!evidence || !hasExplicitTreatmentChange(med)) return prior;

    const text = normalize(normalizeMedicationAsrText(evidence.text).text);
    const candidate = medicationCandidateNames(med).find((name) => text.includes(name));
    const start = candidate ? text.indexOf(candidate) + candidate.length : 0;
    const nearby = text.slice(start, start + 100)
      .split(/\s+y\s+(?=[a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}\s+\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|g|ml|ui)\b)/i)[0];
    const dose = nearby.match(/\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|ui|miligramos?)\b/i);
    if (dose) prior.dose = `${dose[1]} ${/^mili/i.test(dose[2]) ? "mg" : dose[2]}`;

    const schedules = nearby.match(/\b(?:por\s+la\s+manana|por\s+la\s+noche|al\s+mediodia|en\s+la\s+comida|antes\s+de\s+dormir|a\s+demanda|cada\s+\d+\s+horas?|\d+\s+veces?\s+al\s+dia)\b/gi);
    if (schedules?.length) prior.schedule = [...new Set(schedules)].join(" y ");
    return prior;
  };

  const hasCurrentPatientEvidence = (med) => lines.some((line) => {
    const medicationPlanIndex = medicationPlanCutoffIndex(lines, med, planAnchorIndex);
    if (!lineMentionsMedication(line, med)) return false;
    if (isPatientSpeaker(line.speaker) && line.index >= medicationPlanIndex) return true;
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

  const regimenChanged = (currentMed, habitualMed) => {
    const fields = ["dose", "schedule", "route"];
    if (fields.some((field) => {
      const currentValue = normalize(currentMed?.[field]);
      const habitualValue = normalize(habitualMed?.[field]);
      return currentValue && habitualValue && currentValue !== habitualValue;
    })) return true;
    return Boolean(currentMed?.prn) !== Boolean(habitualMed?.prn);
  };

  const retainedHabitual = [];
  for (const med of habitual) {
    const onlyNewPrescription = !hasPreexistingEvidence(med) && hasCurrentPatientEvidence(med);
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

  // "Habitual" es la fotograf\u00eda previa a la consulta; "actual" es la pauta final
  // resultante. Por eso una medicaci\u00f3n mantenida debe aparecer en ambos apartados:
  // se recupera como habitual sin eliminarla de la pauta final.
  for (const med of current) {
    const preexisting = hasPreexistingEvidence(med);
    const existingHabitual = retainedHabitual.find((existing) => overlaps(existing, med));
    if (preexisting && !existingHabitual) {
      retainedHabitual.push(priorSnapshot(med));
      const name = clean(med.display_name) || clean(med.raw_name) || "medicamento";
      warnings.push(`medication_preexisting_recovered_current_to_habitual:${name}`);
    } else if (preexisting && existingHabitual) {
      const prior = priorSnapshot(med);
      if (!clean(existingHabitual.dose) && clean(prior.dose)) existingHabitual.dose = prior.dose;
      if (!clean(existingHabitual.schedule) && clean(prior.schedule)) existingHabitual.schedule = prior.schedule;
    }
  }

  assessment.medications.habitual = retainedHabitual;
  const withoutDiscontinued = current.filter((med) => {
    if (!hasExplicitDiscontinuation(med)) return true;
    const name = clean(med.display_name) || clean(med.raw_name) || "medicamento";
    warnings.push(`medication_explicitly_discontinued_removed_from_current:${name}`);
    return false;
  });

  // Recupera altas/modificaciones nombradas explícitamente por el psiquiatra
  // cuando el extractor estructurado no haya creado la entidad.
  const psychiatristSourceId = (assessment.sources || []).find((source) => source.kind === "psychiatrist")?.id;
  for (const line of lines) {
    if (line.speaker !== "PSIQUIATRA") continue;
    const text = normalize(normalizeMedicationAsrText(line.text).text);
    const planIndex = medicationPlanCutoffIndex(lines, { raw_name: "", display_name: "" }, planAnchorIndex);
    if (line.index < planIndex
      && !CLINICIAN_PRESCRIPTION_PATTERN.test(text)
      && !CLINICIAN_TREATMENT_CHANGE_PATTERN.test(text)) continue;
    const mentions = PSYCHIATRIC_MEDICATION_VOCABULARY
      .map((canonical) => ({ canonical, index: text.indexOf(normalize(canonical)) }))
      .filter((item) => item.index >= 0)
      .sort((left, right) => left.index - right.index);
    for (let index = 0; index < mentions.length; index += 1) {
      const { canonical, index: medicationIndex } = mentions[index];
      const rawName = canonical.charAt(0).toLocaleUpperCase("es") + canonical.slice(1);
      if (withoutDiscontinued.some((existing) => overlaps(existing, { raw_name: rawName, display_name: rawName }))) continue;
      const candidate = { raw_name: rawName, display_name: rawName, status: "active" };
      if (!hasClinicianFutureEvidence(candidate) || hasExplicitDiscontinuation(candidate)) continue;
      const endIndex = mentions[index + 1]?.index ?? medicationIndex + 100;
      const nearby = text.slice(medicationIndex + normalize(canonical).length, endIndex);
      const dose = nearby.match(/\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|µg|g|ml|ui|miligramos?)\b/i);
      const schedule = nearby.match(/\b(?:por\s+la\s+manana|por\s+la\s+noche|al\s+mediodia|en\s+la\s+comida|antes\s+de\s+dormir|a\s+demanda|cada\s+\d+\s+horas?|\d+\s+veces?\s+al\s+dia|de\s+rescate|si\s+precisa)\b/gi);
      withoutDiscontinued.push({
        ...candidate,
        active_ingredient_known: true,
        role: "psychiatric",
        dose: dose ? `${dose[1]} ${/^mili/i.test(dose[2]) ? "mg" : dose[2]}` : "",
        schedule: schedule?.length ? [...new Set(schedule)].join(" y ") : "",
        route: "",
        prn: /\b(?:a\s+demanda|de\s+rescate|si\s+precisa)\b/i.test(nearby),
        adherence_status: "unknown",
        adherence_text: "",
        source_ids: psychiatristSourceId ? [psychiatristSourceId] : [],
      });
      warnings.push(`medication_future_prescription_recovered_from_clinician:${rawName}`);
    }
  }

  const hasPharmacologicalUpdate = withoutDiscontinued.some((currentMed) => {
    const previous = retainedHabitual.find((habitualMed) => overlaps(currentMed, habitualMed));
    return !previous || regimenChanged(currentMed, previous) || hasExplicitTreatmentChange(currentMed)
      || hasClinicianMaintenanceEvidence(currentMed) || hasGenericMaintenanceEvidence;
  }) || retainedHabitual.some((habitualMed) => hasExplicitDiscontinuation(habitualMed))
    || (hasGenericMaintenanceEvidence && retainedHabitual.some((habitualMed) => !hasExplicitDiscontinuation(habitualMed)));

  // Solo se incluyen en TRATAMIENTO REVISADO pautas futuras indicadas por el psiquiatra.
  // La medicación habitual no se copia automáticamente cuando hay cualquier cambio.
  if (hasPharmacologicalUpdate) {
    for (const habitualMed of retainedHabitual) {
      if (hasExplicitDiscontinuation(habitualMed) || !hasClinicianFutureEvidence(habitualMed)) continue;
      if (withoutDiscontinued.some((item) => overlaps(item, habitualMed))) continue;
      withoutDiscontinued.push({ ...habitualMed, status: "active" });
      const name = clean(habitualMed.display_name) || clean(habitualMed.raw_name) || "medicamento";
      warnings.push(`medication_explicitly_maintained_added_to_revised:${name}`);
    }
  }

  assessment.medications.current = withoutDiscontinued.filter((currentMed) => {
    if (!hasPharmacologicalUpdate) return false;
    if (!hasClinicianFutureEvidence(currentMed)) {
      const name = clean(currentMed.display_name) || clean(currentMed.raw_name) || "medicamento";
      warnings.push(`medication_without_clinician_future_plan_removed_from_revised:${name}`);
      return false;
    }
    return true;
  });

  // Una pauta iniciada en esta consulta todavía no tiene adherencia observable.
  // Si el único respaldo del fármaco es una prescripción del psiquiatra posterior
  // al anclaje del nuevo plan, se elimina cualquier adherencia arrastrada por el modelo.
  for (const med of assessment.medications.current || []) {
    const newlyPrescribed = !hasPreexistingEvidence(med) && hasCurrentPatientEvidence(med);
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

  if (isPatientSpeaker(line.speaker)) {
    const previous = previousSpeakerLine(lines, line);
    return evidenceTexts.some((text) => {
      if (NO_CURRENT_MEDICATION_PATTERN.test(text)) return false;
      if (ACTIVE_MEDICATION_PATTERN.test(text) && !HISTORICAL_MEDICATION_PATTERN.test(text)) return true;
      return previous?.speaker === "PSIQUIATRA"
        && HABITUAL_MEDICATION_QUESTION_PATTERN.test(normalize(previous.text))
        && !HISTORICAL_MEDICATION_PATTERN.test(text);
    });
  }

  if (line.speaker === "PSIQUIATRA") {
    const previous = previousSpeakerLine(lines, line);
    return previous?.speaker === "PSIQUIATRA"
      && HABITUAL_MEDICATION_QUESTION_PATTERN.test(normalize(previous.text))
      && evidenceTexts.every((text) => !HISTORICAL_MEDICATION_PATTERN.test(text));
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
    const supportedByPreconsultation = lines.some((line) =>
      lineSupportsPreexistingMedication(lines, line, med, medicationPlanIndex)
    );
    const wantedNames = medicationCandidateNames(med);
    const supportedByExplicitSubstitution = [
      ...substitutionPriorMedicationPhrases(transcript),
      ...substitutionPriorMedicationPhrases(assessment.sections?.plan_terapeutico?.text),
    ].some((phrase) => {
      const normalizedPhrase = normalize(phrase);
      return wantedNames.some((name) => normalizedPhrase.includes(name));
    });
    const supported = supportedByPreconsultation || supportedByExplicitSubstitution;
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

  const normalizedSchedule = normalize(schedule);
  const technicalSchedule = (() => {
    if (!schedule || med.prn || /\b(?:cada\s+\d+\s+horas?|semanal|mensual)\b/i.test(normalizedSchedule)) return "";
    if (/^\s*\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*$/.test(schedule)) return schedule.replace(/\s*-\s*/g, " - ");
    const slot = (pattern) => {
      const explicit = normalizedSchedule.match(new RegExp(`(?:^|[,;]|\\by\\b)\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:comprimidos?|pastillas?|capsulas?|tomas?)?[^,;]{0,35}${pattern}`, "i"));
      if (explicit) return explicit[1];
      return new RegExp(pattern, "i").test(normalizedSchedule) ? "1" : "0";
    };
    const morning = slot("(?:por\\s+la\\s+manana|\\bmanana\\b|desayuno|matutin[oa])");
    const midday = slot("(?:al\\s+mediodia|\\bmediodia\\b|\\bcomida\\b)");
    const night = slot("(?:por\\s+la\\s+noche|\\bnoche\\b|antes\\s+de\\s+dormir|para\\s+dormir|\\bcena\\b|nocturn[oa])");
    if ([morning, midday, night].every((value) => value === "0")) return "";
    return `${morning} - ${midday} - ${night}`;
  })();

  let line = name;
  if (dose) line += ` ${dose}`;
  if (technicalSchedule) line += `: ${technicalSchedule}`;
  else if (schedule) line += `: ${schedule}`;
  else if (med.prn) line += ": a demanda";
  if (route && !/oral/i.test(route)) line += ` (${route})`;
  if (adherence && med.adherence_status !== "not_applicable") line += `. Adherencia: ${adherence}`;
  return line.replace(/\.\./g, ".").trim();
}

function canonicalizeVerifiedMedicationNamesInSections(assessment, warnings) {
  const replacements = [];
  for (const group of [assessment.medications?.habitual, assessment.medications?.current]) {
    for (const med of group || []) {
      const rawName = clean(med?.raw_name);
      const displayName = clean(med?.display_name);
      if (!rawName || !displayName || normalize(rawName) === normalize(displayName)) continue;
      if (med?.medication_verification?.status !== "confirmed") continue;
      const aliases = [
        rawName,
        med?.medication_verification?.queriedName,
        med?.medication_verification?.rawName,
      ].map(clean).filter(Boolean);
      replacements.push({ aliases: [...new Set(aliases)], rawName, displayName });
    }
  }

  replacements.sort((left, right) => right.rawName.length - left.rawName.length);
  for (const section of Object.values(assessment.sections || {})) {
    if (!section?.text) continue;
    for (const { aliases, rawName, displayName } of replacements) {
      for (const alias of aliases) {
        if (normalize(alias) === normalize(displayName)) continue;
        const escaped = alias
          .split(/\s+/)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("\\s+");
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
        const updated = section.text.replace(pattern, displayName);
        if (updated !== section.text) {
          section.text = updated;
          warnings.push(`medication_verified_name_propagated_to_sections:${alias}->${displayName}`);
        }
      }
    }
  }
}

export function finalizeVerifiedMedicationNames(inputAssessment) {
  const assessment = structuredClone(inputAssessment);
  const warnings = [];
  canonicalizeVerifiedMedicationNamesInSections(assessment, warnings);
  syncMedicationSection(assessment, "habitual", "tratamiento_habitual", ["active"]);
  syncMedicationSection(assessment, "current", "tratamiento_actual", ["active", "administered_once"]);
  return { assessment, warnings };
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

function sourceIdsForSpeaker(assessment, speaker) {
  const kindsBySpeaker = {
    PACIENTE: ["patient"],
    MADRE: ["mother"],
    PADRE: ["father"],
    FAMILIAR: ["family"],
    CUIDADOR: ["caregiver"],
    CUIDADORA: ["caregiver"],
    "CUIDADOR/A": ["caregiver"],
    HERMANO: ["family"],
    HERMANA: ["family"],
    "HERMANO/A": ["family"],
  };
  const allowed = new Set(kindsBySpeaker[speaker] || []);
  return (assessment.sources || [])
    .filter((source) => allowed.has(source.kind))
    .map((source) => source.id);
}

function restoreExplicitNoHabitualMedication(assessment, transcript, warnings) {
  const lines = speakerLines(transcript);
  if (!lines.length) return;

  const planAnchor = lines.find((line) =>
    line.speaker === "PSIQUIATRA" && CURRENT_PLAN_ANCHOR_PATTERN.test(normalize(line.text))
  );
  const planAnchorIndex = planAnchor?.index ?? Number.POSITIVE_INFINITY;
  const denial = lines.find((line) => {
    if (line.index >= planAnchorIndex) return false;
    const text = normalize(line.text);
    if (!NO_CURRENT_MEDICATION_PATTERN.test(text)) return false;

    const previous = previousSpeakerLine(lines, line);
    const hasMedicationContext = MEDICATION_NOUN_PATTERN.test(text)
      || (previous?.speaker === "PSIQUIATRA"
        && HABITUAL_MEDICATION_QUESTION_PATTERN.test(normalize(previous.text)));
    if (!hasMedicationContext || isFamilySelfMedicationLine(lines, line)) return false;

    if (isPatientSpeaker(line.speaker)) return true;
    return FAMILY_SPEAKER_LABELS.has(line.speaker)
      && COLLATERAL_PATIENT_MEDICATION_PATTERN.test(text);
  });

  if (!denial) return;
  const hasActiveHabitual = (assessment.medications?.habitual || [])
    .some((med) => med?.status === "active");
  if (hasActiveHabitual) return;

  const section = assessment.sections?.tratamiento_habitual;
  if (!section) return;
  section.text = "No toma medicación habitual.";
  section.evidence_status = "supported";
  section.source_ids = sourceIdsForSpeaker(assessment, denial.speaker);

  if (Array.isArray(assessment.missing_or_not_explored)) {
    assessment.missing_or_not_explored = assessment.missing_or_not_explored.filter((item) => {
      const topic = normalize(item?.topic);
      return !/\b(?:tratamiento|medicacion)\s+habitual\b/.test(topic);
    });
  }
  warnings.push("medication_habitual_explicit_none_restored");
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

  recoverExplicitPatientHabitualMedications(assessment, transcript, warnings);
  recoverHabitualMedicationFromExplicitSubstitutions(assessment, transcript, warnings);
  recoverExplicitToxicHabits(assessment, transcript, warnings);
  recoverExplicitClinicianDiagnosis(assessment, transcript, warnings);
  recoverMedicationReviewEncounterContext(assessment, transcript, warnings);
  // La fotografía previa debe estar completa antes de conciliar la pauta
  // actual; así los fármacos mantenidos sin cambios no se arrastran a ACTUAL.
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

  // CIMA verifica las entidades farmacológicas estructuradas antes de este paso.
  // Propagamos el nombre canónico a todos los apartados para que el plan y la
  // narrativa no conserven una variante fonética que ya fue corregida.
  canonicalizeVerifiedMedicationNamesInSections(assessment, warnings);

  syncMedicationSection(assessment, "habitual", "tratamiento_habitual", ["active"]);
  syncMedicationSection(assessment, "current", "tratamiento_actual", ["active", "administered_once"]);
  restoreExplicitNoHabitualMedication(assessment, transcript, warnings);

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
      medication_habitual_explicit_none_guard: true,
    },
  };
}
