import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [index, css, controller, backend] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../recording-focus-v063.css", import.meta.url), "utf8"),
  readFile(new URL("../long-interview-v06.js", import.meta.url), "utf8"),
  readFile(new URL("../backend-client.js", import.meta.url), "utf8"),
]);

test("grabación: la capa negra cubre toda la pantalla hasta terminar la transcripción", () => {
  assert.match(index, /id="recordingBlackout"/);
  assert.match(css, /\.recording-blackout\s*\{[\s\S]*position:\s*fixed;[\s\S]*inset:\s*0;[\s\S]*background:\s*var\(--recording-black\)/);
  assert.match(css, /--recording-black:\s*#000/);
  assert.match(controller, /setRecordingFocus\('recording'\)/);
  assert.match(controller, /setRecordingFocus\('processing'\)/);
  assert.match(controller, /clearRecordingFocus\(\{ transcriptionReady: true \}\)/);
});

test("tras la transcripción solo presenta Informe y Organización", () => {
  assert.equal((index.match(/class="primary workflow-main-button"/g) || []).length, 2);
  assert.match(index, />Informe<\/button>/);
  assert.match(index, />Organización<\/button>/);
  assert.match(css, /body\.transcription-actions-only \.app-shell > :not\(#workflowActions\)/);
});

test("Informe abre el informe y Organización abre la revisión", () => {
  assert.match(backend, /analyzeWithBackend\('report'\)/);
  assert.match(backend, /analyzeWithBackend\('review'\)/);
  assert.match(backend, /showScreen\(destination === 'review' \? 'review' : 'report'\)/);
});
