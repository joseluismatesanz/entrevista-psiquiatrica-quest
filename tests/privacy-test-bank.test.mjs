import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { redactPersonNamesInSegments } from "../server/person-name-redaction.mjs";

const [bankSource, case3Source] = await Promise.all([
  readFile(new URL("../fixture-privacy-bank.js", import.meta.url), "utf8"),
  readFile(new URL("../fixture-case3.js", import.meta.url), "utf8"),
]);

function mockClient(items) {
  return {
    responses: {
      async parse(params) {
        assert.equal(params.store, false);
        assert.match(params.instructions, /XXXXXXXXXXX/);
        return {
          status: "completed",
          output_parsed: { items },
        };
      },
    },
  };
}

test("Banco privacidad: integra A, B y C en un selector compacto", () => {
  assert.match(bankSource, /Caso A · Nombres/);
  assert.match(bankSource, /Caso B · Ambiguos/);
  assert.match(bankSource, /Caso C · Entidades/);
  assert.match(bankSource, /id = 'privacyTestBank'/);
  assert.match(bankSource, /loadPrivacyTest/);
  assert.match(case3Source, /fixture-privacy-bank\.js\?v=20260909-1/);
});

test("Caso A: contiene nombres simples, compuestos y apellidos para estresar la máscara", () => {
  for (const name of [
    "María García López",
    "Carlos Pérez Martín",
    "Ana Ruiz Sánchez",
    "José Antonio Pérez Gómez",
    "Javier de la Fuente",
  ]) {
    assert.match(bankSource, new RegExp(name));
  }
});

test("Caso B: distingue nombres ambiguos de usos no personales", async () => {
  const result = await redactPersonNamesInSegments([
    { id: "b1", speaker: "A", text: "Soy la doctora Mercedes Romero." },
    { id: "b2", speaker: "B", text: "Ángel Martín. Mi hermana Paz Martín vino conmigo. Últimamente tengo poca paz." },
    { id: "b3", speaker: "B", text: "Mi padre nos trajo en su Mercedes y luego se fue." },
  ], {
    client: mockClient([
      { segment_id: "b1", redacted_text: "Soy la doctora XXXXXXXXXXX.", replacements: 1, residual_person_name: false },
      { segment_id: "b2", redacted_text: "XXXXXXXXXXX. Mi hermana XXXXXXXXXXX vino conmigo. Últimamente tengo poca paz.", replacements: 2, residual_person_name: false },
      { segment_id: "b3", redacted_text: "Mi padre nos trajo en su Mercedes y luego se fue.", replacements: 0, residual_person_name: false },
    ]),
  });

  assert.doesNotMatch(result.transcript, /Mercedes Romero|Ángel Martín|Paz Martín/);
  assert.match(result.transcript, /poca paz/);
  assert.match(result.transcript, /su Mercedes/);
  assert.equal(result.replacements, 3);
});

test("Caso C: conserva entidades clínicas y geográficas mientras enmascara personas", async () => {
  const result = await redactPersonNamesInSegments([
    { id: "c1", speaker: "A", text: "Vivo en Madrid y me atiende la doctora Elena Martín en el Hospital Universitario La Paz. Tomo sertralina 50 miligramos por la mañana." },
    { id: "c2", speaker: "A", text: "Mi tía Clara tiene trastorno bipolar y vive en Portugal." },
  ], {
    client: mockClient([
      { segment_id: "c1", redacted_text: "Vivo en Madrid y me atiende la doctora XXXXXXXXXXX en el Hospital Universitario La Paz. Tomo sertralina 50 miligramos por la mañana.", replacements: 1, residual_person_name: false },
      { segment_id: "c2", redacted_text: "Mi tía XXXXXXXXXXX tiene trastorno bipolar y vive en Portugal.", replacements: 1, residual_person_name: false },
    ]),
  });

  assert.doesNotMatch(result.transcript, /Elena Martín|\bClara\b/);
  for (const entity of [
    "Madrid",
    "Hospital Universitario La Paz",
    "sertralina 50 miligramos",
    "trastorno bipolar",
    "Portugal",
  ]) {
    assert.match(result.transcript, new RegExp(entity));
  }
  assert.equal(result.replacements, 2);
});
