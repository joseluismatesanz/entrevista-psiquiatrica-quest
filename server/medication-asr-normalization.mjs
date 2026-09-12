import { normalizeKnownMedicationAliasText } from "./medication-name-aliases.mjs";

export function normalizeMedicationAsrText(value) {
  return normalizeKnownMedicationAliasText(value);
}

export function normalizeMedicationAsrSegments(segments) {
  let replacements = 0;
  const aliases = new Set();
  const normalized = (Array.isArray(segments) ? segments : []).map((segment) => {
    const result = normalizeMedicationAsrText(segment?.text);
    replacements += result.replacements;
    for (const alias of result.applied_aliases) aliases.add(alias);
    return { ...segment, text: result.text };
  });
  return {
    segments: normalized,
    replacements,
    applied_aliases: [...aliases],
  };
}
