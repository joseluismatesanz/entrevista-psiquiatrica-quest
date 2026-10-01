import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadClientRequest() {
  const source = await readFile(new URL('../client-request-timeout.js', import.meta.url), 'utf8');
  const window = { fetch: globalThis.fetch };
  const context = vm.createContext({
    window,
    AbortController,
    DOMException,
    Error,
    Object,
    Promise,
    Number,
    Math,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(source, context);
  return window.ClinicalRequest;
}

test('transporte: una petición que nunca responde se cancela y devuelve un error controlado', async () => {
  const request = await loadClientRequest();
  let aborted = false;
  const hangingFetch = (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      aborted = true;
      reject(init.signal.reason || new DOMException('Abortada', 'AbortError'));
    }, { once: true });
  });

  await assert.rejects(
    request.fetchWithDeadline('/api/transcribe', {}, {
      fetchImpl: hangingFetch,
      timeoutMs: 20,
      label: 'La transcripción de prueba',
    }),
    (error) => error?.code === 'request_timeout' && /no respondió/i.test(error.message),
  );
  assert.equal(aborted, true);
});

test('transporte: el límite global impide que el cierre espere indefinidamente', async () => {
  const request = await loadClientRequest();
  await assert.rejects(
    request.waitWithDeadline(new Promise(() => {}), {
      timeoutMs: 20,
      label: 'El cierre de prueba',
    }),
    (error) => error?.code === 'request_timeout' && /cierre de prueba/i.test(error.message),
  );
});

test('transporte: una respuesta normal atraviesa la protección sin alterarse', async () => {
  const request = await loadClientRequest();
  const expected = { ok: true, status: 200 };
  const result = await request.fetchWithDeadline('/api/transcribe', {}, {
    fetchImpl: async () => expected,
    timeoutMs: 100,
  });
  assert.equal(result, expected);
});

