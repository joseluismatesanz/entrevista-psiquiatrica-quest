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

test("ASR farmacológico: conserva mayúscula inicial y no altera palabras distintas", () => {
  assert.equal(normalizeMedicationAsrText("Cetralina").text, "Sertralina");
  assert.equal(normalizeMedicationAsrText("La paciente está centrada.").text, "La paciente está centrada.");
});

test("ASR farmacológico: normaliza segmentos conservando identidad y timestamps", () => {
  const result = normalizeMedicationAsrSegments([
    { id: "s1", speaker: "A", start: 0, end: 1, text: "Cetralina 50 mg." },
    { id: "s2", speaker: "B", start: 1, end: 2, text: "De acuerdo." },
  ]);
  assert.equal(result.segments[0].text, "Sertralina 50 mg.");
  assert.equal(result.segments[0].id, "s1");
  assert.equal(result.segments[0].start, 0);
  assert.equal(result.segments[1].text, "De acuerdo.");
  assert.equal(result.replacements, 1);
});
