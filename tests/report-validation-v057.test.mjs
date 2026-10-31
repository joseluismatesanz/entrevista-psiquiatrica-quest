import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, validationJs, packageJson] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v058.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

test("informe: validar bloquea edición y desmarcar la reabre", () => {
  assert.match(validationJs, /state = \{ validated: false \}/);
  assert.match(validationJs, /function setEditLocked/);
  assert.match(validationJs, /setEditLocked\(true\)/);
  assert.match(validationJs, /setEditLocked\(false\)/);
  assert.match(validationJs, /if \(event\.target\.checked\) validateReport\(\)/);
});

test("informe: no se envía vacío, sin validar o durante una edición", () => {
  assert.match(validationJs, /if \(!state\.validated \|\| isEditing\(\)\) return ''/);
  assert.match(validationJs, /if \(!text\)/);
  assert.match(validationJs, /El informe debe estar revisado y validado/);
});

test("interfaz: solo mantiene las dos acciones principales solicitadas", () => {
  assert.match(indexHtml, />Info Clínica<\/button>/);
  assert.match(indexHtml, />Envío \/ Borrar<\/button>/);
  assert.doesNotMatch(indexHtml, /id="destroySession"|Descargar TXT|id="backToReview"/);
});

test("comprobaciones: incluye validación, desidentificación y no usa un backend de correo", () => {
  assert.match(indexHtml, /report-validation-v058\.js\?v=20260909-10/);
  assert.match(packageJson, /node --check server\/person-name-redaction\.mjs/);
  assert.match(packageJson, /node --check report-validation-v058\.js/);
  assert.doesNotMatch(packageJson, /node --check api\/send-report\.mjs/);
});
