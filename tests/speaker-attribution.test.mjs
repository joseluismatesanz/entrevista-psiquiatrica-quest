import test from "node:test";
import assert from "node:assert/strict";
import {
  attributeClinicalSpeakerRoles,
  deduplicateClearAdjacentOverlaps,
} from "../server/speaker-attribution.mjs";

function mockClient(assignments) {
  return {
    responses: {
      async parse(params) {
        assert.equal(params.store, false);
        assert.equal(params.background, false);
        assert.equal(params.reasoning.effort, "low");
        return {
          status: "completed",
          output_parsed: { assignments },
          _request_id: "req_speaker_test",
        };
      },
    },
  };
}

test("V0.5.4: una misma voz acústica puede contener Paciente y Madre sin revisión masiva", async () => {
  const segments = [
    { id: "s1", speaker: "A", text: "Buenas tardes. ¿Me puede decir qué le pasa hoy?" },
    { id: "s2", speaker: "B", text: "Estoy muy nerviosa y no puedo dormir bien." },
    { id: "s3", speaker: "A", text: "¿Y usted es la madre?" },
    { id: "s4", speaker: "B", text: "Sí. Desde hace una semana está más aislada y ha faltado al instituto." },
    { id: "s5", speaker: "B", text: "Ahora mismo tomo sertralina 50 mg por la mañana." },
  ];

  const result = await attributeClinicalSpeakerRoles(segments, {
    client: mockClient([
      { segment_id: "s1", role: "psychiatrist", confidence: "high" },
      { segment_id: "s2", role: "patient", confidence: "high" },
      { segment_id: "s3", role: "psychiatrist", confidence: "high" },
      { segment_id: "s4", role: "mother", confidence: "high" },
      { segment_id: "s5", role: "patient", confidence: "high" },
    ]),
  });

  assert.match(result.transcript, /^PSIQUIATRA: Buenas tardes/m);
  assert.match(result.transcript, /^PACIENTE: Estoy muy nerviosa/m);
  assert.match(result.transcript, /^MADRE: Sí\. Desde hace una semana/m);
  assert.match(result.transcript, /^PACIENTE: Ahora mismo tomo sertralina/m);
  assert.deepEqual(result.participants.map((item) => item.role), ["psychiatrist", "patient", "mother"]);
  assert.equal(result.review_items.length, 0);
  assert.equal(result.meta.abstention_enabled, true);
});

test("V0.5.4: solo una fuente dudosa clínicamente sensible exige revisión", async () => {
  const segments = [
    { id: "s1", speaker: "A", text: "Buenos días." },
    { id: "s2", speaker: "B", text: "No quiero morir ni hacerme daño." },
    { id: "s3", speaker: "B", text: "Me gusta dibujar por las tardes." },
  ];

  const result = await attributeClinicalSpeakerRoles(segments, {
    client: mockClient([
      { segment_id: "s1", role: "psychiatrist", confidence: "medium" },
      { segment_id: "s2", role: "patient", confidence: "medium" },
      { segment_id: "s3", role: "unknown", confidence: "low" },
    ]),
  });

  assert.equal(result.review_items.length, 1);
  assert.equal(result.review_items[0].segment_id, "s2");
  assert.equal(result.review_items[0].suggested_role, "patient");
  assert.match(result.transcript, /^INTERLOCUTOR_NO_IDENTIFICADO: Me gusta dibujar/m);
});

test("V0.5.4: si falta una asignación sensible, se abstiene y la eleva a revisión", async () => {
  const segments = [
    { id: "s1", speaker: "A", text: "¿Qué medicación tomas?" },
    { id: "s2", speaker: "B", text: "Sertralina 50 mg por la mañana." },
  ];

  const result = await attributeClinicalSpeakerRoles(segments, {
    client: mockClient([
      { segment_id: "s1", role: "psychiatrist", confidence: "high" },
    ]),
  });

  assert.equal(result.review_items.length, 1);
  assert.equal(result.review_items[0].segment_id, "s2");
  assert.equal(result.review_items[0].suggested_role, "unknown");
  assert.match(result.transcript, /^INTERLOCUTOR_NO_IDENTIFICADO: Sertralina 50 mg/m);
});

test("V0.5.4: elimina solo solapamientos adyacentes claros del mismo hablante acústico", () => {
  const input = [
    {
      id: "s1",
      speaker: "B",
      start: 0,
      end: 4,
      text: "Pues que estoy muy nerviosa últimamente, que no puedo dormir bien, que siempre estoy agitada.",
    },
    {
      id: "s2",
      speaker: "B",
      start: 3.8,
      end: 5,
      text: "que siempre estoy agitada, pues",
    },
    {
      id: "s3",
      speaker: "B",
      start: 5.1,
      end: 5.8,
      text: "Sí, sí.",
    },
    {
      id: "s4",
      speaker: "A",
      start: 6,
      end: 7,
      text: "Muy bien.",
    },
  ];

  const result = deduplicateClearAdjacentOverlaps(input);
  assert.equal(result.removed, 1);
  assert.deepEqual(result.segments.map((segment) => segment.id), ["s1", "s3", "s4"]);
  assert.match(result.segments[0].text, /siempre estoy agitada/i);
  assert.equal(result.segments[1].text, "Sí, sí.");
});
