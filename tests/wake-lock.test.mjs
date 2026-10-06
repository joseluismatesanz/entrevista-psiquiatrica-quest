import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [controller, index, vercel] = await Promise.all([
  readFile(new URL("../long-interview-v06.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../vercel.json", import.meta.url), "utf8"),
]);

test("Wake Lock: mantiene la pantalla activa durante la grabación sin ser requisito", () => {
  assert.match(controller, /navigator\.wakeLock\?\.request/);
  assert.match(controller, /navigator\.wakeLock\.request\('screen'\)/);
  assert.match(controller, /startBlockRecorder\(\);\s*void requestWakeLock\(\);/);
  assert.match(controller, /Wake Lock es una mejora progresiva/);
  assert.match(controller, /catch \{[\s\S]*return false;[\s\S]*\}/);
});

test("Wake Lock: se libera al finalizar y se recupera al volver a primer plano", () => {
  assert.match(controller, /finally \{\s*await releaseWakeLock\(\);/);
  assert.match(controller, /void releaseWakeLock\(\);/);
  assert.match(controller, /document\.addEventListener\('visibilitychange'/);
  assert.match(controller, /document\.visibilityState === 'visible'/);
  assert.match(controller, /void requestWakeLock\(\);/);
});

test("Wake Lock: la política y la caché del navegador cargan la función nueva", () => {
  assert.match(vercel, /screen-wake-lock=\(self\)/);
  assert.match(index, /long-interview-v06\.js\?v=20261006-wake-lock-1/);
});
