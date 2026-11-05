import { normalizeMedicationSchedule } from "./clinical-postprocess.mjs";
import { PSYCHIATRIC_MEDICATION_VOCABULARY } from "./medication-name-aliases.mjs";

export const SECTION_ORDER = [
  ["motivo_consulta", "MOTIVO DE LA CONSULTA"],
  ["psq_guardia", "PSQ GUARDIA"],
  ["alergias_ram", "ALERGIAS / RAM"],
  ["antecedentes_somaticos", "ANTECEDENTES PERSONALES SOMÁTICOS"],
  ["antecedentes_salud_mental", "ANTECEDENTES PERSONALES EN SALUD MENTAL"],
  ["antecedentes_familiares_psiquiatricos", "ANTECEDENTES FAMILIARES PSIQUIÁTRICOS"],
  ["situacion_sociofamiliar", "SITUACIÓN SOCIOFAMILIAR"],
  ["habitos_toxicos", "HÁBITOS TÓXICOS"],
  ["tratamiento_habitual", "TRATAMIENTO VIGENTE"],
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
  return clean(value)
    .replace(/\s*\(\s*no\s+(?:(?:se\s+)?encontr[oó]|encontrada)\s+correspondencia\s+en\s+CIMA\s*\)\s*$/i, "")
    .trim();
}

function medicationLine(med) {
  const name = cleanMedicationName(med.display_name)
    || cleanMedicationName(med.raw_name)
    || "Medicamento no identificado";
  const dose = clean(med.dose);
  const schedule = normalizeMedicationSchedule(clean(med.schedule), med.prn === true);
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

function planWithoutMedicationRegimens(text, assessment) {
  const names = new Set([
    ...PSYCHIATRIC_MEDICATION_VOCABULARY,
    ...(assessment.medications?.habitual || []).flatMap((med) => [
      med?.raw_name,
      med?.display_name,
      ...(med?.medication_verification?.activeIngredients || []),
    ]),
    ...(assessment.medications?.current || []).flatMap((med) => [
      med?.raw_name,
      med?.display_name,
      ...(med?.medication_verification?.activeIngredients || []),
    ]),
  ].map((name) => clean(name).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()).filter(Boolean));
  const sentences = String(text || "").match(/[^.!?]+[.!?]?/g)?.map((item) => item.trim()).filter(Boolean) || [];
  let removed = false;
  const retained = sentences.filter((sentence) => {
    const normalized = sentence.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const namesMedication = [...names].some((name) => normalized.includes(name));
    const hasDoseOrSchedule = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|g|ml|ui)\b|\b\d+\s*[-–]\s*\d+\s*[-–]\s*\d+\b/i.test(sentence);
    if (namesMedication && hasDoseOrSchedule) {
      removed = true;
      return false;
    }
    return true;
  });
  if (!retained.length && removed) {
    return "Ajuste farmacológico según la pauta consignada en TRATAMIENTO REVISADO.";
  }
  return retained.join(" ");
}

function medicationWarnings(assessment) {
  return (assessment.safety_review || [])
    .filter((item) => String(item?.topic || "").startsWith("medication_safety:"))
    .map((item) => clean(item.evidence))
    .filter(Boolean)
    .map((text) => `WARNING: ${text}`)
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
    if (key === "plan_terapeutico") body = planWithoutMedicationRegimens(body, assessment);

    // Vigente = exclusivamente medicación que el paciente tomaba al llegar.
    // Revisado = régimen completo que queda indicado al terminar la consulta.
    // Si existe estructura de medicación, es la fuente canónica: nunca volver al texto libre
    // cuando el único contenido estructurado era histórico.
    if (key === "tratamiento_habitual") {
      const list = assessment.medications?.habitual;
      if (Array.isArray(list) && list.length > 0) {
        body = medicationBlock(list, ["active"]);
        if (!body) body = "No consta tratamiento vigente activo.";
      }
    }
    if (key === "tratamiento_actual") {
      const list = assessment.medications?.current;
      if (Array.isArray(list) && list.length > 0) {
        body = medicationBlock(list, ["active", "administered_once"]);
        if (!body) body = "No consta tratamiento revisado activo.";
      }
      const warnings = medicationWarnings(assessment);
      if (warnings) body = [body, warnings].filter(Boolean).join("\n");
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
