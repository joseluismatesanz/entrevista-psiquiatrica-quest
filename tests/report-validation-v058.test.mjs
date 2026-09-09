import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, validationJs, reportCss] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v058.js", import.meta.url), "utf8"),
  readFile(new URL("../report-v056.css", import.meta.url), "utf8"),
]);

test("V0.5.6 validación: se sustituye la casilla visible por un botón explícito", () => {
  assert.match(validationJs, /Validar informe/);
  assert.match(validationJs, /hideLegacyValidationCheckbox/);
  assert.match(validationJs, /checkline/);
  assert.match(validationJs, /classList\.add\('hidden'\)/);
});

test("V0.5.6 validación: validar bloquea la edición y habilita copia y correo", () => {
  assert.match(validationJs, /function validateReport/);
  assert.match(validationJs, /state\.validated = true/);
  assert.match(validationJs, /copy\.disabled = false/);
  assert.match(validationJs, /email\.disabled = false/);
  assert.match(validationJs, /setEditLocked\(true\)/);
  assert.match(validationJs, /Informe validado · edición bloqueada/);
});

test("V0.5.6 pie móvil: usa acciones cortas y elimina por completo la descarga TXT", () => {
  assert.match(indexHtml, /id="backToReview"[^>]*>←<\/button>/);
  assert.match(indexHtml, /id="copyReport"[^>]*>Copiar<\/button>/);
  assert.match(indexHtml, /id="destroySession"[^>]*>DESTRUIR<\/button>/);
  assert.match(validationJs, /reopen\.textContent = 'Re-editar'/);
  assert.match(validationJs, /email\.textContent = 'Enviar @'/);
  assert.doesNotMatch(validationJs, /Descargar TXT|downloadReportTxt|downloadValidatedTxt/);
  assert.match(reportCss, /\.validation-card \.footer-back/);
  assert.match(reportCss, /@media\(max-width:720px\)/);
});

test("V0.5.6 validación: re-editar invalida la validación", () => {
  assert.match(validationJs, /Re-editar/);
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

test("V0.5.6 validación: salir del informe validado invalida la validación antes de navegar", () => {
  assert.match(validationJs, /function invalidateBeforeLeavingReport/);
  assert.match(validationJs, /Has salido del informe validado/);
  assert.match(validationJs, /\[data-go=\"review\"\]/);
  assert.match(validationJs, /\[data-go=\"input\"\]/);
  assert.match(validationJs, /\}, true\);/);
});

test("V0.5.6 correo: usa los dos destinatarios seguidos y separados por punto y coma y espacio", () => {
  assert.match(validationJs, /joseluis\.matesanz@salud-juntaex\.es/);
  assert.match(validationJs, /jlmatesanzperez@gmail\.com/);
  assert.match(validationJs, /EMAIL_RECIPIENTS_DISPLAY = EMAIL_RECIPIENTS\.join\('; '\)/);
  assert.match(validationJs, /function prepareValidatedEmail/);
  assert.match(validationJs, /mailto:\$\{EMAIL_RECIPIENTS_DISPLAY\}/);
  assert.match(validationJs, /Abriendo el cliente de correo: \$\{EMAIL_RECIPIENTS_DISPLAY\}/);
});

test("V0.5.6 validación: index fuerza la carga de esta revisión del script y CSS", () => {
  assert.match(indexHtml, /report-v056\.css\?v=20260909-4/);
  assert.match(indexHtml, /report-validation-v058\.js\?v=20260909-7/);
  assert.doesNotMatch(indexHtml, /report-validation-v057\.js/);
});
