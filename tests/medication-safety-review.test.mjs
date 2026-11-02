import test from "node:test";
import assert from "node:assert/strict";
import { applyMedicationSafetyReview } from "../server/medication-safety-review.mjs";
import { renderClinicalReport } from "../server/render-report.mjs";

function assessmentWithCurrent(current) {
  return {
    sections: {
      tratamiento_habitual: { text: "", evidence_status: "not_provided", source_ids: [] },
      tratamiento_actual: { text: "", evidence_status: "supported", source_ids: [] },
    },
    medications: { habitual: [], current },
    safety_review: [],
  };
}

function medication(name, dose, schedule) {
  return {
    raw_name: name,
    display_name: name,
    dose,
    schedule,
    route: "oral",
    prn: false,
    adherence_text: "",
    adherence_status: "unknown",
    status: "active",
    source_ids: ["src-1"],
  };
}

test("marca una dosis de mirtazapina superior al máximo de ficha técnica", () => {
  const input = assessmentWithCurrent([medication("Mirtazapina", "500 mg", "0 - 0 - 1")]);
  const result = applyMedicationSafetyReview(input);
  assert.equal(result.assessment.safety_review.length, 1);
  assert.match(result.assessment.safety_review[0].evidence, /500 mg\/día.*45 mg\/día/i);
  assert.match(renderClinicalReport(result.assessment), /TRATAMIENTO REVISADO[\s\S]*WARNING:/);
});

test("marca una combinación de varios antidepresivos serotoninérgicos", () => {
  const input = assessmentWithCurrent([
    medication("Sertralina", "100 mg", "1 - 0 - 0"),
    medication("Escitalopram", "10 mg", "0 - 1 - 0"),
    medication("Duloxetina", "60 mg", "1 - 0 - 0"),
  ]);
  const result = applyMedicationSafetyReview(input);
  assert.ok(result.assessment.safety_review.some((item) => item.topic === "medication_safety:serotonergic_combination"));
  assert.match(renderClinicalReport(result.assessment), /síndrome serotoninérgico/i);
});

test("no alerta por una pauta dentro del máximo y un solo serotoninérgico", () => {
  const input = assessmentWithCurrent([medication("Mirtazapina", "30 mg", "0 - 0 - 1")]);
  const result = applyMedicationSafetyReview(input);
  assert.deepEqual(result.assessment.safety_review, []);
});
