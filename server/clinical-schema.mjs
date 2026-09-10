import { z } from "zod";

const sourceKind = z.enum([
  "patient",
  "psychiatrist",
  "mother",
  "father",
  "sibling",
  "caregiver",
  "family",
  "clinician_observation",
  "nurse",
  "ehr",
  "police",
  "security",
  "other",
]);

const evidenceStatus = z.enum([
  "supported",
  "not_explored",
  "not_provided",
  "insufficient",
]);

const section = z.object({
  text: z.string(),
  evidence_status: evidenceStatus,
  source_ids: z.array(z.string()),
}).strict();

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

export const ClinicalAssessmentSchema = z.object({
  sources: z.array(z.object({
    id: z.string(),
    label: z.string(),
    kind: sourceKind,
  }).strict()),
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
    enfermedad_actual: section,
    intervencion: section,
    exploracion_psicopatologica: section,
    orientacion_diagnostica: section,
    plan_terapeutico: section,
    tratamiento_actual: section,
  }).strict(),
  medications: z.object({
    habitual: z.array(medication),
    current: z.array(medication),
  }).strict(),
  diagnostic_judgment: z.object({
    primary_diagnosis: z.string(),
    cie10_code: z.string(),
    dsm5_code: z.string(),
    provisional: z.boolean(),
    differential: z.array(z.string()),
    basis_summary: z.string(),
    requires_clinician_validation: z.literal(true),
  }).strict(),
  missing_or_not_explored: z.array(z.object({
    topic: z.string(),
    status: z.enum(["not_explored", "not_provided", "insufficient"]),
    note: z.string(),
  }).strict()),
  conflicts: z.array(z.object({
    topic: z.string(),
    accounts: z.array(z.object({
      source_id: z.string(),
      statement: z.string(),
    }).strict()).min(2),
  }).strict()),
  safety_review: z.array(z.object({
    topic: z.string(),
    evidence: z.string(),
    source_ids: z.array(z.string()),
    needs_clinician_review: z.literal(true),
  }).strict()),
  validation: z.object({
    is_draft: z.literal(true),
    clinician_validation_required: z.literal(true),
  }).strict(),
}).strict();
