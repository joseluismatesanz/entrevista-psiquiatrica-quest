import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, manifestText, pwa, worker, vercel, icon192, icon512, appleIcon] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'),
  readFile(new URL('../pwa.js', import.meta.url), 'utf8'),
  readFile(new URL('../service-worker.js', import.meta.url), 'utf8'),
  readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
  readFile(new URL('../icons/app-icon-192.png', import.meta.url)),
  readFile(new URL('../icons/app-icon-512.png', import.meta.url)),
  readFile(new URL('../icons/apple-touch-icon.png', import.meta.url)),
]);

const manifest = JSON.parse(manifestText);

test('PWA: la portada declara instalación móvil y modo aplicación', () => {
  assert.match(index, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(index, /rel="apple-touch-icon"/);
  assert.match(index, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(index, /src="pwa\.js\?v=/);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose.includes('maskable')));
  for (const icon of [icon192, icon512, appleIcon]) {
    assert.equal(icon.subarray(1, 4).toString(), 'PNG');
  }
});

test('PWA: registra el service worker sin persistir entrevistas ni llamadas clínicas', () => {
  assert.match(pwa, /serviceWorker\.register\('\/service-worker\.js'/);
  assert.match(worker, /request\.method !== 'GET'/);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.doesNotMatch(worker, /localStorage|sessionStorage|indexedDB|caseText|transcript/i);
});

test('PWA: Vercel evita servir un service worker obsoleto', () => {
  const config = JSON.parse(vercel);
  const serviceWorkerHeaders = config.headers.find((entry) => entry.source === '/service-worker.js');
  assert.ok(serviceWorkerHeaders);
  assert.ok(serviceWorkerHeaders.headers.some((header) => header.key === 'Cache-Control' && /no-cache/.test(header.value)));
});
