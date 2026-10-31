import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("V0.6: muestra el tiempo real de cierre después de pulsar Finalizar", async () => {
  const bridge = await readFile(new URL("../long-interview-context-v06.js", import.meta.url), "utf8");
  assert.match(bridge, /Cerrando entrevista/);
  assert.match(bridge, /performance\.now\(\)/);
  assert.match(bridge, /Cierre tras Finalizar:/);
  assert.match(bridge, /clinical-long-attribution-ready/);
});
