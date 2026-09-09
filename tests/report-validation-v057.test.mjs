import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, validationJs, packageJson] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v058.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

test("V0.5.6 informe: la validación tiene una consecuencia real sobre la edición", () => {
  assert.match(validationJs, /state = \{ validated: false \}/);
  assert.match(validationJs, /function setEditLocked/);
  assert.match(validationJs, /setEditLocked\(true\)/);
  assert.match(validationJs, /setEditLocked\(false\)/);
});

test("V0.5.6 informe: no puede validarse mientras una sección está abierta", () => {
  assert.match(validationJs, /function isEditing/);
  assert.match(validationJs, /report-section-editing/);
  assert.match(validationJs, /validate\.disabled = isEditing\(\) \|\| state\.validated/);
});

test("V0.5.6 informe: copiar permanece bloqueado hasta validar", () => {
  assert.match(validationJs, /copy\.disabled = true/);
  assert.match(validationJs, /copy\.disabled = false/);
  assert.match(validationJs, /check\.checked = true/);
  assert.match(validationJs, /check\.checked = false/);
});

test("V0.5.6 informe: el navegador fuerza la carga de la nueva capa de validación", () => {
  assert.match(indexHtml, /report-v056\.js\?v=20260909-3/);
  assert.match(indexHtml, /report-validation-v058\.js\?v=20260909-3/);
  assert.match(packageJson, /node --check report-validation-v058\.js/);
});
