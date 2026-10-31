import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [client, gate, loader, index, api, server, fastParallel] = await Promise.all([
  readFile(new URL('../backend-client.js', import.meta.url), 'utf8'),
  readFile(new URL('../long-interview-prefetch-gate-v061.js', import.meta.url), 'utf8'),
  readFile(new URL('../loader.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../api/analyze.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../server/analyze.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../server/fast-parallel-analysis.mjs', import.meta.url), 'utf8'),
]);

test('organización: la petición tiene límite y siempre recupera el botón', () => {
  assert.match(client, /ANALYSIS_TIMEOUT_MS\s*=\s*225_000/);
  assert.match(client, /ClinicalRequest\.fetchWithDeadline/);
  assert.match(client, /label:\s*'La organización clínica'/);
  assert.match(client, /finally\s*\{[\s\S]*button\.disabled\s*=\s*Boolean\(state\.result\)/);
  assert.match(client, /clearInterval\(progressTimer\)/);
});

test('organización larga: espera evidencia compactada y no conserva un preanálisis infinito', () => {
  assert.match(gate, /MAX_EVIDENCE_WAIT_MS\s*=\s*5_000/);
  assert.match(gate, /ANALYSIS_PREFETCH_TIMEOUT_MS\s*=\s*210_000/);
  assert.match(gate, /controller\.abort/);
  assert.match(gate, /signal:\s*controller\.signal/);
  assert.match(gate, /waitForPrefetchGrace\(pending, init\?\.signal\)/);
  assert.match(gate, /PREFETCH_REUSE_GRACE_MS\s*=\s*1_500/);
});

test('organización larga: la ruta compleja es única y las llamadas del modelo tienen límite propio', () => {
  assert.match(api, /verified_single_full/);
  assert.doesNotMatch(api, /parallelMode:\s*true/);
  assert.match(api, /clinical_analysis_mode:\s*analysisMode/);
  assert.match(server, /clinicalModelRequestOptions/);
  assert.match(fastParallel, /clinicalModelRequestOptions\(\{ parallel: true \}\)/);
});

test('navegador: fuerza la carga de la recuperación de análisis', () => {
  assert.match(loader, /backend-client\.js\?v=20261006-analysis-recovery-1/);
  assert.match(index, /loader\.js\?v=20261006-analysis-recovery-1/);
  assert.match(index, /long-interview-prefetch-gate-v061\.js\?v=20261031-foreground-recovery-1/);
});
