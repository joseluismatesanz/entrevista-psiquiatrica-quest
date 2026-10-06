import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [client, gate, loader, index] = await Promise.all([
  readFile(new URL('../backend-client.js', import.meta.url), 'utf8'),
  readFile(new URL('../long-interview-prefetch-gate-v061.js', import.meta.url), 'utf8'),
  readFile(new URL('../loader.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
]);

test('organización: la petición tiene límite y siempre recupera el botón', () => {
  assert.match(client, /ANALYSIS_TIMEOUT_MS\s*=\s*225_000/);
  assert.match(client, /ClinicalRequest\.fetchWithDeadline/);
  assert.match(client, /label:\s*'La organización clínica'/);
  assert.match(client, /finally\s*\{[\s\S]*button\.disabled\s*=\s*false/);
  assert.match(client, /clearInterval\(progressTimer\)/);
});

test('organización larga: espera evidencia compactada y no conserva un preanálisis infinito', () => {
  assert.match(gate, /MAX_EVIDENCE_WAIT_MS\s*=\s*45_000/);
  assert.match(gate, /ANALYSIS_PREFETCH_TIMEOUT_MS\s*=\s*210_000/);
  assert.match(gate, /controller\.abort/);
  assert.match(gate, /signal:\s*controller\.signal/);
  assert.match(gate, /waitForSnapshot\(pending, init\?\.signal\)/);
});

test('navegador: fuerza la carga de la recuperación de análisis', () => {
  assert.match(loader, /backend-client\.js\?v=20261006-analysis-recovery-1/);
  assert.match(index, /loader\.js\?v=20261006-analysis-recovery-1/);
  assert.match(index, /long-interview-prefetch-gate-v061\.js\?v=20261006-analysis-recovery-1/);
});
