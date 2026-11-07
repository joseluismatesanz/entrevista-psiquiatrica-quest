import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [index, css, baseCss, controller, backend] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../recording-focus-v063.css", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
  readFile(new URL("../long-interview-v06.js", import.meta.url), "utf8"),
  readFile(new URL("../backend-client.js", import.meta.url), "utf8"),
]);

test("grabación: cubre toda la pantalla con negro hasta publicar la transcripción", () => {
  assert.match(index, /id="recordingBlackout"/);
  assert.match(css, /\.recording-blackout\s*\{[\s\S]*position:\s*fixed;[\s\S]*inset:\s*0;[\s\S]*background:\s*var\(--recording-black\)/);
  assert.match(css, /--recording-black:\s*#000/);
  assert.match(css, /width:\s*100vw/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /html\.recording-focus-active/);
  assert.match(controller, /document\.documentElement\.classList\.add\('recording-focus-active'\)/);
  assert.match(index, /apple-mobile-web-app-status-bar-style" content="black-translucent"/);
  assert.match(controller, /setRecordingFocus\('recording'\)/);
  assert.match(controller, /setRecordingFocus\('processing'\)/);
  assert.match(controller, /clearRecordingFocus\(\{ transcriptionReady: true \}\)/);
});

test("después de transcribir: muestra solo Envío / Borrar y Organización", () => {
  assert.equal((index.match(/class="primary workflow-main-button"/g) || []).length, 2);
  assert.match(index, /id="workflowActions" class="workflow-actions hidden"/);
  assert.match(index, />Envío \/ Borrar<\/button>/);
  assert.match(index, />Organización<\/button>/);
  assert.match(css, /body\.transcription-actions-only \.app-shell > :not\(#workflowActions\)/);
});

test("acciones: aparecen solo con una transcripción completa y tienen contadores", () => {
  assert.match(index, /id="analyzeCaseTimer" class="workflow-action-timer"/);
  assert.match(index, /id="prepareReportEmailTimer" class="workflow-action-timer"/);
  assert.match(baseCss, /\.workflow-action-block/);
  assert.match(baseCss, /font-variant-numeric:\s*tabular-nums/);
  assert.match(backend, /const transcriptReady = hasTranscript && window\.__LONG_INTERVIEW_INCOMPLETE !== true/);
  assert.match(backend, /workflowActions'\)\?\.classList\.toggle\('hidden', !transcriptReady\)/);
});

test("entrada manual: pegar una transcripción también revela las acciones", () => {
  assert.match(backend, /\$\('caseText'\)\?\.addEventListener\('input', syncWorkflowActions\)/);
  assert.match(backend, /syncWorkflowActions\(\);/);
});

test("Organización abre la revisión y Envío / Borrar conserva el envío directo", () => {
  assert.match(backend, /showScreen\(showOrganization \? 'review' : 'report'\)/);
  assert.match(backend, /runClinicalReportGeneration = \(\) => analyzeWithBackend\(\{ showOrganization: false \}\)/);
  assert.match(backend, /analyzeCase'\)\?\.addEventListener\('click', \(\) => analyzeWithBackend\(\{ showOrganization: true \}\)\)/);
  assert.match(backend, /catch \(error\)[\s\S]*showScreen\('input'\)[\s\S]*transcription-actions-only/);
  assert.match(controller, /«Envío \/ Borrar» para preparar directamente el correo o «Organización»/);
});
