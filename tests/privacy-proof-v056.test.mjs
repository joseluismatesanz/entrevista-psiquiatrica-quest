import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPrivacyProof, verifyPrivacyProof } from "../server/privacy-proof.mjs";

const env = { PRIVACY_PROOF_SECRET: "test-only-secret" };
const now = 1_800_000_000_000;

test("privacidad: la prueba firmada solo valida la transcripción exacta", () => {
  const transcript = "PACIENTE: Me llamo XXXXXXXXXXX y duermo mal.";
  const token = createPrivacyProof(transcript, { env, now });
  assert.ok(token.startsWith("v1."));
  assert.equal(verifyPrivacyProof(transcript, token, { env, now: now + 1_000 }), true);
  assert.equal(verifyPrivacyProof(`${transcript} Hoy.`, token, { env, now: now + 1_000 }), false);
});

test("privacidad: una prueba caducada no permite saltar la anonimización", () => {
  const transcript = "PACIENTE: Soy XXXXXXXXXXX.";
  const token = createPrivacyProof(transcript, { env, now, ttlMs: 1_000 });
  assert.equal(verifyPrivacyProof(transcript, token, { env, now: now + 60_000 }), false);
});

test("privacidad: sin secreto estable no se emite prueba y se conserva la vía completa", () => {
  const transcript = "PACIENTE: Soy XXXXXXXXXXX.";
  assert.equal(createPrivacyProof(transcript, { env: {}, now }), "");
  assert.equal(verifyPrivacyProof(transcript, "v1.123.fake", { env: {}, now }), false);
});

test("rendimiento: transcribe emite prueba y analyze solo omite la segunda redacción si la verifica", async () => {
  const [transcribeApi, analyzeApi, config] = await Promise.all([
    readFile(new URL("../api/transcribe.mjs", import.meta.url), "utf8"),
    readFile(new URL("../api/analyze.mjs", import.meta.url), "utf8"),
    readFile(new URL("../config.js", import.meta.url), "utf8"),
  ]);

  assert.match(transcribeApi, /createPrivacyProof\(processed\.transcript\)/);
  assert.match(transcribeApi, /privacy_proof: privacyProof/);
  assert.match(analyzeApi, /verifyPrivacyProof\(normalizedTranscript, body\.privacy_proof\)/);
  assert.match(analyzeApi, /if \(!privacyProofVerified\)[\s\S]*redactPersonNamesInTranscript/);
  assert.match(analyzeApi, /duplicate_redaction_skipped: privacyProofVerified/);
  assert.match(config, /privacyProofs\.set\(transcript, proof\)/);
  assert.match(config, /privacy_proof: proof/);
  assert.match(config, /Cualquier edición cambia el texto/);
});
