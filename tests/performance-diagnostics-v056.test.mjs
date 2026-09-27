import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = await readFile(new URL("../config.js", import.meta.url), "utf8");

test("portada final: no muestra diagnósticos ni detalles internos de rendimiento", () => {
  assert.doesNotMatch(config, /Diagnóstico de velocidad|performanceDiagnostics/);
  assert.doesNotMatch(config, /localStorage|sessionStorage|indexedDB/);
});

test("rendimiento: el prefetch sigue reutilizando solo la misma transcripción", () => {
  assert.match(config, /prefetched = new Map\(\)/);
  assert.match(config, /prefetched\.get\(transcript\)/);
  assert.match(config, /prefetched\.delete\(transcript\)/);
});
