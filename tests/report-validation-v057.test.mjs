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

test("V0.5.6 informe: copiar y envío-destrucción permanecen bloqueados hasta validar", () => {
  assert.match(validationJs, /copy\.disabled = true/);
  assert.match(validationJs, /copy\.disabled = false/);
  assert.match(validationJs, /email\.disabled = true/);
  assert.match(validationJs, /email\.disabled = false/);
  assert.match(validationJs, /check\.checked = true/);
  assert.match(validationJs, /check\.checked = false/);
});

test("V0.5.6 informe: no existe exportación TXT ni destrucción separada en el pie", () => {
  assert.doesNotMatch(validationJs, /downloadReportTxt|downloadValidatedTxt|Descargar TXT/);
  assert.doesNotMatch(indexHtml, /Descargar TXT/);
  assert.doesNotMatch(indexHtml, /id="destroySession"/);
});

test("V0.5.6 informe: navegar fuera de un informe validado invalida su validación", () => {
  assert.match(validationJs, /function invalidateBeforeLeavingReport/);
  assert.match(validationJs, /setUnvalidated\('Has salido del informe validado/);
});

test("V0.5.6 informe: el envío usa el texto clínico validado y solo el destino institucional", () => {
  assert.match(validationJs, /EMAIL_RECIPIENT/);
  assert.match(validationJs, /joseluis\.matesanz@salud-juntaex\.es/);
  assert.doesNotMatch(validationJs, /gmail\.com/);
  assert.match(validationJs, /getValidatedReportText/);
  assert.match(validationJs, /fetch\('\/api\/send-report'/);
  assert.doesNotMatch(validationJs, /mailto:/);
});

test("V0.5.6 informe: tras envío confirmado destruye; ante fallo conserva la sesión", () => {
  assert.match(validationJs, /async function sendAndDestroy/);
  assert.match(validationJs, /destroyEphemeralSession\(\)/);
  assert.match(validationJs, /La sesión se conserva/);
  assert.match(validationJs, /window\.location\.replace/);
});

test("V0.5.6 informe: el pie validado se reduce a flecha, re-edición, copia y envío-destrucción", () => {
  assert.match(indexHtml, />←<\/button>/);
  assert.match(validationJs, /Re-editar/);
  assert.match(indexHtml, />Copiar<\/button>/);
  assert.match(validationJs, /@ Envío\/Destruir/);
});

test("V0.5.6 informe: el navegador fuerza la carga de la nueva capa de validación", () => {
  assert.match(indexHtml, /report-v056\.js\?v=20260909-3/);
  assert.match(indexHtml, /report-validation-v058\.js\?v=20260909-9/);
  assert.match(packageJson, /node --check api\/send-report\.mjs/);
  assert.match(packageJson, /node --check report-validation-v058\.js/);
});
