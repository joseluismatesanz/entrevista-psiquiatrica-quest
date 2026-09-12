export const MEDICATION_NAME_ALIASES = [
  {
    id: "cetralina_to_sertralina",
    source: "cetralina",
    canonical: "sertralina",
    pattern: /\bcetralina\b/giu,
  },
  {
    id: "ribotril_to_rivotril",
    source: "ribotril",
    canonical: "rivotril",
    pattern: /\bribotril\b/giu,
  },
];

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToken(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function matchCase(source, replacement) {
  if (!source) return replacement;
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

export function normalizeKnownMedicationAliasText(value) {
  let text = String(value || "");
  let replacements = 0;
  const applied_aliases = [];

  for (const alias of MEDICATION_NAME_ALIASES) {
    let applied = 0;
    text = text.replace(alias.pattern, (matched) => {
      replacements += 1;
      applied += 1;
      return matchCase(matched, alias.canonical);
    });
    if (applied) applied_aliases.push(alias.id);
  }

  return { text, replacements, applied_aliases };
}

export function resolveKnownMedicationAlias(value) {
  const original = clean(value);
  const normalized = normalizeToken(original);
  if (!normalized) return { original, canonical: original, aliasId: "", corrected: false };

  for (const alias of MEDICATION_NAME_ALIASES) {
    if (normalized === normalizeToken(alias.source)) {
      return {
        original,
        canonical: matchCase(original, alias.canonical),
        aliasId: alias.id,
        corrected: true,
      };
    }
  }

  return { original, canonical: original, aliasId: "", corrected: false };
}
