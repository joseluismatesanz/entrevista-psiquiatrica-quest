export const SECTION_ORDER = [
  ["motivo_consulta", "MOTIVO DE LA CONSULTA"],
  ["psq_guardia", "PSQ GUARDIA"],
  ["alergias_ram", "ALERGIAS / RAM"],
  ["antecedentes_somaticos", "ANTECEDENTES PERSONALES SOMÁTICOS"],
  ["antecedentes_salud_mental", "ANTECEDENTES PERSONALES EN SALUD MENTAL"],
  ["antecedentes_familiares_psiquiatricos", "ANTECEDENTES FAMILIARES PSIQUIÁTRICOS"],
  ["situacion_sociofamiliar", "SITUACIÓN SOCIOFAMILIAR"],
  ["habitos_toxicos", "HÁBITOS TÓXICOS"],
  ["tratamiento_habitual", "TRATAMIENTO HABITUAL"],
  ["enfermedad_actual", "ENFERMEDAD ACTUAL"],
  ["intervencion", "INTERVENCIÓN"],
  ["exploracion_psicopatologica", "EXPLORACIÓN PSICOPATOLÓGICA"],
  ["orientacion_diagnostica", "ORIENTACIÓN DIAGNÓSTICA"],
  ["plan_terapeutico", "PLAN TERAPÉUTICO"],
  ["tratamiento_actual", "TRATAMIENTO REVISADO"],
];

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanAdherence(value) {
  const adherence = clean(value).replace(/^adherencia\s*:?\s*/i, "").trim();
  if (/^\[?\s*(?:unknown|not[_ ]?applicable|null|n\/?a)\s*\]?$/i.test(adherence)) return "";
  return adherence;
}

function cleanMedicationName(value) {
  return clean(value);
}

function medicationLine(med) {
  const name = cleanMedicationName(med.display_name)
    || cleanMedicationName(med.raw_name)
    || "Medicamento no identificado";
  const dose = clean(med.dose);
  const schedule = clean(med.schedule);
  const route = clean(med.route);
  const adherence = cleanAdherence(med.adherence_text);
  const normalizedSchedule = schedule
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const technicalSchedule = (() => {
    if (!schedule || med.prn || /\b(?:cada\s+\d+\s+horas?|semanal|mensual)\b/i.test(normalizedSchedule)) return "";
    if (/^\s*\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*$/.test(schedule)) {
      return schedule.replace(/\s*-\s*/g, " - ");
    }
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

function medicationBlock(list, allowedStatuses) {
  if (!Array.isArray(list) || list.length === 0) return "";
  const allowed = new Set(allowedStatuses);
  return list
    .filter((med) => allowed.has(med?.status))
    .map(medicationLine)
    .filter(Boolean)
    .join("\n");
}

export function renderClinicalReport(assessment) {
  const lines = [];
  for (const [key, title] of SECTION_ORDER) {
    const section = assessment.sections?.[key] ?? { text: "", evidence_status: "not_provided" };

    // PSQ GUARDIA es un dato identificativo del profesional, no un hallazgo clínico.
    // Si el profesional no se ha identificado de forma explícita, el apartado se omite
    // en lugar de mostrar un "No consta" sin utilidad asistencial.
    if (key === "psq_guardia" && (!clean(section.text) || section.evidence_status !== "supported")) {
      continue;
    }

    // INTERVENCIÓN solo existe si hubo propuesta explícita + aceptación/rechazo.
    if (key === "intervencion" && (!clean(section.text) || section.evidence_status !== "supported")) {
      continue;
    }

    let body = clean(section.text);

    // Habitual = exclusivamente medicación vigente antes de la valoración.
    // Current = régimen final + dosis administradas una sola vez durante el episodio actual.
    // Si existe estructura de medicación, es la fuente canónica: nunca volver al texto libre
    // cuando el único contenido estructurado era histórico.
    if (key === "tratamiento_habitual") {
      const list = assessment.medications?.habitual;
      if (Array.isArray(list) && list.length > 0) {
        body = medicationBlock(list, ["active"]);
        if (!body) body = "No consta tratamiento habitual activo.";
      }
    }
    if (key === "tratamiento_actual") {
      const list = assessment.medications?.current;
      if (Array.isArray(list)) {
        body = medicationBlock(list, ["active", "administered_once"]);
        if (!body) body = "No consta tratamiento revisado.";
      }
      const interactionReview = assessment.medication_interaction_review;
      if (interactionReview?.status === "interaction_found" && interactionReview.findings?.length) {
        const findings = interactionReview.findings.map((finding) =>
          `ALERTA DE INTERACCIÓN CIMA — ${finding.medicines.join(" + ")}. ${finding.type}: ${finding.detail} (Ficha técnica, sección 4.5).`
        );
        body += `\n\n${findings.join("\n")}\nFuente: CIMA, sección 4.5.`;
      } else if (interactionReview?.status === "incomplete") {
        body += `\n\nREVISIÓN DE INTERACCIONES CIMA INCOMPLETA: ${interactionReview.note}`;
      } else if (interactionReview?.status === "no_direct_interaction_found") {
        body += `\n\nREVISIÓN DE INTERACCIONES CIMA: ${interactionReview.note}`;
      }
      }
    }

    if (!body) {
      if (section.evidence_status === "not_explored") body = "No explorado.";
      else if (section.evidence_status === "insufficient") body = "Información insuficiente.";
      else if (section.evidence_status === "not_provided") body = "No consta.";
    }

    lines.push(`${title}\n${body}`.trim());
  }
  return lines.join("\n\n");
}
