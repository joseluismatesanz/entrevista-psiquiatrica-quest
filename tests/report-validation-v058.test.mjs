import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, validationJs] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v058.js", import.meta.url), "utf8"),
]);

test("V0.5.6 validación: se sustituye la casilla visible por un botón explícito", () => {
  assert.match(validationJs, /Validar informe/);
  assert.match(validationJs, /hideLegacyValidationCheckbox/);
  assert.match(validationJs, /checkline/);
  assert.match(validationJs, /classList\.add\('hidden'\)/);
});

test("V0.5.6 validación: validar bloquea la edición y habilita copia, descarga y correo", () => {
  assert.match(validationJs, /function validateReport/);
  assert.match(validationJs, /state\.validated = true/);
  assert.match(validationJs, /copy\.disabled = false/);
  assert.match(validationJs, /download\.disabled = false/);
  assert.match(validationJs, /email\.disabled = false/);
  assert.match(validationJs, /setEditLocked\(true\)/);
  assert.match(validationJs, /Informe validado · edición bloqueada/);
});

test("V0.5.6 validación: reabrir edición invalida la validación", () => {
  assert.match(validationJs, /Reabrir edición/);
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

test("V0.5.6 exportación: TXT solo se genera desde un informe validado y de forma local", () => {
  assert.match(validationJs, /Descargar TXT/);
  assert.match(validationJs, /function getValidatedReportText/);
  assert.match(validationJs, /function downloadValidatedTxt/);
  assert.match(validationJs, /new Blob/);
  assert.match(validationJs, /URL\.createObjectURL/);
  assert.match(validationJs, /informe_clinico_validado\.txt/);
  assert.match(validationJs, /La aplicación no conserva una copia del archivo/);
});

test("V0.5.6 correo: prepara un mensaje solo desde informe validado a los dos destinatarios configurados", () => {
  assert.match(validationJs, /Preparar correo/);
  assert.match(validationJs, /joseluis\.matesanz@salud-juntaex\.es/);
  assert.match(validationJs, /jlmatesanzperez@gmail\.com/);
  assert.match(validationJs, /function prepareValidatedEmail/);
  assert.match(validationJs, /mailto:/);
  assert.match(validationJs, /encodeURIComponent\(subject\)/);
  assert.match(validationJs, /encodeURIComponent\(body\)/);
  assert.match(validationJs, /La aplicación no envía el mensaje por sí sola/);
});

test("V0.5.6 validación: index fuerza la carga de esta revisión del script", () => {
  assert.match(indexHtml, /report-validation-v058\.js\?v=20260909-6/);
  assert.doesNotMatch(indexHtml, /report-validation-v057\.js/);
});
