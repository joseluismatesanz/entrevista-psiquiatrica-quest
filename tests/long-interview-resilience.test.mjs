import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [controller, index, loader, shortFlow] = await Promise.all([
  readFile(new URL('../long-interview-v06.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../loader.js', import.meta.url), 'utf8'),
  readFile(new URL('../backend-client.js', import.meta.url), 'utf8'),
]);

test('entrevista larga: una cola lenta no ordena detener el micrófono', () => {
  assert.match(controller, /MAX_BUFFERED_BLOCKS\s*=\s*128/);
  assert.match(controller, /MAX_CONCURRENT_BLOCKS\s*=\s*3/);
  assert.match(controller, /failedBlocks:\s*new Map\(\)/);
  assert.match(controller, /rememberBlockFailure\(task\.blob, task\.index, error\)/);
  assert.doesNotMatch(controller, /function markBlockFailure[\s\S]*?finishLongRecording\(\)/);
});

test('entrevista larga: recupera bloques fallidos antes de publicar el agregado', () => {
  assert.match(controller, /retryFailedBlocksAtClose/);
  assert.match(controller, /FINAL_RETRY_ATTEMPTS\s*=\s*2/);
  assert.match(controller, /await retryFailedBlocksAtClose\(\)/);
  assert.match(controller, /if \(state\.failedBlocks\.size\)/);
  assert.match(controller, /No se pudieron verificar todos los bloques/);
  assert.match(controller, /const missingIndexes = expectedIndexes\.filter/);
  assert.match(controller, /Faltan bloques de audio antes de publicar la transcripción/);
});

test('entrevista larga: la evidencia secundaria no compite con una cola de audio activa', () => {
  assert.match(controller, /MAX_CONCURRENT_EVIDENCE_BLOCKS\s*=\s*1/);
  assert.match(controller, /state\.pendingBlocks === 0/);
  assert.match(controller, /state\.inFlightBlocks === 0/);
  assert.match(controller, /pumpEvidenceQueue/);
});

test('entrevista larga: el cambio de bloque móvil tiene recuperación y límite', () => {
  assert.match(controller, /RECORDER_STOP_TIMEOUT_MS\s*=\s*6_000/);
  assert.match(controller, /state\.recorder !== recorder/);
  assert.match(controller, /if \(state\.active && !state\.finishing\) startBlockRecorder\(\)/);
  assert.match(controller, /requestData\?\.\(\)/);
});

test('transcripción: las peticiones y el cierre tienen límites explícitos', () => {
  assert.match(controller, /BLOCK_REQUEST_TIMEOUT_MS\s*=\s*150_000/);
  assert.match(controller, /FINALIZATION_TIMEOUT_MS\s*=\s*300_000/);
  assert.match(controller, /ClinicalRequest\.fetchWithDeadline/);
  assert.match(controller, /ClinicalRequest\.waitWithDeadline/);
  assert.match(shortFlow, /TRANSCRIPTION_TIMEOUT_MS\s*=\s*150_000/);
});

test('navegador: carga la protección antes de los controladores y evita caché antigua', () => {
  const timeoutLayer = index.indexOf('client-request-timeout.js?v=20261004-recording-1');
  const loaderPosition = index.indexOf('loader.js?v=20261004-recording-1');
  const longPosition = index.indexOf('long-interview-v06.js?v=20261006-wake-lock-1');
  assert.ok(timeoutLayer >= 0 && loaderPosition > timeoutLayer && longPosition > loaderPosition);
  assert.match(loader, /backend-client\.js\?v=20261004-recording-1/);
});
