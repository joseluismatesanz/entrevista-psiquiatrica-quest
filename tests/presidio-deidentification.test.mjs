import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  deidentifySegmentsWithPresidio,
  deidentifyTranscriptWithPresidio,
} from "../server/presidio-deidentification.mjs";

function mockResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test("Presidio: envía solo identificadores y texto y conserva los metadatos clínicos", async () => {
  const input = [{ id: "s1", speaker: "A", start: 1.2, text: "Ana vive en Sevilla." }];
  const result = await deidentifySegmentsWithPresidio(input, {
    endpoint: "https://example.test/api/presidio",
    async fetchImpl(url, options) {
      assert.equal(url, "https://example.test/api/presidio");
      assert.equal(options.method, "POST");
      const body = JSON.parse(options.body);
      assert.deepEqual(body, {
        language: "es",
        items: [{ id: "s1", text: "Ana vive en Sevilla." }],
      });
      return mockResponse({
        engine: "presidio",
        version: "2.2.364",
        language: "es",
        model: "es_core_news_md",
        items: [{
          id: "s1",
          text: "XXXXXXXXXXX vive en [UBICACIÓN].",
          replacements: 2,
          entity_counts: { PERSON: 1, LOCATION: 1 },
        }],
      });
    },
  });

  assert.equal(result.segments[0].speaker, "A");
  assert.equal(result.segments[0].start, 1.2);
  assert.equal(result.segments[0].text, "XXXXXXXXXXX vive en [UBICACIÓN].");
  assert.equal(result.replacements, 2);
  assert.deepEqual(result.entityCounts, { PERSON: 1, LOCATION: 1 });
  assert.equal(result.meta.fail_closed, true);
  assert.equal(result.meta.store, false);
});

test("Presidio: mantiene los saltos de línea al tratar texto pegado", async () => {
  const source = "PACIENTE: Ana García\nMADRE: Vive en Sevilla";
  const result = await deidentifyTranscriptWithPresidio(source, {
    endpoint: "https://example.test/api/presidio",
    async fetchImpl(_url, options) {
      const body = JSON.parse(options.body);
      assert.equal(body.items[0].text, source);
      return mockResponse({
        engine: "presidio",
        version: "2.2.364",
        language: "es",
        model: "es_core_news_md",
        items: [{
          id: "transcript-1",
          text: "PACIENTE: XXXXXXXXXXX\nMADRE: Vive en [UBICACIÓN]",
          replacements: 2,
          entity_counts: { PERSON: 1, LOCATION: 1 },
        }],
      });
    },
  });

  assert.equal(result.transcript, "PACIENTE: XXXXXXXXXXX\nMADRE: Vive en [UBICACIÓN]");
});

test("Presidio: falla cerrado si no devuelve todos los fragmentos", async () => {
  await assert.rejects(
    () => deidentifySegmentsWithPresidio([
      { id: "s1", text: "Primer fragmento" },
      { id: "s2", text: "Segundo fragmento" },
    ], {
      endpoint: "https://example.test/api/presidio",
      async fetchImpl() {
        return mockResponse({
          engine: "presidio",
          version: "2.2.364",
          language: "es",
          model: "es_core_news_md",
          items: [{ id: "s1", text: "Primer fragmento", replacements: 0, entity_counts: {} }],
        });
      },
    }),
    /no devolvió todos los fragmentos/i,
  );
});

test("Presidio: se ejecuta antes de la verificación LLM y del análisis clínico", async () => {
  const [transcribeApi, analyzeApi, presidioPython] = await Promise.all([
    readFile(new URL("../api/transcribe.mjs", import.meta.url), "utf8"),
    readFile(new URL("../api/analyze.mjs", import.meta.url), "utf8"),
    readFile(new URL("../api/presidio.py", import.meta.url), "utf8"),
  ]);

  assert.ok(
    transcribeApi.indexOf("deidentifySegmentsWithPresidio(acoustic.segments)")
      < transcribeApi.indexOf("redactAndAttributeSegments(presidio.segments"),
  );
  assert.ok(
    analyzeApi.indexOf("deidentifyTranscriptWithPresidio(normalizedTranscript)")
      < analyzeApi.indexOf("redactPersonNamesInTranscript(safeTranscript)"),
  );
  assert.ok(
    analyzeApi.indexOf("redactPersonNamesInTranscript(safeTranscript)")
      < analyzeApi.indexOf("analyzeTranscript(safeTranscript"),
  );
  assert.match(transcribeApi, /presidio_fail_closed: true/);
  assert.match(analyzeApi, /presidio_deidentification_failed/);
  assert.match(presidioPython, /CLINICAL_NON_ENTITIES/);
  assert.match(presidioPython, /"LLEVO"/);
  assert.match(presidioPython, /supported_entity="EMAIL_ADDRESS"/);
});
