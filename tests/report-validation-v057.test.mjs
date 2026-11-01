import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, sendJs, packageJson] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v058.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

test("envío: valida automáticamente sin solicitar confirmación adicional", () => {
  assert.doesNotMatch(indexHtml, /He revisado el contenido y asumo la validación clínica/);
  assert.doesNotMatch(sendJs, /validateReport|state\.validated|isEditing|confirm\(/);
  assert.match(sendJs, /function markAutomaticallyValidated/);
  assert.match(sendJs, /Informe validado automáticamente/);
});

test("envío: si falta el informe ejecuta primero la gestión clínica", () => {
  assert.match(sendJs, /if \(!window\.__CLINICAL_REPORT_AVAILABLE\) return ''/);
  assert.match(sendJs, /const transcript = transcriptField\(\)\?\.value\.trim\(\)/);
  assert.match(sendJs, /await waitForAutomaticReport\(\)/);
  assert.match(sendJs, /analyzeButton\.click\(\)/);
  assert.match(sendJs, /clinical-report-ready/);
  assert.match(sendJs, /clinical-report-error/);
});

test("interfaz: las dos acciones principales están presentes desde la primera pantalla", () => {
  assert.match(indexHtml, /id="workflowActions" class="workflow-actions"/);
  assert.match(indexHtml, />Info Clínica<\/button>/);
  assert.match(indexHtml, />Envío \/ Borrar<\/button>/);
});

test("comprobaciones: mantiene desidentificación y chequeo del envío directo", () => {
  assert.match(indexHtml, /report-validation-v058\.js\?v=20261031-auto-report-send-2/);
  assert.match(packageJson, /node --check server\/person-name-redaction\.mjs/);
  assert.match(packageJson, /node --check report-validation-v058\.js/);
  assert.doesNotMatch(packageJson, /node --check api\/send-report\.mjs/);
});
