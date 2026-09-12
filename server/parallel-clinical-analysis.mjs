import { z } from "zod";
import { ClinicalAssessmentSchema } from "./clinical-schema.mjs";

const sourceKind = z.enum([
  "patient", "psychiatrist", "mother", "father", "sibling", "caregiver", "family",
  "clinician_observation", "nurse", "ehr", "police", "security", "other",
]);
const evidenceStatus = z.enum(["supported", "not_explored", "not_provided", "insufficient"]);
const section = z.object({ text: z.string(), evidence_status: evidenceStatus, source_ids: z.array(z.string()) }).strict();
const source = z.object({ id: z.string(), label: z.string(), kind: sourceKind }).strict();
const medication = z.object({
  raw_name: z.string(),
  display_name: z.string(),
  active_ingredient_known: z.boolean(),
  role: z.enum(["psychiatric", "organic", "unknown"]),
  dose: z.string(),
  schedule: z.string(),
  route: z.string(),
  prn: z.boolean(),
  adherence_status: z.enum(["good", "irregular", "poor", "unknown", "not_applicable"]),
  adherence_text: z.string(),
  status: z.enum(["active", "historical", "administered_once"]),
  source_ids: z.array(z.string()),
}).strict();
const missingItem = z.object({
  topic: z.string(),
  status: z.enum(["not_explored", "not_provided", "insufficient"]),
  note: z.string(),
}).strict();
const conflict = z.object({
  topic: z.string(),
  accounts: z.array(z.object({ source_id: z.string(), statement: z.string() }).strict()).min(2),
}).strict();

export const HistoryClinicalSchema = z.object({
  sources: z.array(source),
  sections: z.object({
    motivo_consulta: section,
    psq_guardia: section,
    alergias_ram: section,
    antecedentes_somaticos: section,
    antecedentes_salud_mental: section,
    antecedentes_familiares_psiquiatricos: section,
    situacion_sociofamiliar: section,
    habitos_toxicos: section,
    tratamiento_habitual: section,
  }).strict(),
  medications_habitual: z.array(medication),
  missing_or_not_explored: z.array(missingItem),
  conflicts: z.array(conflict),
}).strict();

export const CurrentClinicalSchema = z.object({
  sources: z.array(source),
  sections: z.object({
    enfermedad_actual: section,
    intervencion: section,
    exploracion_psicopatologica: section,
    orientacion_diagnostica: section,
    plan_terapeutico: section,
    tratamiento_actual: section,
  }).strict(),
  medications_current: z.array(medication),
  diagnostic_judgment: z.object({
    primary_diagnosis: z.string(),
    cie10_code: z.string(),
    dsm5_code: z.string(),
    provisional: z.boolean(),
    differential: z.array(z.string()),
    basis_summary: z.string(),
    requires_clinician_validation: z.literal(true),
  }).strict(),
  missing_or_not_explored: z.array(missingItem),
  conflicts: z.array(conflict),
  safety_review: z.array(z.object({
    topic: z.string(),
    evidence: z.string(),
    source_ids: z.array(z.string()),
    needs_clinician_review: z.literal(true),
  }).strict()),
}).strict();

