const MEDICATION_ASR_ALIASES = [
  {
    id: "cetralina_to_sertralina",
    pattern: /\bcetralina\b/giu,
    replacement: "sertralina",
  },
];

function matchCase(source, replacement) {
  if (!source) return replacement;
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

export function normalizeMedicationAsrText(value) {
  let text = String(value || "");
  let replacements = 0;
  const applied_aliases = [];

  for (const alias of MEDICATION_ASR_ALIASES) {
    let applied = 0;
    text = text.replace(alias.pattern, (matched) => {
      replacements += 1;
      applied += 1;
      return matchCase(matched, alias.replacement);
    });
    if (applied) applied_aliases.push(alias.id);
  }

  return { text, replacements, applied_aliases };
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
