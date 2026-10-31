import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [index, css, controller, backend] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../recording-focus-v063.css", import.meta.url), "utf8"),
  readFile(new URL("../long-interview-v06.js", import.meta.url), "utf8"),
  readFile(new URL("../backend-client.js", import.meta.url), "utf8"),
]);

test("grabación: cubre toda la pantalla con negro hasta publicar la transcripción", () => {
  assert.match(index, /id="recordingBlackout"/);
  assert.match(css, /\.recording-blackout\s*\{[\s\S]*position:\s*fixed;[\s\S]*inset:\s*0;[\s\S]*background:\s*var\(--recording-black\)/);
  assert.match(css, /--recording-black:\s*#000/);
  assert.match(controller, /setRecordingFocus\('recording'\)/);
  assert.match(controller, /setRecordingFocus\('processing'\)/);
  assert.match(controller, /clearRecordingFocus\(\{ transcriptionReady: true \}\)/);
});

test("después de transcribir: muestra exactamente las dos acciones principales", () => {
  assert.equal((index.match(/class="primary workflow-main-button"/g) || []).length, 2);
  assert.match(index, />Info Clínica<\/button>/);
  assert.match(index, />Envío \/ Borrar<\/button>/);
  assert.match(css, /body\.transcription-actions-only \.app-shell > :not\(#workflowActions\)/);
});

test("entrada manual: pegar una transcripción también revela Info Clínica", () => {
  assert.match(backend, /\$\('caseText'\)\?\.addEventListener\('input'/);
  assert.match(backend, /workflowActions'\)\?\.classList\.remove\('hidden'\)/);
});

test("organización: abre directamente el informe y conserva recuperación ante error", () => {
  assert.match(backend, /renderReview\(payload\);\s*showScreen\('report'\)/);
  assert.match(backend, /clinical-report-ready/);
  assert.match(backend, /catch \(error\)[\s\S]*showScreen\('input'\)[\s\S]*transcription-actions-only/);
});
