import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, validationJs] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v058.js", import.meta.url), "utf8"),
]);

test("V0.5.6 validación: se sustituye la casilla visible por un botón explícito", () => {
  assert.match(validationJs, /Validar informe/);
  assert.match(validationJs, /hideLegacyValidationCheckbox/);
  assert.match(validationJs, /checkline/);
  assert.match(validationJs, /classList\.add\('hidden'\)/);
});

test("V0.5.6 validación: validar bloquea la edición y habilita la copia", () => {
  assert.match(validationJs, /function validateReport/);
  assert.match(validationJs, /state\.validated = true/);
  assert.match(validationJs, /copy\.disabled = false/);
  assert.match(validationJs, /setEditLocked\(true\)/);
  assert.match(validationJs, /Informe validado · edición bloqueada/);
});

test("V0.5.6 validación: reabrir edición invalida la validación", () => {
  assert.match(validationJs, /Reabrir edición/);
  assert.match(validationJs, /function reopenEditing/);
  assert.match(validationJs, /setUnvalidated/);
  assert.match(validationJs, /Cualquier cambio requerirá una nueva validación/);
});

test("V0.5.6 validación: los botones Editar desaparecen mientras el informe está validado", () => {
  assert.match(validationJs, /function setEditLocked/);
  assert.match(validationJs, /report-edit-button/);
  assert.match(validationJs, /button\.disabled = locked/);
  assert.match(validationJs, /button\.classList\.toggle\('hidden', locked\)/);
});

test("V0.5.6 validación: index fuerza la carga de esta revisión del script", () => {
  assert.match(indexHtml, /report-validation-v058\.js\?v=20260909-3/);
  assert.doesNotMatch(indexHtml, /report-validation-v057\.js/);
});
