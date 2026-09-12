import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMedicationAsrText,
  normalizeMedicationAsrSegments,
} from "../server/medication-asr-normalization.mjs";

test("ASR farmacológico: corrige cetralina a sertralina sin otra llamada de modelo", () => {
  const result = normalizeMedicationAsrText("Tomo cetralina 50 mg por la mañana.");
  assert.equal(result.text, "Tomo sertralina 50 mg por la mañana.");
  assert.equal(result.replacements, 1);
  assert.deepEqual(result.applied_aliases, ["cetralina_to_sertralina"]);
});

test("ASR farmacológico: corrige ribotril a rivotril sin fuzzy libre", () => {
  const result = normalizeMedicationAsrText("Por la noche tomo Ribotril 0,5 mg.");
  assert.equal(result.text, "Por la noche tomo Rivotril 0,5 mg.");
  assert.equal(result.replacements, 1);
  assert.deepEqual(result.applied_aliases, ["ribotril_to_rivotril"]);
});

test("ASR farmacológico: recupera variantes observadas de mirtazapina", () => {
  for (const heard of ["Mirtacepina", "Mirtazepina", "Mertazapina", "Mirtrazapina"]) {
    const result = normalizeMedicationAsrText(`Tomo ${heard} 15 mg por la noche.`);
    assert.equal(result.text, "Tomo Mirtazapina 15 mg por la noche.");
    assert.equal(result.replacements, 1);
  }
});

test("ASR farmacológico: permite aproximación única de alta confianza solo en contexto farmacológico", () => {
  const medicationContext = normalizeMedicationAsrText("Tomo mirtazipina 15 mg por la noche.");
  assert.equal(medicationContext.text, "Tomo mirtazapina 15 mg por la noche.");
  assert.equal(medicationContext.replacements, 1);
  assert.ok(medicationContext.applied_aliases.some((id) => id.startsWith("fuzzy_")));

  const noMedicationContext = normalizeMedicationAsrText("La palabra mirtazipina aparece en un texto de prueba.");
  assert.equal(noMedicationContext.text, "La palabra mirtazipina aparece en un texto de prueba.");
  assert.equal(noMedicationContext.replacements, 0);
});

test("ASR farmacológico: conserva mayúscula inicial y no altera palabras distintas", () => {
  assert.equal(normalizeMedicationAsrText("Cetralina").text, "Sertralina");
  assert.equal(normalizeMedicationAsrText("Ribotril").text, "Rivotril");
  assert.equal(normalizeMedicationAsrText("La paciente está centrada.").text, "La paciente está centrada.");
});

test("ASR farmacológico: normaliza segmentos conservando identidad y timestamps", () => {
  const result = normalizeMedicationAsrSegments([
    { id: "s1", speaker: "A", start: 0, end: 1, text: "Cetralina 50 mg." },
    { id: "s2", speaker: "B", start: 1, end: 2, text: "Ribotril 0,5 mg." },
    { id: "s3", speaker: "B", start: 2, end: 3, text: "Mirtacepina 15 mg por la noche." },
  ]);
  assert.equal(result.segments[0].text, "Sertralina 50 mg.");
  assert.equal(result.segments[0].id, "s1");
  assert.equal(result.segments[0].start, 0);
  assert.equal(result.segments[1].text, "Rivotril 0,5 mg.");
  assert.equal(result.segments[2].text, "Mirtazapina 15 mg por la noche.");
  assert.equal(result.replacements, 3);
  assert.ok(result.applied_aliases.includes("cetralina_to_sertralina"));
  assert.ok(result.applied_aliases.includes("ribotril_to_rivotril"));
  assert.ok(result.applied_aliases.includes("mirtacepina_to_mirtazapina"));
});
