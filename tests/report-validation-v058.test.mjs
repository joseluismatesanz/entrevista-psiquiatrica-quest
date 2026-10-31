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

test("correo: se habilita en cuanto existe transcripción o informe", () => {
  assert.match(sendJs, /button\.disabled = !availableText\(\)\.text/);
  assert.match(sendJs, /clinical-transcription-ready/);
  assert.match(sendJs, /clinical-report-ready/);
  assert.match(sendJs, /transcriptField\(\)\?\.addEventListener\('input', syncSendAction\)/);
});

test("privacidad: la portada no expone documentación técnica ni casos de prueba", () => {
  assert.match(indexHtml, /La información se desidentifica antes de generar el informe/);
  assert.doesNotMatch(indexHtml, /Microsoft Presidio|loadDemo|loadCase1|loadCase2|loadCase3/);
});
