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

export function anchorExplicitFamilyRole({ segments, index, proposedRole, previousRole }) {
  const own = explicitFamilyRoleFromOwnText(segments?.[index]?.text);
  if (own) return own;
  if (proposedRole === "psychiatrist" || previousRole !== "psychiatrist" || index <= 0) return proposedRole;
  return explicitFamilyRoleFromAddressedTurn(segments[index - 1]?.text) || proposedRole;
}
