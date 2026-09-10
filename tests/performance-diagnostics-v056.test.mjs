import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = await readFile(new URL("../config.js", import.meta.url), "utf8");

test("rendimiento: el preview muestra tiempos efímeros de audio y organización", () => {
  assert.match(config, /Diagnóstico de velocidad/);
  assert.match(config, /privacy_and_speaker_attribution/);
  assert.match(config, /structured_clinical_model/);
  assert.match(config, /medication_verification/);
  assert.match(config, /adaptive_fast_route/);
});

test("rendimiento: el diagnóstico mide el navegador y no persiste contenido clínico", () => {
  assert.match(config, /performance\.now\(\)/);
  assert.match(config, /window\.addEventListener\('pagehide'/);
  assert.doesNotMatch(config, /localStorage|sessionStorage|indexedDB/);
});

test("rendimiento: el prefetch sigue reutilizando solo la misma transcripción", () => {
  assert.match(config, /prefetched = new Map\(\)/);
  assert.match(config, /prefetched\.get\(transcript\)/);
  assert.match(config, /prefetched\.delete\(transcript\)/);
});
