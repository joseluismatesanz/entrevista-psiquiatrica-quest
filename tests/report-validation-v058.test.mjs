import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, validationJs] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v058.js", import.meta.url), "utf8"),
]);

test("informe: la revisión profesional habilita la única acción de envío", () => {
  assert.match(indexHtml, /id="validateCheck"/);
  assert.match(indexHtml, /id="prepareReportEmail"[^>]*disabled>Envío \/ Borrar<\/button>/);
  assert.match(validationJs, /function validateReport/);
  assert.match(validationJs, /state\.validated = true/);
  assert.match(validationJs, /emailButton\(\)\.disabled = false/);
  assert.match(validationJs, /setEditLocked\(true\)/);
});

test("informe: cualquier reapertura invalida el permiso de envío", () => {
  assert.match(validationJs, /function setUnvalidated/);
  assert.match(validationJs, /email\.disabled = true/);
  assert.match(validationJs, /setEditLocked\(false\)/);
  assert.match(validationJs, /report-section-save, \.report-section-cancel/);
});

test("correo: conserva el destino institucional, abre mailto y destruye la sesión", () => {
  assert.match(validationJs, /EMAIL_RECIPIENT = 'joseluis\.matesanz@salud-juntaex\.es'/);
  assert.doesNotMatch(validationJs, /gmail\.com|\/api\/send-report|RESEND_API_KEY/);
  assert.match(validationJs, /function sendAndDestroy/);
  assert.match(validationJs, /mailto:\$\{EMAIL_RECIPIENT\}/);
  assert.match(validationJs, /link\.click\(\);[\s\S]*destroyEphemeralSession\(\)/);
  assert.match(validationJs, /editor\(\)\?\.replaceChildren\(\)/);
  assert.match(validationJs, /window\.location\.replace/);
});

test("privacidad: la portada no expone documentación técnica ni casos de prueba", () => {
  assert.match(indexHtml, /La información se desidentifica antes de generar el informe/);
  assert.doesNotMatch(indexHtml, /Microsoft Presidio|loadDemo|loadCase1|loadCase2|loadCase3/);
});

test("navegador: fuerza la capa vigente de validación", () => {
  assert.match(indexHtml, /report-validation-v058\.js\?v=20260909-10/);
  assert.doesNotMatch(indexHtml, /report-validation-v057\.js/);
});
