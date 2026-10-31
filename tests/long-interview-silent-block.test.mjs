import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transcribeAudioPayload } from "../server/transcribe.mjs";

function silentClient() {
  return {
    audio: {
      transcriptions: {
        async create() {
          return { task: "transcribe", duration: 20, text: "", segments: [] };
        },
      },
    },
  };
}

const audioPayload = {
  audio_base64: Buffer.from("fake-silent-audio").toString("base64"),
  mime_type: "audio/webm",
};

const deps = {
  client: silentClient(),
  fileFactory: async () => ({}),
};

test("V0.6 larga: un bloque silencioso es válido cuando se permite vacío", async () => {
  const result = await transcribeAudioPayload(audioPayload, {
    ...deps,
    allowEmptySegments: true,
  });
  assert.equal(result.transcript, "");
  assert.deepEqual(result.segments, []);
  assert.equal(result.meta.silent_audio_block, true);
});

test("V0.5/flujo corto: una transcripción sin voz sigue siendo error", async () => {
  await assert.rejects(
    () => transcribeAudioPayload(audioPayload, deps),
    /no devolvió segmentos de voz/i
  );
});

test("V0.6 larga: el servidor firma la pausa y el navegador la elimina antes de mostrar/analizar", async () => {
  const [api, cleaner, index] = await Promise.all([
    readFile(new URL("../api/transcribe.mjs", import.meta.url), "utf8"),
    readFile(new URL("../long-interview-silent-block-v062.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);

  assert.match(api, /SILENT_LONG_INTERVIEW_BLOCK/);
  assert.match(api, /silent_block:\s*true/);
  assert.match(api, /createPrivacyProof\(SILENT_LONG_INTERVIEW_BLOCK/);
  assert.match(cleaner, /SISTEMA: \[BLOQUE_SILENCIOSO\]/);
  assert.match(cleaner, /__LONG_INTERVIEW_VERIFIED_BLOCKS/);
  assert.match(cleaner, /__LONG_INTERVIEW_EVIDENCE/);
  assert.match(cleaner, /textArea\.value\s*=\s*cleaned/);

  const controller = index.indexOf("long-interview-v06.js");
  const silentLayer = index.indexOf("long-interview-silent-block-v062.js");
  const gate = index.indexOf("long-interview-prefetch-gate-v061.js");
  assert.ok(controller >= 0 && silentLayer > controller && gate > silentLayer);
});
