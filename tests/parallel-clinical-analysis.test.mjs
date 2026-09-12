import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mergeParallelClinicalAssessment } from "../server/parallel-clinical-analysis.mjs";
import { ClinicalAssessmentSchema } from "../server/clinical-schema.mjs";

const [apiAnalyze, serverAnalyze] = await Promise.all([
  readFile(new URL("../api/analyze.mjs", import.meta.url), "utf8"),
  readFile(new URL("../server/analyze.mjs", import.meta.url), "utf8"),
]);

const sec = (text = "", evidence_status = "not_provided", source_ids = []) => ({ text, evidence_status, source_ids });
const med = (name, source_ids) => ({
  raw_name: name,
  display_name: name,
  active_ingredient_known: true,
  role: "psychiatric",
  dose: "",
  schedule: "",
  route: "oral",
  prn: false,
  adherence_status: "unknown",
  adherence_text: "",
  status: "active",
  source_ids,
});

function historyFixture() {
  return {
    sources: [
      { id: "h-patient", label: "Paciente", kind: "patient" },
      { id: "h-mother", label: "Madre", kind: "mother" },
    ],
    sections: {
      motivo_consulta: sec("Insomnio y nerviosismo.", "supported", ["h-patient"]),
      psq_guardia: sec(),
      alergias_ram: sec("No explorado.", "not_explored", []),
      antecedentes_somaticos: sec(),
      antecedentes_salud_mental: sec(),
      antecedentes_familiares_psiquiatricos: sec(),
      situacion_sociofamiliar: sec("Convive con su madre.", "supported", ["h-patient", "h-mother"]),
      habitos_toxicos: sec(),
      tratamiento_habitual: sec("Sertralina.", "supported", ["h-patient"]),
    },
    medications_habitual: [med("Sertralina", ["h-patient"])],
    missing_or_not_explored: [{ topic: "riesgo", status: "not_explored", note: "No explorado." }],
    conflicts: [],
  };
}

test("V0.6 paralelo: conserva compatibilidad con la fusión original de dos ramas", () => {
  const history = historyFixture();
  const current = {
    sources: [
      { id: "c-pat", label: "Paciente", kind: "patient" },
      { id: "c-mom", label: "Madre", kind: "mother" },
      { id: "c-psy", label: "Psiquiatra", kind: "psychiatrist" },
    ],
    sections: {
      enfermedad_actual: sec("Nerviosismo de varios días.", "supported", ["c-pat", "c-mom"]),
      intervencion: sec(),
      exploracion_psicopatologica: sec("Colabora durante la entrevista.", "supported", ["c-psy"]),
      orientacion_diagnostica: sec("Información insuficiente para juicio diagnóstico.", "insufficient", ["c-pat"]),
      plan_terapeutico: sec(),
      tratamiento_actual: sec("Sertralina.", "supported", ["c-pat"]),
    },
    medications_current: [med("Sertralina", ["c-pat"])],
    diagnostic_judgment: {
      primary_diagnosis: "",
      cie10_code: "",
      dsm5_code: "",
      provisional: true,
      differential: [],
      basis_summary: "Información insuficiente.",
      requires_clinician_validation: true,
    },
    missing_or_not_explored: [{ topic: "sustancias", status: "not_explored", note: "No explorado." }],
    conflicts: [],
    safety_review: [],
  };

  const merged = mergeParallelClinicalAssessment(history, current);
  assert.doesNotThrow(() => ClinicalAssessmentSchema.parse(merged));
  assert.equal(merged.sources.filter((s) => s.kind === "patient").length, 1);
  assert.equal(merged.sources.filter((s) => s.kind === "mother").length, 1);
  assert.equal(merged.sources.filter((s) => s.kind === "psychiatrist").length, 1);
  assert.equal(merged.medications.habitual[0].display_name, "Sertralina");
  assert.equal(merged.medications.current[0].display_name, "Sertralina");
  assert.equal(merged.validation.clinician_validation_required, true);
});

test("V0.6.1 paralelo: fusiona historia + episodio/MSE + diagnóstico/plan en el esquema completo", () => {
  const history = historyFixture();
  const acute = {
    sources: [
      { id: "a-pat", label: "Paciente", kind: "patient" },
      { id: "a-mom", label: "Madre", kind: "mother" },
      { id: "a-psy", label: "Psiquiatra", kind: "psychiatrist" },
    ],
    sections: {
      enfermedad_actual: sec("Nerviosismo de varios días.", "supported", ["a-pat", "a-mom"]),
      intervencion: sec(),
      exploracion_psicopatologica: sec("Colabora durante la entrevista.", "supported", ["a-psy"]),
    },
    missing_or_not_explored: [{ topic: "riesgo", status: "not_explored", note: "No explorado." }],
    conflicts: [],
    safety_review: [],
  };
  const plan = {
    sources: [
      { id: "p-pat", label: "Paciente", kind: "patient" },
      { id: "p-psy", label: "Psiquiatra", kind: "psychiatrist" },
    ],
    sections: {
      orientacion_diagnostica: sec("Información insuficiente para juicio diagnóstico.", "insufficient", ["p-pat"]),
      plan_terapeutico: sec("Seguimiento clínico.", "supported", ["p-psy"]),
      tratamiento_actual: sec("Sertralina.", "supported", ["p-pat"]),
    },
    medications_current: [med("Sertralina", ["p-pat"])],
    diagnostic_judgment: {
      primary_diagnosis: "",
      cie10_code: "",
      dsm5_code: "",
      provisional: true,
      differential: [],
      basis_summary: "Información insuficiente.",
      requires_clinician_validation: true,
    },
    missing_or_not_explored: [{ topic: "sustancias", status: "not_explored", note: "No explorado." }],
    conflicts: [],
  };

  const merged = mergeParallelClinicalAssessment(history, acute, plan);
  assert.doesNotThrow(() => ClinicalAssessmentSchema.parse(merged));
  assert.equal(merged.sources.filter((s) => s.kind === "patient").length, 1);
  assert.equal(merged.sources.filter((s) => s.kind === "mother").length, 1);
  assert.equal(merged.sources.filter((s) => s.kind === "psychiatrist").length, 1);
  assert.equal(merged.sections.enfermedad_actual.text, "Nerviosismo de varios días.");
  assert.equal(merged.sections.plan_terapeutico.text, "Seguimiento clínico.");
  assert.equal(merged.medications.current[0].display_name, "Sertralina");
  assert.equal(merged.validation.clinician_validation_required, true);
});

test("V0.6.1 paralelo: solo se activa en ruta completa con evidencia incremental verificada", () => {
  assert.match(apiAnalyze, /parallelFullMode\s*=\s*!fastRoute\s*&&\s*evidenceBundle\.verified/);
  assert.match(apiAnalyze, /parallelMode:\s*true/);
  assert.match(apiAnalyze, /parallel_full_close:\s*parallelFullMode/);
  assert.match(serverAnalyze, /Promise\.all/);
  assert.match(serverAnalyze, /parallel_full_route:\s*parallelMode/);
  assert.match(serverAnalyze, /HistoryClinicalSchema/);
  assert.match(serverAnalyze, /AcuteClinicalSchema/);
  assert.match(serverAnalyze, /PlanClinicalSchema/);
  assert.match(serverAnalyze, /parallel_branch_count:\s*parallelMode\s*\?\s*3\s*:\s*0/);
});
