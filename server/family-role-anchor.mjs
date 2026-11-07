const RULES = [
  {
    role: "mother",
    self: ["soy su madre", "soy la madre"],
    addressed: ["usted es su madre", "usted es la madre", "es usted su madre", "es usted la madre", "usted que es su madre", "usted que es la madre", "usted es madre", "es usted madre"],
  },
  {
    role: "father",
    self: ["soy su padre", "soy el padre"],
    addressed: ["usted es su padre", "usted es el padre", "es usted su padre", "es usted el padre", "usted que es su padre", "usted que es el padre", "usted es padre", "es usted padre"],
  },
  {
    role: "sibling",
    self: ["soy su hermano", "soy el hermano", "soy su hermana", "soy la hermana"],
    addressed: [
      "usted es su hermano", "usted es el hermano", "es usted su hermano", "es usted el hermano", "usted que es su hermano", "usted que es el hermano",
      "usted es su hermana", "usted es la hermana", "es usted su hermana", "es usted la hermana", "usted que es su hermana", "usted que es la hermana",
    ],
  },
];

const FAMILY_ROLES = new Set(["mother", "father", "sibling", "caregiver", "family"]);
const FORMAL_CONTINUATION_PATTERN = /\b(?:usted|senora|senor)\b/i;

function normalize(value) {
  return String(value || "")
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(text, phrases) {
  const normalized = ` ${normalize(text)} `;
  return phrases.some((phrase) => normalized.includes(` ${phrase} `));
}

export function explicitFamilyRoleFromOwnText(text) {
  return RULES.find((rule) => containsPhrase(text, rule.self))?.role || null;
}

export function explicitFamilyRoleFromAddressedTurn(text) {
  return RULES.find((rule) => containsPhrase(text, rule.addressed))?.role || null;
}

function lastResolvedParticipantRole(segments, index, resolvedRoles) {
  if (!(resolvedRoles instanceof Map)) return null;
  for (let cursor = index - 2; cursor >= 0; cursor -= 1) {
    const role = resolvedRoles.get(segments?.[cursor]?.id);
    if (!role || role === "psychiatrist") continue;
    return role;
  }
  return null;
}

function lastParticipantRoleFromContext(previousSafeContext) {
  const labels = {
    MADRE: "mother",
    PADRE: "father",
    "HERMANO/A": "sibling",
    "CUIDADOR/A": "caregiver",
    FAMILIAR: "family",
    PACIENTE: "patient",
  };
  let lastRole = null;
  for (const line of String(previousSafeContext || "").split(/\n+/)) {
    const match = line.match(/^\s*(MADRE|PADRE|HERMANO\/A|CUIDADOR\/A|FAMILIAR|PACIENTE)\s*:/i);
    if (match) lastRole = labels[match[1].toLocaleUpperCase("es")] || null;
  }
  return lastRole;
}

export function resolveFamilyRoleAnchor({
  segments,
  index,
  proposedRole,
  previousRole,
  resolvedRoles,
  previousSafeContext = "",
}) {
  const own = explicitFamilyRoleFromOwnText(segments?.[index]?.text);
  if (own) return { role: own, reason: "explicit_family_relationship" };
  if (proposedRole === "psychiatrist" || previousRole !== "psychiatrist" || index <= 0) {
    return { role: proposedRole, reason: "" };
  }

  const previousText = segments[index - 1]?.text;
  const explicit = explicitFamilyRoleFromAddressedTurn(previousText);
  if (explicit) return { role: explicit, reason: "explicit_family_relationship" };

  if (FORMAL_CONTINUATION_PATTERN.test(normalize(previousText))) {
    const currentRole = lastResolvedParticipantRole(segments, index, resolvedRoles)
      || lastParticipantRoleFromContext(previousSafeContext);
    if (FAMILY_ROLES.has(currentRole)) {
      return { role: currentRole, reason: "family_addressee_continuity" };
    }
  }

  return { role: proposedRole, reason: "" };
}

export function anchorExplicitFamilyRole(options) {
  return resolveFamilyRoleAnchor(options).role;
}
