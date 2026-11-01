import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, sendJs] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v058.js", import.meta.url), "utf8"),
]);

test("correo: conserva el destino institucional y el mecanismo mailto habitual", () => {
  assert.match(sendJs, /EMAIL_RECIPIENT = 'joseluis\.matesanz@salud-juntaex\.es'/);
  assert.match(sendJs, /mailto:\$\{EMAIL_RECIPIENT\}/);
  assert.match(sendJs, /link\.click\(\);[\s\S]*destroyEphemeralSession\(\)/);
  assert.doesNotMatch(sendJs, /gmail\.com|\/api\/send-report|RESEND_API_KEY/);
});

test("correo: borra el estado efímero tras entregar el contenido al sistema", () => {
  assert.match(sendJs, /function destroyEphemeralSession/);
  assert.match(sendJs, /reportEditor\(\)\?\.replaceChildren\(\)/);
  assert.match(sendJs, /field\.value = ''/);
  assert.match(sendJs, /window\.location\.replace/);
});

test("correo: está visible desde el inicio y genera el informe antes de enviarlo", () => {
  assert.match(indexHtml, /id="prepareReportEmail"[^>]*>Envío \/ Borrar<\/button>/);
  assert.match(sendJs, /button\.disabled = false/);
  assert.match(sendJs, /async function generateSendAndDestroy/);
  assert.match(sendJs, /if \(!reportText\(\)\)/);
  assert.match(sendJs, /openReportEmailAndDestroy\(\)/);
});

test("correo: muestra el tiempo total y llama directamente al generador compartido", () => {
  assert.match(indexHtml, /id="prepareReportEmailTimer"/);
  assert.match(sendJs, /Generando informe y preparando correo/);
  assert.match(sendJs, /setInterval\(\(\) => updateSendTimer\(\), 1_000\)/);
  assert.match(sendJs, /window\.runClinicalReportGeneration\(\)/);
  assert.match(sendJs, /Proceso interrumpido/);
});

test("privacidad: la portada no expone documentación técnica ni casos de prueba", () => {
  assert.match(indexHtml, /La información se desidentifica antes de generar el informe/);
  assert.doesNotMatch(indexHtml, /Microsoft Presidio|loadDemo|loadCase1|loadCase2|loadCase3/);
});