export const HISTORY_PROMPT = `
Eres un asistente de documentación clínica psiquiátrica. Extrae SOLO la mitad histórica/contextual de un borrador clínico a partir de evidencia ya desidentificada. No inventes ni completes por inferencia.

Devuelve exactamente el esquema solicitado.
- MOTIVO: una formulación clínica muy breve y directa.
- PSQ GUARDIA: solo autoidentificación profesional explícita; si no existe, vacío/not_provided.
- ALERGIAS/RAM: solo lo realmente explorado.
- ANTECEDENTES SOMÁTICOS y DE SALUD MENTAL: solo datos aportados o verificados; una propuesta actual no demuestra un antecedente.
- ANTECEDENTES FAMILIARES PSIQUIÁTRICOS: conserva paciente y familiares/cuidadores como fuentes válidas; no mezcles discrepancias.
- SITUACIÓN SOCIOFAMILIAR: convivencia, relaciones, apoyos, escolarización/empleo según edad; no conviertas contenido potencialmente delirante sobre identidad/filiación en hecho objetivo.
- HÁBITOS TÓXICOS: nicotina, alcohol, cannabis y otras sustancias con patrón y discrepancias.
- TRATAMIENTO HABITUAL: medicación vigente antes de la valoración y adherencia. Una entidad por fármaco; no inventes principio activo, dosis ni pauta.
- missing_or_not_explored: solo ausencias clínicamente relevantes para riesgo, diagnóstico, tratamiento o seguimiento; no lista exhaustiva.
- conflicts: conserva versiones incompatibles sin elegir una arbitrariamente.
- Crea source IDs estables dentro de TU respuesta y úsalos solo cuando sustentan el dato.
- La evidencia puede ser una selección conservadora de líneas exactas: lo omitido NO equivale a negado ni explorado.
`;

export const CURRENT_PROMPT = `
Eres un asistente de documentación clínica psiquiátrica. Extrae SOLO episodio actual, exploración, seguridad, juicio clínico y plan a partir de evidencia ya desidentificada. Es un BORRADOR para validación obligatoria por psiquiatra. No inventes ni completes por inferencia.

Devuelve exactamente el esquema solicitado.
- ENFERMEDAD ACTUAL: narrativa sintética del episodio, evolución, síntomas, precipitantes y versiones relevantes; no vuelques antecedentes estables.
- INTERVENCIÓN: solo propuesta explícita del psiquiatra + aceptación/rechazo del paciente/familia cuando conste.
- EXPLORACIÓN PSICOPATOLÓGICA: únicamente estado actual observado o explorado directamente. Ausencia de datos no equivale a normalidad.
- ORIENTACIÓN DIAGNÓSTICA: solo diagnóstico de trabajo si hay criterios suficientes. Si faltan duración, síndrome, impacto funcional, sustancias/causas médicas u otros datos esenciales, deja diagnóstico y códigos vacíos y marca insufficient; no uses categorías no especificadas para rellenar.
- PLAN TERAPÉUTICO: ingreso/no ingreso, unidad, cambios farmacológicos, pruebas, seguimiento, seguridad y medidas no farmacológicas solo cuando estén sustentados.
- TRATAMIENTO ACTUAL: medicación final tras la valoración; separa dosis puntual administered_once de tratamiento activo.
- RIESGO: NSSI no es automáticamente intento suicida; conserva conducta preparatoria, heteroagresividad y discrepancias de fuentes.
- MEDICACIÓN: no inventes principio activo, dosis, vía, pauta ni adherencia.
- missing_or_not_explored: solo ausencias con posible impacto clínico real.
- conflicts: conserva versiones incompatibles sin resolverlas sin base.
- safety_review: solo hechos que realmente requieren revisión clínica, con fuentes.
- Crea source IDs estables dentro de TU respuesta y úsalos solo cuando sustentan el dato.
- La evidencia puede ser una selección conservadora de líneas exactas: lo omitido NO equivale a negado ni explorado.
`;

const SINGULAR_CLINICAL_SOURCE_KINDS = new Set([
  "patient", "psychiatrist", "mother", "father", "clinician_observation", "ehr",
]);

