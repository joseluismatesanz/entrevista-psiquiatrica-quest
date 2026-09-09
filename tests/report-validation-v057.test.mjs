import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, validationJs, packageJson] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v058.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

test("V0.5.6 informe: una edición invalida la validación previa con estado interno", () => {
  assert.match(validationJs, /revision:/);
  assert.match(validationJs, /reviewedRevision:/);
  assert.match(validationJs, /validatedRevision:/);
  assert.match(validationJs, /function invalidateValidation/);
  assert.match(validationJs, /check\.checked = false/);
  assert.match(validationJs, /copy\.disabled = true/);
});

test("V0.5.6 informe: no puede validarse mientras una sección está abierta o hay cambios sin revisar", () => {
  assert.match(validationJs, /function isEditing/);
  assert.match(validationJs, /report-section-editing/);
  assert.match(validationJs, /hasUnreviewedChanges/);
  assert.match(validationJs, /check\.disabled = editing \|\| pendingReview/);
});

test("V0.5.6 informe: copiar exige validación y revisión de la versión actual", () => {
  assert.match(validationJs, /state\.validatedRevision === state\.revision/);
  assert.match(validationJs, /state\.reviewedRevision === state\.revision/);
  assert.match(validationJs, /getClinicalReportText/);
  assert.match(validationJs, /event\.stopImmediatePropagation\(\)/);
});

test("V0.5.6 informe: el navegador fuerza la carga de la nueva capa de validación", () => {
  assert.match(indexHtml, /report-v056\.js\?v=20260909-3/);
  assert.match(indexHtml, /report-validation-v058\.js\?v=20260909-1/);
  assert.match(packageJson, /node --check report-validation-v058\.js/);
});
