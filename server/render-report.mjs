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
  ["tratamiento_actual", "TRATAMIENTO ACTUAL"],
];

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
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
      if (Array.isArray(list) && list.length > 0) {
        body = medicationBlock(list, ["active", "administered_once"]);
        if (!body) body = "No consta tratamiento actual activo.";
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