function sourceKey(source) {
  const kind = String(source?.kind || "other");
  if (SINGULAR_CLINICAL_SOURCE_KINDS.has(kind)) return kind;
  const label = String(source?.label || "")
    .replace(/X{3,}/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es");
  return `${kind}|${label}`;
}

function canonicalPrefix(kind) {
  return ({
    patient: "pat", psychiatrist: "psy", mother: "mom", father: "dad", sibling: "sib",
    caregiver: "care", family: "fam", clinician_observation: "obs", nurse: "nurse",
    ehr: "ehr", police: "police", security: "sec", other: "src",
  })[kind] || "src";
}

function buildSourceRegistry(outputs) {
  const registry = new Map();
  const usedIds = new Set();
  const remaps = new Map();

  for (const output of outputs) {
    const localMap = new Map();
    for (const src of output?.sources || []) {
      const key = sourceKey(src);
      let canonical = registry.get(key);
      if (!canonical) {
        const prefix = canonicalPrefix(src.kind);
        let id = prefix;
        let n = 2;
        while (usedIds.has(id)) id = `${prefix}${n++}`;
        canonical = { id, label: String(src.label || src.kind || "Fuente"), kind: src.kind };
        registry.set(key, canonical);
        usedIds.add(id);
      }
      localMap.set(String(src.id), canonical.id);
    }
    remaps.set(output, localMap);
  }
  return { sources: [...registry.values()], remaps };
}

function remapIds(ids, map) {
  return [...new Set((ids || []).map((id) => map.get(String(id))).filter(Boolean))];
}

function remapSection(value, map) {
  return { ...value, source_ids: remapIds(value?.source_ids, map) };
}

function remapMedication(value, map) {
  return { ...value, source_ids: remapIds(value?.source_ids, map) };
}

function remapConflicts(values, map) {
  return (values || []).map((item) => ({
    ...item,
    accounts: (item.accounts || []).map((account) => ({
      ...account,
      source_id: map.get(String(account.source_id)) || "",
    })).filter((account) => account.source_id),
  })).filter((item) => item.accounts.length >= 2);
}

function dedupeByJson(values) {
  const seen = new Set();
  return (values || []).filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mergeParallelClinicalAssessment(history, current) {
  const { sources, remaps } = buildSourceRegistry([history, current]);
  const hMap = remaps.get(history) || new Map();
  const cMap = remaps.get(current) || new Map();

  const assessment = {
    sources,
    sections: {
      motivo_consulta: remapSection(history.sections.motivo_consulta, hMap),
      psq_guardia: remapSection(history.sections.psq_guardia, hMap),
      alergias_ram: remapSection(history.sections.alergias_ram, hMap),
      antecedentes_somaticos: remapSection(history.sections.antecedentes_somaticos, hMap),
      antecedentes_salud_mental: remapSection(history.sections.antecedentes_salud_mental, hMap),
      antecedentes_familiares_psiquiatricos: remapSection(history.sections.antecedentes_familiares_psiquiatricos, hMap),
      situacion_sociofamiliar: remapSection(history.sections.situacion_sociofamiliar, hMap),
      habitos_toxicos: remapSection(history.sections.habitos_toxicos, hMap),
      tratamiento_habitual: remapSection(history.sections.tratamiento_habitual, hMap),
      enfermedad_actual: remapSection(current.sections.enfermedad_actual, cMap),
      intervencion: remapSection(current.sections.intervencion, cMap),
      exploracion_psicopatologica: remapSection(current.sections.exploracion_psicopatologica, cMap),
      orientacion_diagnostica: remapSection(current.sections.orientacion_diagnostica, cMap),
      plan_terapeutico: remapSection(current.sections.plan_terapeutico, cMap),
      tratamiento_actual: remapSection(current.sections.tratamiento_actual, cMap),
    },
    medications: {
      habitual: (history.medications_habitual || []).map((item) => remapMedication(item, hMap)),
      current: (current.medications_current || []).map((item) => remapMedication(item, cMap)),
    },
    diagnostic_judgment: current.diagnostic_judgment,
    missing_or_not_explored: dedupeByJson([
      ...(history.missing_or_not_explored || []),
      ...(current.missing_or_not_explored || []),
    ]),
    conflicts: dedupeByJson([
      ...remapConflicts(history.conflicts, hMap),
      ...remapConflicts(current.conflicts, cMap),
    ]),
    safety_review: (current.safety_review || []).map((item) => ({
      ...item,
      source_ids: remapIds(item.source_ids, cMap),
    })),
    validation: { is_draft: true, clinician_validation_required: true },
  };

  return ClinicalAssessmentSchema.parse(assessment);
}
