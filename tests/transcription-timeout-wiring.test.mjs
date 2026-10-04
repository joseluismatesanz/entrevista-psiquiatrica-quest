import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, loader, shortFlow, longFlow, packageJson] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../loader.js', import.meta.url), 'utf8'),
  readFile(new URL('../backend-client.js', import.meta.url), 'utf8'),
  readFile(new URL('../long-interview-v06.js', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
]);

test('grabación: la protección se carga antes de los controladores y evita caché antigua', () => {
  const timeoutLayer = index.indexOf('client-request-timeout.js?v=20261004-recording-1');
  const loaderPosition = index.indexOf('loader.js?v=20261004-recording-1');
  const longPosition = index.indexOf('long-interview-v06.js?v=20261004-recording-1');
  assert.ok(timeoutLayer >= 0 && loaderPosition > timeoutLayer && longPosition > loaderPosition);
  assert.match(loader, /backend-client\.js\?v=20261004-recording-1/);
  assert.match(packageJson, /node --check client-request-timeout\.js/);
});

test('grabación corta: la transcripción tiene límite y siempre recupera el botón', () => {
  assert.match(shortFlow, /TRANSCRIPTION_TIMEOUT_MS\s*=\s*150_000/);
  assert.match(shortFlow, /ClinicalRequest\.fetchWithDeadline/);
  assert.match(shortFlow, /label:\s*'La transcripción'/);
  assert.match(shortFlow, /finally\s*\{[\s\S]*setRecordButton\('idle'\)/);
});

test('grabación larga: cada bloque y el cierre completo tienen límites explícitos', () => {
  assert.match(longFlow, /BLOCK_REQUEST_TIMEOUT_MS\s*=\s*150_000/);
  assert.match(longFlow, /FINALIZATION_TIMEOUT_MS\s*=\s*300_000/);
  assert.match(longFlow, /ClinicalRequest\.fetchWithDeadline/);
  assert.match(longFlow, /ClinicalRequest\.waitWithDeadline/);
  assert.match(longFlow, /sessionAbortController\?\.abort/);
  assert.match(longFlow, /if \(blob\) enqueueBlock/);
  assert.match(longFlow, /retryFailedBlocksAtClose/);
  assert.match(longFlow, /isRetriableStatus/);
  assert.match(longFlow, /attempt >= maxAttempts/);
  assert.match(longFlow, /finally\s*\{[\s\S]*setButton\('idle'\)/);
});
