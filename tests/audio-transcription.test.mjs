import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIO_PILOT_MAX_BYTES,
  AUDIO_TRANSCRIPTION_MODEL,
  transcribeAudioPayload,
} from "../server/transcribe.mjs";

test("V0.5 audio: usa diarización, no devuelve audio y exige confirmación humana de interlocutores", async () => {
  let captured;
  const client = {
    audio: {
      transcriptions: {
        async create(params) {
          captured = params;
          return {
            task: "transcribe",
            duration: 8.4,
            text: "Buenos días. Hola.",
            segments: [
              { id: "seg-1", speaker: "A", start: 0, end: 2.2, text: "Buenos días." },
              { id: "seg-2", speaker: "B", start: 2.3, end: 3.1, text: "Hola." },
            ],
          };
        },
      },
    },
  };

  const result = await transcribeAudioPayload(
    {
      audio_base64: Buffer.from("fake-audio").toString("base64"),
      mime_type: "audio/webm;codecs=opus",
    },
    {
      client,
      fileFactory: async (buffer, filename, mime) => ({ buffer, filename, mime }),
    }
  );

  assert.equal(captured.model, AUDIO_TRANSCRIPTION_MODEL);
  assert.equal(captured.response_format, "diarized_json");
  assert.equal(captured.chunking_strategy, "auto");
  assert.deepEqual(result.speakers, ["A", "B"]);
  assert.match(result.transcript, /^HABLANTE A: Buenos días\./m);
  assert.match(result.transcript, /^HABLANTE B: Hola\./m);
  assert.equal(result.meta.persistent_audio_storage, false);
  assert.equal(result.meta.speaker_role_confirmation_required, true);
  assert.equal(result.meta.chronological_segment_order_enforced, true);
  assert.equal("audio_base64" in result, false);
});

test("V0.6 audio: ordena los segmentos por timestamp aunque la diarización los devuelva desordenados", async () => {
  const client = {
    audio: {
      transcriptions: {
        async create() {
          return {
            duration: 12,
            text: "Hola. Ahora mismo. Después.",
            segments: [
              { id: "seg-3", speaker: "B", start: 8, end: 10, text: "Después." },
              { id: "seg-1", speaker: "A", start: 0, end: 2, text: "Hola." },
              { id: "seg-2", speaker: "B", start: 4, end: 6, text: "Ahora mismo." },
            ],
          };
        },
      },
    },
  };

  const result = await transcribeAudioPayload(
    {
      audio_base64: Buffer.from("fake-audio").toString("base64"),
      mime_type: "audio/webm",
    },
    {
      client,
      fileFactory: async () => ({}),
    }
  );

  assert.deepEqual(result.segments.map((segment) => segment.id), ["seg-1", "seg-2", "seg-3"]);
  assert.equal(
    result.transcript,
    "HABLANTE A: Hola.\nHABLANTE B: Ahora mismo.\nHABLANTE B: Después."
  );
});

test("V0.6 audio: corrige el alias ASR cetralina antes de privacidad y atribución", async () => {
  const client = {
    audio: {
      transcriptions: {
        async create() {
          return {
            duration: 5,
            text: "Tomo Cetralina 50 mg.",
            segments: [
              { id: "seg-1", speaker: "B", start: 0, end: 4, text: "Tomo Cetralina 50 mg." },
            ],
          };
        },
      },
    },
  };

  const result = await transcribeAudioPayload(
    {
      audio_base64: Buffer.from("fake-audio").toString("base64"),
      mime_type: "audio/webm",
    },
    {
      client,
      fileFactory: async () => ({}),
    }
  );

  assert.equal(result.segments[0].text, "Tomo Sertralina 50 mg.");
  assert.match(result.transcript, /Sertralina 50 mg/);
  assert.doesNotMatch(result.transcript, /Cetralina/);
  assert.equal(result.meta.medication_asr_normalization_replacements, 1);
  assert.deepEqual(result.meta.medication_asr_normalization_aliases, ["cetralina_to_sertralina"]);
});

test("V0.5 audio: rechaza audio que excede el límite preventivo del piloto", async () => {
  const oversized = Buffer.alloc(AUDIO_PILOT_MAX_BYTES + 1, 1).toString("base64");
  await assert.rejects(
    () => transcribeAudioPayload({ audio_base64: oversized, mime_type: "audio/webm" }, {
      client: { audio: { transcriptions: { create: async () => ({}) } } },
      fileFactory: async () => ({}),
    }),
    /supera el tamaño máximo/
  );
});
