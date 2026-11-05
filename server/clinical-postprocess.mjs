import {
  normalizeKnownMedicationAliasText,
  PSYCHIATRIC_MEDICATION_VOCABULARY,
} from "./medication-name-aliases.mjs";

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
const CURRENT_PLAN_ANCHOR_PATTERN = /\b(?:a\s+partir\s+de\s+(?:este\s+momento|ahora|hoy)|desde\s+ahora|tratamiento\s+que\s+tiene\s+que\s+hacer|le\s+voy\s+a\s+explicar\s+como\s+es\s+el\s+tratamiento|(?:voy|vamos)\s+a\s+(?:iniciar|poner|pautar|prescribir|indicar|dejar|cambiar|sustituir|retirar|suspender|aumentar|subir|reducir|bajar|mantener|continuar|modificar|ajustar)|(?:inicio|iniciamos|pauto|pautamos|prescribo|prescribimos|indico|indicamos|cambio|cambiamos|sustituyo|sustituimos|retiro|retiramos|suspendo|suspendemos|aumento|aumentamos|subo|subimos|reduzco|reducimos|bajo|bajamos|mantengo|mantenemos|continuo|continuamos|modifico|modificamos|ajusto|ajustamos)\b)\b/i;
const CLINICIAN_PRESCRIPTION_PATTERN = /\b(?:debe(?:s)?\s+(?:de\s+)?tomar|debera\s+tomar|tomara|tome|se\s+toma|se\s+(?:indica|pauta|prescribe|inicia)|(?:voy|vamos)\s+a\s+(?:iniciar|poner|pautar|prescribir|indicar|dejar)|(?:inicio|iniciamos|pauto|pautamos|prescribo|prescribimos|indico|indicamos)|de\s+rescate|a\s+demanda|antes\s+de\s+dormir)\b/i;
const CLINICIAN_MAINTENANCE_PATTERN = /\b(?:mantener|mantengo|mantenemos|mantenga|continuar|continua|contin\u00fao|seguimos\s+con|seguir\s+con|sin\s+cambios|misma\s+pauta|resto\s+del\s+tratamiento)\b/i;
const CLINICIAN_TREATMENT_CHANGE_PATTERN = /\b(?:iniciar|inicio|iniciamos|introducir|introduzco|introducimos|anadir|anado|anadimos|empezar|comenzar|sustituir|cambiar|cambio|cambiamos|aumentar|aumento|aumentamos|incrementar|incremento|incrementamos|subir|subo|subimos|reducir|reduzco|reducimos|disminuir|disminuyo|disminuimos|bajar|bajo|bajamos|ajustar|ajusto|ajustamos|titular|titulo|titulamos)\b/i;
const CLINICIAN_DISCONTINUATION_PATTERN = /\b(?:retirar|retiro|retiramos|suspender|suspendo|suspendemos|suprimir|suprimo|suprimimos|quitar|quito|quitamos|dejar\s+de\s+tomar|no\s+continuar|sustituir|sustituyo|sustituimos)\b/i;
const FAMILY_ADDRESS_PATTERN = /\b(?:señora|senora|madre|padre|familiar|cuidador(?:a)?)\b/i;
const FORMAL_ADDRESS_PATTERN = /\busted\b/i;
const MEDICATION_QUESTION_PATTERN = /\b(?:medicacion|medicación|tratamiento|pastillas?|toma(?:r|s)?|tomando)\b/i;
const HABITUAL_MEDICATION_QUESTION_PATTERN = /\b(?:(?:que|qué|cual|cuál)\s+(?:(?:es|era)\s+)?(?:el\s+|su\s+|tu\s+)?(?:tratamiento|medicacion|medicación|pauta|farmacos|fármacos|pastillas?)\s*(?:(?:que\s+)?(?:tomas?|toma|esta\s+tomando|está\s+tomando))?|(?:que|qué|cual|cuál)\s+(?:tomas?|toma|esta\s+tomando|está\s+tomando)(?:\s+ahora\s+mismo)?|(?:tomas?|toma)\s+(?:alguna\s+)?medicacion|tratamiento\s+habitual|tratamiento\s+vigente|medicacion\s+actual|medicación\s+actual)\b/i;
const NO_CURRENT_MEDICATION_PATTERN = /\b(?:no\s+(?:tomo|toma|estoy\s+tomando|esta\s+tomando|está\s+tomando)|ningun[ao]?\s+(?:medicacion|medicación|tratamiento)|sin\s+(?:medicacion|medicación|tratamiento))\b/i;
const MEDICATION_NOUN_PATTERN = /\b(?:medicacion|medicación|tratamiento|pastillas?)\b/i;
const HABITUAL_CONFIRMATION_PATTERN = /\b(?:toma|tomando|tratamiento|medicacion|medicación|pauta)\b/i;
const AFFIRMATIVE_RESPONSE_PATTERN = /^\s*(?:s[ií]|correcto|exacto|eso\s+es|as[ií]\s+es|de\s+acuerdo|vale)(?:\b|[.,;:])/i;
const EXPLICIT_MEDICATION_REGIMEN_PATTERN = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|g|ml|ui)\s*:?\s*\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?\b/i;
const COMPLETE_PRIOR_REGIMEN_REPLACEMENT_PATTERN = /\b(?:(?:sustituir|sustituimos|sustituyo|cambiar|cambiamos|cambio)\s+(?:(?:por\s+completo|completamente)\s+)?(?:la\s+|el\s+|su\s+|toda\s+la\s+|todo\s+el\s+)?(?:pauta|tratamiento|medicacion)(?:\s+(?:previo|previa|anterior|vigente|actual|que\s+(?:toma|esta\s+tomando|llevaba)))?(?=\s+(?:por|y|para|porque)\b|[,.]|$)|(?:retirar|retiramos|retiro|suspender|suspendemos|suspendo)\s+(?:por\s+completo\s+|completamente\s+|toda\s+la\s+|todo\s+el\s+)(?:pauta|tratamiento|medicacion)(?:\s+(?:previo|previa|anterior|vigente|actual))?)\b/i;

