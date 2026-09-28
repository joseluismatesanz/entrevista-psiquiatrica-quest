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

test("PSQ validación: validar bloquea la edición y habilita la copia", () => {
  assert.match(validationJs, /function validateReport/);
  assert.match(validationJs, /state\.validated = true/);
  assert.match(validationJs, /copy\.disabled = false/);
  assert.match(validationJs, /copy\.disabled = false/);
  assert.match(validationJs, /finalize\.disabled = !state\.validated \|\| !state\.copied/);
  assert.match(validationJs, /setEditLocked\(true\)/);
  assert.match(validationJs, /Informe validado · edición bloqueada/);
});

test("PSQ pie móvil: queda reducido a flecha, re-edición, copia y cierre seguro", () => {
  assert.match(indexHtml, /id="backToReview"[^>]*>←<\/button>/);
  assert.match(indexHtml, /id="copyReport"[^>]*>Copiar<\/button>/);
  assert.doesNotMatch(indexHtml, /id="destroySession"/);
  assert.match(validationJs, /reopen\.textContent = 'Re-editar'/);
  assert.match(validationJs, /finalize\.textContent = 'Finalizar y borrar'/);
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

test("PSQ exportación: no incrusta destinos ni envía el informe desde la aplicación", () => {
  assert.doesNotMatch(validationJs, /EMAIL_RECIPIENT|mailto:|link\.click\(\)/);
  assert.match(validationJs, /function copyValidatedReport/);
  assert.match(validationJs, /navigator\.clipboard\.writeText\(text\)/);
  assert.doesNotMatch(validationJs, /\/api\/send-report|RESEND_API_KEY|@salud-juntaex\.es|gmail\.com/);
});

test("PSQ cierre: exige copia y doble confirmación antes de destruir el estado clínico local", () => {
  assert.match(validationJs, /function destroyEphemeralSession/);
  assert.match(validationJs, /editor\(\)\?\.replaceChildren\(\)/);
  assert.match(validationJs, /field\.value = ''/);
  assert.match(validationJs, /!state\.validated \|\| !state\.copied/);
  assert.match(validationJs, /Confirmar borrado/);
  assert.match(validationJs, /requestSessionFinalization[\s\S]*destroyEphemeralSession\(\)/);
  assert.match(validationJs, /window\.location\.replace/);
});

test("privacidad: la portada informa del resultado sin exponer documentación técnica", () => {
  assert.match(indexHtml, /El texto se desidentifica antes del análisis clínico/);
  assert.doesNotMatch(indexHtml, /Microsoft Presidio|nombres verificados adicionalmente/);
  assert.doesNotMatch(indexHtml, /loadDemo|loadCase1|loadCase2|loadCase3|fixture-loader|fixture-case3/);
  assert.doesNotMatch(indexHtml, /Ejemplo breve|Caso 1 completo|Caso 2 completo|Caso 3 · 3 fuentes/);
});

test("V0.5.6 validación: index fuerza la carga de esta revisión del script y CSS", () => {
  assert.match(indexHtml, /report-v056\.css\?v=20260909-4/);
  assert.match(indexHtml, /report-validation-v058\.js\?v=20260928-1/);
  assert.doesNotMatch(indexHtml, /report-validation-v057\.js/);
});
