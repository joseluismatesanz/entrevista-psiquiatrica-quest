import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { redactAndAttributeSegments } from "../server/privacy-attribution.mjs";
import {
  createPrivacyProof,
  verifyPrivacyProof,
  LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
} from "../server/privacy-proof.mjs";
import { verifyLongInterviewBlocks } from "../api/analyze.mjs";

const env = { PRIVACY_PROOF_SECRET: "long-interview-test-secret" };
const now = 1_800_000_000_000;

function combinedClient(items) {
  return {
    responses: {
      async parse(params) {
        assert.equal(params.store, false);
        assert.equal(params.background, false);
        assert.equal(params.reasoning.effort, "none");
        return {
          status: "completed",
          output_parsed: { items },
          _request_id: "req_long_interview_test",
        };
      },
    },
  };
}

test("V0.6: MADRE explícita prevalece también en la ruta combinada de privacidad + atribución", async () => {
  const segments = [
    { id: "s1", speaker: "A", text: "Y usted, ¿es su madre? ¿Qué piensa de cómo está estos días?" },
    { id: "s2", speaker: "B", text: "Está siempre muy agobiada y desde hace una semana duerme peor." },
  ];

  const result = await redactAndAttributeSegments(segments, {
    client: combinedClient([
      {
        segment_id: "s1",
        redacted_text: segments[0].text,
        replacements: 0,
        residual_person_name: false,
        role: "psychiatrist",
        confidence: "high",
      },
      {
        segment_id: "s2",
        redacted_text: segments[1].text,
        replacements: 0,
        residual_person_name: false,
        role: "caregiver",
        confidence: "high",
      },
    ]),
  });

  assert.match(result.transcript, /^MADRE: Está siempre muy agobiada/m);
  assert.doesNotMatch(result.transcript, /^CUIDADOR\/A:/m);
  assert.equal(result.segments[1].role, "mother");
  assert.equal(result.segments[1].role_confidence, "high");
  assert.equal(result.meta.explicit_family_role_anchors, 1);
});

test("V0.6: el contexto previo desidentificado se usa solo como referencia y no forma parte de la salida", async () => {
  const prior = "MADRE: Desde ayer está peor y duerme poco.";
  const segment = { id: "s1", speaker: "A", text: "Además hoy no ha querido ir a clase." };
  let prompt = "";

  const client = {
    responses: {
      async parse(params) {
        prompt = params.input[0].content[0].text;
        return {
          status: "completed",
          output_parsed: {
            items: [{
              segment_id: "s1",
              redacted_text: segment.text,
              replacements: 0,
              residual_person_name: false,
              role: "mother",
              confidence: "high",
            }],
          },
        };
      },
    },
  };

  const result = await redactAndAttributeSegments([segment], {
    client,
    previousSafeContext: prior,
  });

  assert.match(prompt, /CONTEXTO PREVIO DESIDENTIFICADO/);
  assert.match(prompt, /MADRE: Desde ayer está peor/);
  assert.equal(result.transcript, `MADRE: ${segment.text}`);
  assert.doesNotMatch(result.transcript, /Desde ayer está peor/);
  assert.equal(result.meta.previous_safe_context_used, true);
});

test("V0.6: una prueba de bloque puede sobrevivir una entrevista de 30 minutos pero no más allá del margen largo", () => {
  const transcript = "PACIENTE: Soy XXXXXXXXXXX y desde hace una semana duermo mal.";
  const token = createPrivacyProof(transcript, {
    env,
    now,
    ttlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
    maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
  });

  const after31Minutes = now + 31 * 60 * 1000;
  assert.equal(
    verifyPrivacyProof(transcript, token, {
      env,
      now: after31Minutes,
      maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
    }),
    true
  );
  assert.equal(verifyPrivacyProof(transcript, token, { env, now: after31Minutes }), false);
  assert.equal(
    verifyPrivacyProof(transcript, token, {
      env,
      now: now + 46 * 60 * 1000,
      maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
    }),
    false
  );
});

test("V0.6: analyze solo acepta el atajo si TODOS los bloques firmados forman exactamente la transcripción visible", () => {
  const block1 = "PSIQUIATRA: Buenos días.\nPACIENTE: Me llamo XXXXXXXXXXX.";
  const block2 = "MADRE: Soy la madre y desde ayer la noto peor.";
  const proofOptions = {
    env,
    now,
    ttlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
    maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
  };
  const blocks = [
    { transcript: block1, privacy_proof: createPrivacyProof(block1, proofOptions) },
    { transcript: block2, privacy_proof: createPrivacyProof(block2, proofOptions) },
  ];
  const joined = `${block1}\n${block2}`;

  assert.deepEqual(
    verifyLongInterviewBlocks(joined, blocks, { env, now: now + 20 * 60 * 1000 }),
    { verified: true, count: 2 }
  );
  assert.equal(
    verifyLongInterviewBlocks(`${joined}\nPACIENTE: texto añadido`, blocks, { env, now: now + 20 * 60 * 1000 }).verified,
    false
  );
  const tampered = [blocks[0], { ...blocks[1], transcript: `${block2} CAMBIO` }];
  assert.equal(
    verifyLongInterviewBlocks(`${block1}\n${tampered[1].transcript}`, tampered, { env, now: now + 20 * 60 * 1000 }).verified,
    false
  );
});

test("V0.6: arquitectura larga rota bloques y mantiene protección fail-closed", async () => {
  const [longController, contextBridge, index, loader, vercel, health, pkg] = await Promise.all([
    readFile(new URL("../long-interview-v06.js", import.meta.url), "utf8"),
    readFile(new URL("../long-interview-context-v06.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../loader.js", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../api/health.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(longController, /BLOCK_SECONDS = 60/);
  assert.match(longController, /MAX_SESSION_SECONDS = 30 \* 60/);
  assert.match(longController, /\/api\/transcribe-block/);
  assert.match(longController, /verified_blocks/);
  assert.match(longController, /if \(state\.failed\)[\s\S]*caseText[\s\S]*value = ''/);
  assert.match(contextBridge, /previous_safe_context/);
  assert.match(contextBridge, /previous_context_proof/);
  assert.match(index, /PROTOTIPO CLÍNICO · V0\.6/);
  assert.match(index, /long-interview-v06\.js/);
  assert.match(index, /long-interview-context-v06\.js/);
  assert.match(loader, /transcribe\(\?:-block\)\?/);
  assert.match(vercel, /api\/transcribe-block\.mjs/);
  assert.match(health, /long_interview_blocks/);
  assert.match(health, /max_audio_seconds: 1800/);
  assert.match(pkg, /node --check long-interview-context-v06\.js/);
});
