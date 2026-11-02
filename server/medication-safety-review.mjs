const MAX_DAILY_DOSE_MG = new Map([
  ["mirtazapina", 45],
  ["sertralina", 200],
  ["escitalopram", 20],
  ["duloxetina", 120],
]);

const SEROTONERGIC = new Set([
  "sertralina",
  "escitalopram",
  "duloxetina",
  "venlafaxina",
  "fluoxetina",
  "paroxetina",
  "citalopram",
  "clomipramina",
]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function medicationName(medication) {
  return normalize(medication?.display_name || medication?.raw_name)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ingredientKey(medication) {
  const name = medicationName(medication);
  return [...MAX_DAILY_DOSE_MG.keys(), ...SEROTONERGIC].find((candidate) =>
    name === candidate || name.startsWith(`${candidate} `) || name.includes(` ${candidate} `)
  ) || "";
}

function numericDoseMg(medication) {
  const match = clean(medication?.dose).match(/(\d+(?:[.,]\d+)?)\s*mg\b/i);
  if (!match) return null;
  return Number.parseFloat(match[1].replace(",", "."));
}

function scheduleMultiplier(schedule) {
  const text = clean(schedule);
  const technical = text.match(/^\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*$/);
  if (technical) return technical.slice(1).reduce((total, value) => total + Number.parseFloat(value.replace(",", ".")), 0);
  if (/\b(?:a demanda|si precisa|rescate)\b/i.test(text)) return null;
  const times = text.match(/\b(\d+)\s+veces?\s+al\s+d[ií]a\b/i);
  if (times) return Number.parseInt(times[1], 10);
  return 1;
}

function addSafetyItem(assessment, topic, evidence, sourceIds = []) {
  assessment.safety_review ||= [];
  if (assessment.safety_review.some((item) => item.topic === topic && item.evidence === evidence)) return;
  assessment.safety_review.push({
    topic,
    evidence,
    source_ids: [...new Set(sourceIds.filter(Boolean))],
    needs_clinician_review: true,
  });
}

export function applyMedicationSafetyReview(inputAssessment) {
  const assessment = structuredClone(inputAssessment);
  const warnings = [];
  const revised = (assessment.medications?.current || []).filter((medication) => medication?.status === "active");

  for (const medication of revised) {
    const key = ingredientKey(medication);
    const max = MAX_DAILY_DOSE_MG.get(key);
    const dose = numericDoseMg(medication);
    const multiplier = scheduleMultiplier(medication?.schedule);
    if (!max || !Number.isFinite(dose) || !Number.isFinite(multiplier)) continue;
    const daily = dose * multiplier;
    if (daily <= max) continue;
    const label = clean(medication.display_name || medication.raw_name) || key;
    addSafetyItem(
      assessment,
      `medication_safety:dose:${key}`,
      `${label}: la pauta registrada equivale a ${daily} mg/día y supera la dosis máxima de ${max} mg/día recogida en ficha técnica CIMA. Verificar transcripción, dosis e indicación antes de validar.`,
      medication.source_ids
    );
    warnings.push(`medication_daily_dose_above_cima_max:${key}:${daily}>${max}`);
  }

  const serotonergic = revised
    .map((medication) => ({ medication, key: ingredientKey(medication) }))
    .filter(({ key }) => SEROTONERGIC.has(key));
  const unique = [...new Map(serotonergic.map((item) => [item.key, item])).values()];
  if (unique.length >= 2) {
    const labels = unique.map(({ medication }) => clean(medication.display_name || medication.raw_name)).filter(Boolean);
    addSafetyItem(
      assessment,
      "medication_safety:serotonergic_combination",
      `Combinación serotoninérgica (${labels.join(" + ")}): las fichas técnicas CIMA advierten de mayor riesgo de síndrome serotoninérgico con otros fármacos serotoninérgicos. Confirmar que la asociación o la transición es intencionada y revisar la monitorización clínica.`,
      unique.flatMap(({ medication }) => medication.source_ids || [])
    );
    warnings.push(`medication_serotonergic_combination:${unique.map(({ key }) => key).join("+")}`);
  }

  return { assessment, warnings };
}
