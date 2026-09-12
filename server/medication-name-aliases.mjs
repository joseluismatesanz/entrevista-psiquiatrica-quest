export const MEDICATION_NAME_ALIASES = [
  {
    id: "cetralina_to_sertralina",
    source: "cetralina",
    canonical: "sertralina",
    pattern: /\bcetralina\b/giu,
  },
  {
    id: "sertalina_to_sertralina",
    source: "sertalina",
    canonical: "sertralina",
    pattern: /\bsertalina\b/giu,
  },
  {
    id: "ribotril_to_rivotril",
    source: "ribotril",
    canonical: "rivotril",
    pattern: /\bribotril\b/giu,
  },
  {
    id: "mirtacepina_to_mirtazapina",
    source: "mirtacepina",
    canonical: "mirtazapina",
    pattern: /\bmirtacepina\b/giu,
  },
  {
    id: "mirtazepina_to_mirtazapina",
    source: "mirtazepina",
    canonical: "mirtazapina",
    pattern: /\bmirtazepina\b/giu,
  },
  {
    id: "mertazapina_to_mirtazapina",
    source: "mertazapina",
    canonical: "mirtazapina",
    pattern: /\bmertazapina\b/giu,
  },
  {
    id: "mirtrazapina_to_mirtazapina",
    source: "mirtrazapina",
    canonical: "mirtazapina",
    pattern: /\bmirtrazapina\b/giu,
  },
  {
    id: "mirta_zapina_to_mirtazapina",
    source: "mirta zapina",
    canonical: "mirtazapina",
    pattern: /\bmirta\s+zapina\b/giu,
    lookup: false,
  },
  {
    id: "loracepam_to_lorazepam",
    source: "loracepam",
    canonical: "lorazepam",
    pattern: /\bloracepam\b/giu,
  },
  {
    id: "clonacepam_to_clonazepam",
    source: "clonacepam",
    canonical: "clonazepam",
    pattern: /\bclonacepam\b/giu,
  },
];

export const PSYCHIATRIC_MEDICATION_VOCABULARY = [
  "sertralina",
  "mirtazapina",
  "lorazepam",
  "rivotril",
  "clonazepam",
  "risperidona",
  "aripiprazol",
  "quetiapina",
  "olanzapina",
  "fluoxetina",
  "escitalopram",
  "citalopram",
  "venlafaxina",
  "duloxetina",
  "bupropion",
  "lamotrigina",
  "haloperidol",
  "oxcarbazepina",
  "guanfacina",
  "clonidina",
  "litio",
];

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeMedicationToken(value) {
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

function levenshtein(left, right) {
  const a = normalizeMedicationToken(left);
  const b = normalizeMedicationToken(right);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + cost,
      );
      diagonal = above;
    }
  }
  return previous[b.length];
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
  const normalized = normalizeMedicationToken(original);
  if (!normalized) return { original, canonical: original, aliasId: "", corrected: false, correctionType: "none" };

  for (const alias of MEDICATION_NAME_ALIASES) {
    if (alias.lookup === false) continue;
    if (normalized === normalizeMedicationToken(alias.source)) {
      return {
        original,
        canonical: matchCase(original, alias.canonical),
        aliasId: alias.id,
        corrected: true,
        correctionType: "validated_alias",
      };
    }
  }

  return { original, canonical: original, aliasId: "", corrected: false, correctionType: "none" };
}

export function resolveHighConfidenceMedicationCandidate(value) {
  const alias = resolveKnownMedicationAlias(value);
  if (alias.corrected) return alias;

  const original = clean(value);
  const normalized = normalizeMedicationToken(original);
  if (normalized.length < 6) return alias;

  if (PSYCHIATRIC_MEDICATION_VOCABULARY.some((name) => normalizeMedicationToken(name) === normalized)) {
    return alias;
  }

  const ranked = PSYCHIATRIC_MEDICATION_VOCABULARY
    .map((canonical) => {
      const target = normalizeMedicationToken(canonical);
      const distance = levenshtein(normalized, target);
      const similarity = 1 - (distance / Math.max(normalized.length, target.length));
      return { canonical, distance, similarity };
    })
    .sort((a, b) => a.distance - b.distance || b.similarity - a.similarity);

  const best = ranked[0];
  const second = ranked[1];
  const maxDistance = normalized.length >= 10 ? 3 : 2;
  const uniquelyBetter = !second
    || second.distance - best.distance >= 2
    || best.similarity - second.similarity >= 0.08;

  if (!best || best.distance > maxDistance || best.similarity < 0.78 || !uniquelyBetter) return alias;

  return {
    original,
    canonical: matchCase(original, best.canonical),
    aliasId: `fuzzy_${normalized}_to_${normalizeMedicationToken(best.canonical)}`,
    corrected: true,
    correctionType: "high_confidence_fuzzy",
    distance: best.distance,
    similarity: best.similarity,
  };
}
