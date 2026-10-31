import {
  matchCase,
  normalizeKnownMedicationAliasText,
  resolveHighConfidenceMedicationCandidate,
} from "./medication-name-aliases.mjs";

const MEDICATION_CONTEXT_PATTERN = /\b(?:tomo|toma|tomando|tomar|medicaci[oó]n|medicamento|f[aá]rmaco|tratamiento|pastillas?|comprimidos?|c[aá]psulas?|dosis|pauta|mg|miligramos?|por\s+la\s+ma[nñ]ana|por\s+la\s+noche|desayuno|cena|a\s+demanda|prn)\b/i;
const TOKEN_PATTERN = /\b[\p{L}][\p{L}-]{5,}\b/gu;

function applyContextualFuzzyMedicationRecovery(text) {
  if (!MEDICATION_CONTEXT_PATTERN.test(text)) {
    return { text, replacements: 0, applied_aliases: [] };
  }

  let replacements = 0;
  const appliedAliases = [];
  const next = text.replace(TOKEN_PATTERN, (token) => {
    const candidate = resolveHighConfidenceMedicationCandidate(token);
    if (!candidate.corrected || candidate.correctionType !== "high_confidence_fuzzy") return token;
    replacements += 1;
    appliedAliases.push(candidate.aliasId);
    return matchCase(token, candidate.canonical);
  });

  return { text: next, replacements, applied_aliases: appliedAliases };
}

export function normalizeMedicationAsrText(value) {
  const exact = normalizeKnownMedicationAliasText(value);
  const fuzzy = applyContextualFuzzyMedicationRecovery(exact.text);
  return {
    text: fuzzy.text,
    replacements: exact.replacements + fuzzy.replacements,
    applied_aliases: [...new Set([...exact.applied_aliases, ...fuzzy.applied_aliases])],
  };
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
