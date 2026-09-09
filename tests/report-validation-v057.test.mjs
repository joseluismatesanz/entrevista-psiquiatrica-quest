import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, validationJs, packageJson] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v057.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

test("V0.5.6 informe: una edición invalida la validación previa con estado interno", () => {
  assert.match(validationJs, /revision:/);
  assert.match(validationJs, /validatedRevision:/);
  assert.match(validationJs, /function invalidateValidation/);
  assert.match(validationJs, /check\.checked = false/);
  assert.match(validationJs, /copy\.disabled = true/);
});

test("V0.5.6 informe: no puede validarse mientras una sección está abierta", () => {
  assert.match(validationJs, /function isEditing/);
  assert.match(validationJs, /report-section-editing/);
  assert.match(validationJs, /check\.disabled = true/);
  assert.match(validationJs, /Finaliza la edición antes de validar el informe/);
});

test("V0.5.6 informe: copiar exige validación de la revisión actual", () => {
  assert.match(validationJs, /state\.validatedRevision === state\.revision/);
  assert.match(validationJs, /getClinicalReportText/);
  assert.match(validationJs, /event\.stopImmediatePropagation\(\)/);
});

test("V0.5.6 informe: el navegador carga una capa nueva y fuerza refresco del script anterior", () => {
  assert.match(indexHtml, /report-v056\.js\?v=20260909-2/);
  assert.match(indexHtml, /report-validation-v057\.js/);
  assert.match(packageJson, /node --check report-validation-v057\.js/);
});
