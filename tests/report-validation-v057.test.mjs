import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, validationJs, packageJson] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v058.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

test("V0.5.6 informe: la validación tiene una consecuencia real sobre la edición", () => {
  assert.match(validationJs, /validated: false/);
  assert.match(validationJs, /function setEditLocked/);
  assert.match(validationJs, /setEditLocked\(true\)/);
  assert.match(validationJs, /setEditLocked\(false\)/);
});

test("V0.5.6 informe: no puede validarse mientras una sección está abierta", () => {
  assert.match(validationJs, /function isEditing/);
  assert.match(validationJs, /report-section-editing/);
  assert.match(validationJs, /validate\.disabled = isEditing\(\) \|\| state\.validated/);
});

test("PSQ informe: copiar queda bloqueado hasta validar y finalizar hasta copiar", () => {
  assert.match(validationJs, /copy\.disabled = true/);
  assert.match(validationJs, /copy\.disabled = false/);
  assert.match(validationJs, /finalize\.disabled = !state\.validated \|\| !state\.copied/);
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

test("PSQ informe: la copia usa solo el texto clínico validado y no contiene destinatarios", () => {
  assert.match(validationJs, /getValidatedReportText/);
  assert.match(validationJs, /navigator\.clipboard\.writeText\(text\)/);
  assert.doesNotMatch(validationJs, /mailto:|EMAIL_RECIPIENT|@salud-juntaex\.es|gmail\.com|\/api\/send-report/);
});

test("PSQ informe: el cierre requiere una segunda pulsación y limpia la sesión local", () => {
  assert.match(validationJs, /function requestSessionFinalization/);
  assert.match(validationJs, /state\.pendingDestroy = true/);
  assert.match(validationJs, /Confirmar borrado/);
  assert.match(validationJs, /destroyEphemeralSession\(\)/);
  assert.match(validationJs, /window\.location\.replace/);
});

test("PSQ informe: el pie validado se reduce a flecha, re-edición, copia y cierre", () => {
  assert.match(indexHtml, />←<\/button>/);
  assert.match(validationJs, /Re-editar/);
  assert.match(indexHtml, />Copiar<\/button>/);
  assert.match(validationJs, /Finalizar y borrar/);
});

test("V0.5.6 informe: el navegador fuerza la carga de la nueva capa de validación y chequea desidentificación", () => {
  assert.match(indexHtml, /report-v056\.js\?v=20260909-3/);
  assert.match(indexHtml, /report-validation-v058\.js\?v=20260928-1/);
  assert.match(packageJson, /node --check server\/person-name-redaction\.mjs/);
  assert.doesNotMatch(packageJson, /node --check api\/send-report\.mjs/);
  assert.match(packageJson, /node --check report-validation-v058\.js/);
});