function speakerLines(transcript) {
  return String(transcript || "")
    .split(/\n+/)
    .map((line, index) => {
      // Las transcripciones editadas pueden usar «Paciente:»/«Psiquiatra:»;
      // el estado temporal no debe perderse por la capitalización del hablante.
      const match = line.match(/^\s*([A-ZÁÉÍÓÚÜÑ_/ ]+)\s*:\s*(.*)$/iu);
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

function nextNonPsychiatristLine(lines, line) {
  const position = lines.indexOf(line);
  for (let index = position + 1; index < lines.length && index - position <= 3; index += 1) {
    if (lines[index]?.speaker !== "PSIQUIATRA") return lines[index];
  }
  return null;
}

function clinicianConfirmedPreexistingMedication(lines, line, med) {
  if (line?.speaker !== "PSIQUIATRA" || !lineMentionsMedication(line, med)) return false;
  const text = normalize(line.text);
  if (CLINICIAN_PRESCRIPTION_PATTERN.test(text) || CLINICIAN_DISCONTINUATION_PATTERN.test(text)) return false;
  const asksForConfirmation = /[?¿]/.test(line.text)
    || /\b(?:me\s+confirma|confirma|verdad|correcto|es\s+asi|es\s+así)\b/i.test(text);
  if (!asksForConfirmation || !HABITUAL_CONFIRMATION_PATTERN.test(text)) return false;
  const answer = nextNonPsychiatristLine(lines, line);
  return Boolean(answer && AFFIRMATIVE_RESPONSE_PATTERN.test(normalize(answer.text)));
}

function isExplicitHabitualMedicationAnswer(lines, line) {
  const text = normalize(line?.text);
  const previous = previousSpeakerLine(lines, line);

  if (line?.speaker === "PACIENTE") {
    if (NO_CURRENT_MEDICATION_PATTERN.test(text) || isFamilySelfMedicationLine(lines, line)) return false;
    return previous?.speaker === "PSIQUIATRA"
      && HABITUAL_MEDICATION_QUESTION_PATTERN.test(normalize(previous.text));
  }

  if (FAMILY_SPEAKER_LABELS.has(line?.speaker)) {
    if (NO_CURRENT_MEDICATION_PATTERN.test(text) || isFamilySelfMedicationLine(lines, line)) return false;
    return COLLATERAL_PATIENT_MEDICATION_PATTERN.test(text)
      && previous?.speaker === "PSIQUIATRA"
      && HABITUAL_MEDICATION_QUESTION_PATTERN.test(normalize(previous.text));
  }

  if (line?.speaker !== "PSIQUIATRA") return false;
  if (!HABITUAL_MEDICATION_QUESTION_PATTERN.test(text)) return false;
  return Boolean(nextNonPsychiatristLine(lines, line)?.text.match(AFFIRMATIVE_RESPONSE_PATTERN));
}

function titleCaseMedication(value) {
  const text = clean(value).toLowerCase();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

function normalizedMedicationText(value) {
  return normalize(normalizeKnownMedicationAliasText(value).text);
}

function medicationNamesInText(value) {
  const text = normalizedMedicationText(value);
  return PSYCHIATRIC_MEDICATION_VOCABULARY
    .filter((name) => new RegExp(`(?:^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`, "i").test(text))
    .sort((left, right) => text.indexOf(left) - text.indexOf(right));
}

function medicationTextSegment(value, medicationName) {
  const text = normalizedMedicationText(value);
  const start = text.indexOf(normalize(medicationName));
  if (start < 0) return "";
  const contentStart = start + normalize(medicationName).length;
  const nextMedication = medicationNamesInText(text)
    .map((name) => text.indexOf(name, contentStart))
    .filter((index) => index >= contentStart)
    .sort((left, right) => left - right)[0];
  return text.slice(contentStart, nextMedication ?? text.length);
}

function doseAndScheduleFromMention(value, medicationName) {
  const segment = medicationTextSegment(value, medicationName);
  const dose = segment.match(/\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|ui)\b/i);
  const prn = /\b(?:a\s+demanda|de\s+rescate|si\s+precisa|cuando\s+lo\s+necesite)\b/i.test(segment);
  const scheduleSource = segment
    .replace(dose?.[0] || "", " ")
    .replace(/^[\s:;,.-]+/, "")
    .replace(/[\s.,;:]+$/, "")
    .trim();
  return {
    dose: dose ? `${dose[1]} ${dose[2]}` : "",
    schedule: normalizeMedicationSchedule(scheduleSource, prn),
    prn,
  };
}

function explicitDoseChangeFromMention(value, medicationName) {
  const segment = medicationTextSegment(value, medicationName);
  let match = segment.match(/\b(?:de|desde)\s+(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|ui)?\s+(?:a|hasta)\s+(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|ui)?\b/i);
  if (!match) {
    match = segment.match(/\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|ui)\s+(?:a|hasta)\s+(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|ui)?\b/i);
  }
  if (!match) return null;
  const oldUnit = match[2] || match[4];
  const newUnit = match[4] || match[2];
  if (!oldUnit || !newUnit) return null;
  const afterChange = segment.slice((match.index ?? 0) + match[0].length);
  const prn = /\b(?:a\s+demanda|de\s+rescate|si\s+precisa|cuando\s+lo\s+necesite)\b/i.test(afterChange);
  return {
    previousDose: `${match[1]} ${oldUnit}`,
    revisedDose: `${match[3]} ${newUnit}`,
    schedule: normalizeMedicationSchedule(afterChange, prn),
    prn,
  };
}

function medicationEntity(name, details, sourceIds = []) {
  return {
    raw_name: titleCaseMedication(name),
    display_name: titleCaseMedication(name),
    active_ingredient_known: false,
    role: "psychiatric",
    dose: details.dose || "",
    schedule: details.schedule || "",
    route: "",
    prn: details.prn === true,
    adherence_status: "unknown",
    adherence_text: "",
    status: "active",
    source_ids: [...new Set(sourceIds)],
  };
}

function sameMedication(left, right) {
  const names = new Set(medicationCandidateNames(left));
  return medicationCandidateNames(right).some((name) => names.has(name));
}

function recoverHabitualMedicationFromPreconsultTranscript(assessment, transcript, warnings) {
  const lines = speakerLines(transcript);
  if (!lines.length) return;
  const planAnchor = lines.find((line) => line.speaker === "PSIQUIATRA" && CURRENT_PLAN_ANCHOR_PATTERN.test(normalize(line.text)));
  const planAnchorIndex = planAnchor?.index ?? Number.POSITIVE_INFINITY;
  const habitual = Array.isArray(assessment.medications?.habitual) ? assessment.medications.habitual : [];
  const current = Array.isArray(assessment.medications?.current) ? assessment.medications.current : [];

  for (const line of lines) {
    const previous = previousSpeakerLine(lines, line);
    const explicitHabitualAnswer = isExplicitHabitualMedicationAnswer(lines, line);
    if (line.index >= planAnchorIndex && !explicitHabitualAnswer) continue;
    const explicitPreconsultRegimen = line.speaker === "PACIENTE"
      && line.index < planAnchorIndex
      && medicationNamesInText(line.text).length > 0
      && EXPLICIT_MEDICATION_REGIMEN_PATTERN.test(normalize(line.text))
      && !HISTORICAL_MEDICATION_PATTERN.test(normalize(line.text));
    const patientMedicationAnswer = line.speaker === "PACIENTE"
      && !isFamilySelfMedicationLine(lines, line)
      && (
        explicitHabitualAnswer
        || explicitPreconsultRegimen
        || /\b(?:tomo|tomando|tratamiento|medicacion|medicación|pauta|pastillas?)\b/i.test(normalize(line.text))
        || (previous?.speaker === "PSIQUIATRA" && HABITUAL_MEDICATION_QUESTION_PATTERN.test(normalize(previous.text)))
      );
    const collateralMedicationAnswer = FAMILY_SPEAKER_LABELS.has(line.speaker)
      && COLLATERAL_PATIENT_MEDICATION_PATTERN.test(normalize(line.text));
    const confirmedClinicianList = line.speaker === "PSIQUIATRA"
      && HABITUAL_MEDICATION_QUESTION_PATTERN.test(normalize(line.text))
      && Boolean(nextNonPsychiatristLine(lines, line)?.text.match(AFFIRMATIVE_RESPONSE_PATTERN));
    if (!patientMedicationAnswer && !collateralMedicationAnswer && !confirmedClinicianList) continue;

    for (const name of medicationNamesInText(line.text)) {
      const details = doseAndScheduleFromMention(line.text, name);
      const recovered = medicationEntity(name, details, sourceIdsForSpeaker(assessment, line.speaker));
      if (habitual.some((med) => sameMedication(med, recovered))) continue;
      // Si el modelo ya estructuró el fármaco, la reconciliación posterior crea
      // la instantánea previa conservando el orden clínico original. Esta ruta
      // solo rescata entidades que el modelo omitió por completo.
      if (current.some((med) => sameMedication(med, recovered))) continue;
      habitual.push(recovered);
      warnings.push(`medication_habitual_recovered_from_preconsult_transcript:${recovered.raw_name}`);
    }
  }
  assessment.medications.habitual = habitual;
}

function recoverMedicationDoseChanges(assessment, transcript, warnings) {
  const lines = speakerLines(transcript);
  if (!lines.length) return;
  const habitual = Array.isArray(assessment.medications?.habitual) ? assessment.medications.habitual : [];
  const current = Array.isArray(assessment.medications?.current) ? assessment.medications.current : [];

  for (const line of lines) {
    if (line.speaker !== "PSIQUIATRA" || !CLINICIAN_TREATMENT_CHANGE_PATTERN.test(normalize(line.text))) continue;
    for (const name of medicationNamesInText(line.text)) {
      const change = explicitDoseChangeFromMention(line.text, name);
      if (!change) continue;
      const template = medicationEntity(name, {
        dose: change.revisedDose,
        schedule: change.schedule,
        prn: change.prn,
      }, sourceIdsForSpeaker(assessment, line.speaker));
      let revised = current.find((med) => sameMedication(med, template));
      if (!revised) {
        revised = template;
        current.push(revised);
      }
      revised.dose = change.revisedDose;
      if (change.schedule) revised.schedule = change.schedule;
      revised.prn = change.prn;
      revised.status = "active";

      let previous = habitual.find((med) => sameMedication(med, template));
      if (!previous) {
        previous = { ...template };
        habitual.push(previous);
      }
      previous.dose = change.previousDose;
      if (change.schedule) previous.schedule = change.schedule;
      previous.prn = change.prn;
      previous.status = "active";
      warnings.push(`medication_dose_change_timeline_recovered:${template.raw_name}:${change.previousDose}->${change.revisedDose}`);
    }
  }

  assessment.medications.habitual = habitual;
  assessment.medications.current = current;
}

function medicationPlanCutoffIndex(lines, med, planAnchorIndex) {
  const firstExplicitPrescription = lines.find((line) =>
    line.speaker === "PSIQUIATRA"
    && lineMentionsMedication(line, med)
    && CLINICIAN_PRESCRIPTION_PATTERN.test(normalize(line.text))
  );
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
  if (/^(?:(?:la|el|su|toda\s+la|todo\s+el)\s+)?(?:pauta|tratamiento|medicacion)\s+(?:previ[oa]|anterior|vigente|actual)$/i.test(normalize(rawName))) {
    return null;
  }
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

function prunePlaceholderMedicationEntities(assessment, warnings) {
  const placeholder = /^(?:no\s+consta|no\s+explorado|no\s+explorada|ninguno|ninguna|sin\s+tratamiento|sin\s+medicaci[oó]n|no\s+toma\s+medicaci[oó]n)$/i;
  const unreadableName = /^\[(?:ubicaci[oó]n|inaudible|ininteligible|medicamento\s+no\s+identificado)\](?:\s+.*)?$/i;
  for (const group of ["habitual", "current"]) {
    const list = assessment.medications?.[group];
    if (!Array.isArray(list)) continue;
    assessment.medications[group] = list.filter((med) => {
      const name = clean(med?.display_name) || clean(med?.raw_name);
      const genericPlaceholder = placeholder.test(name);
      const unreadable = unreadableName.test(name);
      if (!genericPlaceholder && !unreadable) return true;
      warnings.push(`${unreadable ? "unreadable" : "placeholder"}_medication_entity_pruned:${group}`);
      if (unreadable) {
        const evidence = "Se menciona un medicamento con nombre ininteligible; se excluye de la pauta confirmada y requiere revisión clínica.";
        assessment.safety_review ||= [];
        const topic = `medication_safety:unidentified_name:${group}`;
        if (!assessment.safety_review.some((item) => item?.topic === topic && item?.evidence === evidence)) {
          assessment.safety_review.push({
            topic,
            evidence,
            source_ids: Array.isArray(med?.source_ids) ? [...med.source_ids] : [],
            needs_clinician_review: true,
          });
        }
      }
      return false;
    });
    const sectionKey = group === "habitual" ? "tratamiento_habitual" : "tratamiento_actual";
    const section = assessment.sections?.[sectionKey];
    if (section?.text && unreadableName.test(section.text.trim())) {
      section.text = "";
      section.evidence_status = "not_provided";
      section.source_ids = [];
    }
  }
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
    if (!lineMentionsMedication(line, med)) return false;
    if (line.index >= medicationPlanIndex && !isExplicitHabitualMedicationAnswer(lines, line)) return false;
    if (clinicianConfirmedPreexistingMedication(lines, line, med)) return true;
    if (line.speaker === "PACIENTE") return !isFamilySelfMedicationLine(lines, line);
    if (FAMILY_SPEAKER_LABELS.has(line.speaker)) {
      const text = normalize(line.text);
      return !FAMILY_SELF_MEDICATION_PATTERN.test(text)
        && COLLATERAL_PATIENT_MEDICATION_PATTERN.test(text);
    }
    return false;
  });

  const habitualPatientEvidenceLine = (med) => lines.find((line) => {
    const medicationPlanIndex = medicationPlanCutoffIndex(lines, med, planAnchorIndex);
    if (!lineMentionsMedication(line, med)) return false;
    if (line.index >= medicationPlanIndex && !isExplicitHabitualMedicationAnswer(lines, line)) return false;
    if (clinicianConfirmedPreexistingMedication(lines, line, med)) return true;
    if (line.speaker === "PACIENTE") return !isFamilySelfMedicationLine(lines, line);
    if (!FAMILY_SPEAKER_LABELS.has(line.speaker)) return false;
    const text = normalize(line.text);
    return !FAMILY_SELF_MEDICATION_PATTERN.test(text)
      && COLLATERAL_PATIENT_MEDICATION_PATTERN.test(text);
  });

  const hasClinicianMaintenanceEvidence = (med) => lines.some((line) =>
    line.speaker === "PSIQUIATRA"
    && lineMentionsMedication(line, med)
    && CLINICIAN_MAINTENANCE_PATTERN.test(normalize(line.text))
  );

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

  const hasExplicitDoseChangePriorEvidence = (med) => lines.some((line) => {
    if (line.speaker !== "PSIQUIATRA" || !CLINICIAN_TREATMENT_CHANGE_PATTERN.test(normalize(line.text))) return false;
    if (!lineMentionsMedication(line, med)) return false;
    return medicationCandidateNames(med).some((name) => explicitDoseChangeFromMention(line.text, name));
  });

  const hasPreexistingEvidence = (med) =>
    hasHabitualPatientEvidence(med)
    || hasClinicianMaintenanceEvidence(med)
    || hasExplicitSubstitutionPriorEvidence(med)
    || hasExplicitDoseChangePriorEvidence(med);

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

    const text = normalize(evidence.text);
    const candidate = medicationCandidateNames(med).find((name) => text.includes(name));
    const start = candidate ? text.indexOf(candidate) + candidate.length : 0;
    const nearby = text.slice(start, start + 100)
      .split(/\s+y\s+(?=[a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}\s+\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|g|ml|ui)\b)/i)[0];
    const dose = nearby.match(/\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|ml|ui)\b/i);
    if (dose) prior.dose = `${dose[1]} ${dose[2]}`;

    const morning = /\b(?:por\s+la\s+manana|manana|desayuno)\b/i.test(nearby);
    const midday = /\b(?:al\s+mediodia|mediodia|en\s+la\s+comida|comida)\b/i.test(nearby);
    const night = /\b(?:por\s+la\s+noche|noche|antes\s+de\s+dormir|cena)\b/i.test(nearby);
    if (morning || midday || night) prior.schedule = `${morning ? 1 : 0} - ${midday ? 1 : 0} - ${night ? 1 : 0}`;
    else if (/\ba\s+demanda\b/i.test(nearby)) prior.schedule = "a demanda";
    return prior;
  };

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

  const completePriorRegimenReplacement = lines.some((line) =>
    line.speaker === "PSIQUIATRA"
    && COMPLETE_PRIOR_REGIMEN_REPLACEMENT_PATTERN.test(normalize(line.text))
  );
  const hasPostChangeMedicationEvidence = (med) => lines.some((line) =>
    line.speaker === "PSIQUIATRA"
    && line.index >= planAnchorIndex
    && lineMentionsMedication(line, med)
    && (
      CLINICIAN_PRESCRIPTION_PATTERN.test(normalize(line.text))
      || CLINICIAN_MAINTENANCE_PATTERN.test(normalize(line.text))
      || CLINICIAN_TREATMENT_CHANGE_PATTERN.test(normalize(line.text))
    )
  );
  const removedByCompleteReplacement = (med) =>
    completePriorRegimenReplacement
    && hasPreexistingEvidence(med)
    && !hasPostChangeMedicationEvidence(med);

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
  assessment.medications.current = current.filter((med) => {
    const explicitlyDiscontinued = hasExplicitDiscontinuation(med);
    const replacedWithPriorRegimen = removedByCompleteReplacement(med);
    if (!explicitlyDiscontinued && !replacedWithPriorRegimen) return true;
    const name = clean(med.display_name) || clean(med.raw_name) || "medicamento";
    warnings.push(replacedWithPriorRegimen
      ? `medication_complete_prior_regimen_removed_from_current:${name}`
      : `medication_explicitly_discontinued_removed_from_current:${name}`);
    return false;
  });

  // La pauta final debe ser completa. Un fármaco habitual no retirado se mantiene
  // también en TRATAMIENTO REVISADO aunque el modelo solo haya devuelto los cambios.
  for (const med of retainedHabitual) {
    if (med?.status !== "active" || hasExplicitDiscontinuation(med) || removedByCompleteReplacement(med)) continue;
    if (assessment.medications.current.some((existing) => overlaps(existing, med))) continue;
    assessment.medications.current.push({ ...med, status: "active" });
    const name = clean(med.display_name) || clean(med.raw_name) || "medicamento";
    warnings.push(`medication_maintained_carried_to_current:${name}`);
  }

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
  if (isExplicitHabitualMedicationAnswer(lines, line)) {
    if (med) return lineMentionsMedication(line, med);
    return medicationNamesInText(line.text).length > 0;
  }
  const explicitPriorDoseChange = line.speaker === "PSIQUIATRA"
    && CLINICIAN_TREATMENT_CHANGE_PATTERN.test(normalize(line.text))
    && (med
      ? medicationCandidateNames(med).some((name) => explicitDoseChangeFromMention(line.text, name))
      : medicationNamesInText(line.text).some((name) => explicitDoseChangeFromMention(line.text, name)));
  if (explicitPriorDoseChange) return true;
  if (line.index >= planAnchorIndex) return false;
  if (med && !lineMentionsMedication(line, med)) return false;
  if (isFamilySelfMedicationLine(lines, line)) return false;

  if (med && clinicianConfirmedPreexistingMedication(lines, line, med)) {
    return true;
  }

  const evidenceTexts = med
    ? transcriptUnits(line.text)
      .filter((unit) => lineMentionsMedication({ ...line, text: unit }, med))
      .map(normalize)
    : [normalize(line.text)];

  if (line.speaker === "PACIENTE") {
    const previous = previousSpeakerLine(lines, line);
    return evidenceTexts.some((text) => {
      if (NO_CURRENT_MEDICATION_PATTERN.test(text)) return false;
      if (EXPLICIT_MEDICATION_REGIMEN_PATTERN.test(text) && !HISTORICAL_MEDICATION_PATTERN.test(text)) return true;
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

export function normalizeMedicationSchedule(value, prn = false) {
  const schedule = clean(value);
  if (prn || /\b(?:a\s+demanda|de\s+rescate|si\s+precisa|cuando\s+lo\s+necesite)\b/i.test(schedule)) {
    const quantity = schedule.match(/\b(\d+(?:[.,]\d+)?\s+(?:inhalaciones?|comprimidos?|capsulas?|cápsulas?|gotas?|pulsaciones?|sobres?))\b/i);
    if (quantity) return `${quantity[1]} a demanda`;
    return "a demanda";
  }
  const numeric = schedule.match(/^\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*$/);
  if (numeric) return `${numeric[1]} - ${numeric[2]} - ${numeric[3]}`;
  if (!schedule || /\b(?:pauta\s+ambigua|alternativamente)\b/i.test(schedule)) return schedule;

  const normalized = normalize(schedule);
  if (/\b(?:manana|desayuno)\s+o\s+(?:mediodia|comida|cena|noche)\b/i.test(normalized)) return schedule;
  const morning = /\b(?:por\s+la\s+manana|a\s+la\s+manana|manana|desayuno)\b/i.test(normalized);
  const midday = /\b(?:al\s+mediodia|mediodia|en\s+la\s+comida|con\s+la\s+comida|comida)\b/i.test(normalized);
  const night = /\b(?:por\s+la\s+noche|a\s+la\s+noche|noche|antes\s+de\s+dormir|al\s+acostarse|cena)\b/i.test(normalized);
  if (!morning && !midday && !night) return schedule;
  return `${morning ? 1 : 0} - ${midday ? 1 : 0} - ${night ? 1 : 0}`;
}

function normalizeMedicationSchedules(assessment, warnings) {
  for (const group of ["habitual", "current"]) {
    for (const med of assessment.medications?.[group] || []) {
      const before = clean(med.schedule);
      const after = normalizeMedicationSchedule(before, med.prn === true);
      if (after === before) continue;
      med.schedule = after;
      const name = clean(med.display_name) || clean(med.raw_name) || "medicamento";
      warnings.push(`medication_schedule_normalized:${group}:${name}:${after}`);
    }
  }
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

function canonicalizeVerifiedMedicationNamesInSections(assessment, warnings) {
  const replacements = [];
  for (const group of [assessment.medications?.habitual, assessment.medications?.current]) {
    for (const med of group || []) {
      const rawName = clean(med?.raw_name);
      const displayName = clean(med?.display_name);
      if (!rawName || !displayName || normalize(rawName) === normalize(displayName)) continue;
      if (med?.medication_verification?.status !== "confirmed") continue;
      replacements.push({ rawName, displayName });
    }
  }

  replacements.sort((left, right) => right.rawName.length - left.rawName.length);
  for (const section of Object.values(assessment.sections || {})) {
    if (!section?.text) continue;
    for (const { rawName, displayName } of replacements) {
      const escaped = rawName
        .split(/\s+/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s+");
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
      const updated = section.text.replace(pattern, displayName);
      if (updated !== section.text) {
        section.text = updated;
        warnings.push(`medication_verified_name_propagated_to_sections:${rawName}->${displayName}`);
      }
    }
  }
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

function pruneGenericMedicationSectionPlaceholders(assessment, warnings) {
  for (const [sectionKey, group] of [
    ["tratamiento_habitual", "habitual"],
    ["tratamiento_actual", "current"],
  ]) {
    const hasVisibleMedication = (assessment.medications?.[group] || [])
      .some((med) => med?.status === "active" || (group === "current" && med?.status === "administered_once"));
    if (hasVisibleMedication) continue;
    const section = assessment.sections?.[sectionKey];
    const text = normalize(section?.text);
    if (!/^(?:la\s+)?(?:pauta|tratamiento|medicacion)\s+(?:previa|anterior|vigente|actual|revisada?)$/.test(text)) continue;
    section.text = "";
    section.evidence_status = "not_provided";
    section.source_ids = [];
    warnings.push(`generic_medication_placeholder_pruned:${sectionKey}`);
  }
}

function refreshMedicationPresentationInPlace(assessment, warnings) {
  normalizeMedicationSchedules(assessment, warnings);
  canonicalizeVerifiedMedicationNamesInSections(assessment, warnings);
  syncMedicationSection(assessment, "habitual", "tratamiento_habitual", ["active"]);
  syncMedicationSection(assessment, "current", "tratamiento_actual", ["active", "administered_once"]);
  pruneGenericMedicationSectionPlaceholders(assessment, warnings);
}

export function applyVerifiedMedicationPresentation(inputAssessment) {
  const assessment = structuredClone(inputAssessment);
  const warnings = [];
  refreshMedicationPresentationInPlace(assessment, warnings);
  return { assessment, warnings };
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

    if (line.speaker === "PACIENTE") return true;
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

function splitReportSentences(text) {
  return String(text || "").match(/[^.!?]+[.!?]?/g)?.map((item) => item.trim()).filter(Boolean) || [];
}
function appendReportText(section, text, sourceIds = []) {
  if (!section || !text) return;
  const placeholder = /^(?:no explorado|no explorada|no consta|informaci[oó]n insuficiente)\.?$/i;
  const existing = placeholder.test(clean(section.text)) ? "" : clean(section.text);
  const seen = new Set();
  section.text = splitReportSentences([existing, text].filter(Boolean).join(" ")).filter((sentence) => {
    const key = normalize(sentence).replace(/[^a-z0-9 ]/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(" ");
  section.evidence_status = "supported";
  section.source_ids = [...new Set([...(section.source_ids || []), ...sourceIds])];
}
function transcriptSupportsConcept(transcript, sentence, conceptPattern) {
  const terms = (normalize(sentence).match(/[a-z0-9]{5,}/g) || []).filter((term) => conceptPattern.test(term));
  const source = normalize(transcript);
  return terms.some((term) => source.includes(term));
}
function repairClinicalSectionRouting(assessment, transcript, warnings) {
  const sections = assessment.sections || {};
  const illness = sections.enfermedad_actual, mse = sections.exploracion_psicopatologica, plan = sections.plan_terapeutico;
  const sourceIds = sourceIdsForSpeaker(assessment, "PSIQUIATRA");
  const msePattern = /\b(?:durante\s+la\s+entrevista\s+(?:permanece|se\s+muestra)|permanece\s+(?:vigil|alerta|orientad[oa]|centrad[oa])|comunicaci[oó]n\s+adecuada|no\s+presenta\s+sintomatolog[ií]a\s+psic[oó]tica|no\s+presenta\s+alteraciones?\s+de\s+los\s+biorritmos|pensamientos?\s+intrusivos?\s+de\s+muerte|ideaci[oó]n\s+(?:o\s+planificaci[oó]n\s+)?autol[ií]tica|autoagresividad|poca\s+conciencia\s+de\s+enfermedad|desbordamiento\s+vital)\b/i;
  const planPattern = /\b(?:se\s+decide|se\s+acuerda|mantener\s+observaci[oó]n|observaci[oó]n\s+hasta\s+(?:el\s+)?d[ií]a\s+siguiente|valorar\s+(?:la\s+)?tolerancia|respuesta\s+y\s+evoluci[oó]n|evoluci[oó]n\s+nocturna|seguimiento|revisi[oó]n\s+(?:en|por)|ingreso|alta\s+domiciliaria|derivaci[oó]n)\b/i;
  const greeting = /^(?:buenas\s+(?:noches|tardes|d[ií]as)|mi\s+nombre\s+es|me\s+llamo|soy\s+(?:el\s+|la\s+)?psiquiatra|voy\s+a\s+valorar)\b/i;
  if (illness?.text) {
    const keep=[], moveMse=[], movePlan=[];
    for (const sentence of splitReportSentences(illness.text)) {
      if (msePattern.test(sentence) && transcriptSupportsConcept(transcript,sentence,/(?:vigil|orientad|centrad|comunicacion|sintomatologia|psicotica|biorritmos|intrusivos|ideacion|autoagresividad|conciencia|desbordamiento)/i)) moveMse.push(sentence);
      else if (planPattern.test(sentence) && transcriptSupportsConcept(transcript,sentence,/(?:decide|acuerda|observacion|tolerancia|respuesta|evolucion|seguimiento|revision|ingreso|alta|derivacion)/i)) movePlan.push(sentence);
      else keep.push(sentence);
    }
    if (moveMse.length) { appendReportText(mse,moveMse.join(" "),sourceIds); warnings.push("clinical_observation_rerouted_from_current_illness"); }
    const planAlreadyCoversDecision = /\b(?:sustituir|observaci[oó]n|tolerancia|respuesta|evoluci[oó]n|seguimiento|ingreso|alta|derivaci[oó]n)\b/i.test(plan?.text || "");
    if (movePlan.length && !planAlreadyCoversDecision) { appendReportText(plan,movePlan.join(" "),sourceIds); warnings.push("treatment_plan_rerouted_from_current_illness"); }
    illness.text=keep.join(" ");
    if (!illness.text) { illness.evidence_status="not_provided"; illness.source_ids=[]; }
  }
  for (const section of Object.values(sections)) if (section?.text) section.text=splitReportSentences(section.text).filter((s)=>!greeting.test(s)).join(" ");
}

export function applyClinicalPostprocessing(inputAssessment, transcript) {
  const assessment = structuredClone(inputAssessment);
  const warnings = [];

  prunePlaceholderMedicationEntities(assessment, warnings);
  repairClinicalSectionRouting(assessment, transcript, warnings);
  recoverHabitualMedicationFromExplicitSubstitutions(assessment, transcript, warnings);
  recoverHabitualMedicationFromPreconsultTranscript(assessment, transcript, warnings);
  recoverMedicationDoseChanges(assessment, transcript, warnings);
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
  refreshMedicationPresentationInPlace(assessment, warnings);
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
