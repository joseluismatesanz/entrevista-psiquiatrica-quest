import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [gate, index] = await Promise.all([
  readFile(new URL("../long-interview-prefetch-gate-v061.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
]);

test("V0.6: preanálisis largo espera brevemente a evidencia completa antes de salir", () => {
  assert.match(gate, /MAX_EVIDENCE_WAIT_MS\s*=\s*5000/);
  assert.match(gate, /__LONG_INTERVIEW_VERIFIED_BLOCKS/);
  assert.match(gate, /__LONG_INTERVIEW_EVIDENCE/);
  assert.match(gate, /evidence\.length === blocks\.length/);
  assert.match(gate, /verified_blocks:\s*blocks/);
  assert.match(gate, /verified_evidence:\s*evidence/);
});

test("V0.6: si la evidencia no completa en el margen conserva el fallback", () => {
  assert.match(gate, /if \(!evidence\)[\s\S]*return inheritedFetch\(input, init\)/);
});

test("V0.6: la compuerta se carga después del controlador de bloques y antes del contexto", () => {
  const controller = index.indexOf('long-interview-v06.js');
  const gatePosition = index.indexOf('long-interview-prefetch-gate-v061.js');
  const context = index.indexOf('long-interview-context-v06.js');
  assert.ok(controller >= 0 && gatePosition > controller && context > gatePosition);
});
