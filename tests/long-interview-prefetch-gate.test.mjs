import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [gate, index] = await Promise.all([
  readFile(new URL("../long-interview-prefetch-gate-v061.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
]);

test("V0.6: preanálisis largo espera evidencia completa y siempre conserva proofs de bloques", () => {
  assert.match(gate, /MAX_EVIDENCE_WAIT_MS\s*=\s*12000/);
  assert.match(gate, /__LONG_INTERVIEW_VERIFIED_BLOCKS/);
  assert.match(gate, /__LONG_INTERVIEW_EVIDENCE/);
  assert.match(gate, /evidence\.length === blocks\.length/);
  assert.match(gate, /verified_blocks:\s*blocks/);
  assert.match(gate, /verified_evidence:\s*evidence/);
});

test("V0.6: bloquea el prefetch antiguo y elimina snapshots sin proofs antes de analizar", () => {
  assert.match(gate, /Superseded by verified long-interview prefetch/);
  assert.match(gate, /legacyCache\?\.delete\(transcript\)/);
  assert.match(gate, /clinical-long-attribution-ready/);
  assert.match(gate, /verifiedPrefetches/);
});

test("V0.6: la compuerta se carga después del controlador de bloques y usa revisión fresca", () => {
  const controller = index.indexOf('long-interview-v06.js');
  const gatePosition = index.indexOf('long-interview-prefetch-gate-v061.js');
  const context = index.indexOf('long-interview-context-v06.js');
  assert.ok(controller >= 0 && gatePosition > controller && context > gatePosition);
  assert.match(index, /long-interview-prefetch-gate-v061\.js\?v=20260912-2/);
});
