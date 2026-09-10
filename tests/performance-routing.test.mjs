import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { redactAndAttributeSegments } from "../server/privacy-attribution.mjs";

const [apiAnalyze, apiTranscribe, config, index, parallelPrivacy, speakerAttribution, serverAnalyze] = await Promise.all([
  readFile(new URL("../api/analyze.mjs", import.meta.url), "utf8"),
  readFile(new URL("../api/transcribe.mjs", import.meta.url), "utf8"),
  readFile(new URL("../config.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../server/privacy-attribution-parallel.mjs", import.meta.url), "utf8"),
  readFile(new URL("../server/speaker-attribution.mjs", import.meta.url), "utf8"),
  readFile(new URL("../server/analyze.mjs", import.meta.url), "utf8"),
]);

test("rendimiento: audio ejecuta anonimización y atribución en paralelo con fallback combinado", () => {
  assert.match(apiTranscribe, /redactAndAttributeSegmentsParallel\(acoustic\.segments\)/);
  assert.match(apiTranscribe, /redactAndAttributeSegments\(acoustic\.segments\)/);
  assert.match(apiTranscribe, /parallel_privacy_attribution/);
  assert.match(apiTranscribe, /combined_privacy_attribution_fallback/);
  assert.match(parallelPrivacy, /Promise\.all\(\[redactionPromise, attributionPromise\]\)/);
  assert.match(parallelPrivacy, /fail_closed: true/);
});

test("rendimiento: clasificación de voces mecánica usa Luna sin razonamiento", () => {
  assert.match(speakerAttribution, /SPEAKER_ROLE_MODEL = "gpt-5\.6-luna"/);
  assert.match(speakerAttribution, /reasoning: \{ effort: "none" \}/);
});

test("rendimiento: ruta rápida excluye señales complejas y usa Luna sin razonamiento", () => {
  assert.match(apiAnalyze, /COMPLEX_CLINICAL_PATTERNS/);
  for (const token of ["suicid", "psicos", "agresi", "cannabis", "bipolar", "sertralina"]) {
    assert.match(apiAnalyze, new RegExp(token, "i"));
  }
  assert.match(apiAnalyze, /model: "gpt-5\.6-luna", reasoningEffort: "none", maxOutputTokens: 8000/);
  assert.match(apiAnalyze, /reasoningEffort: "low", maxOutputTokens: 16000/);
  assert.match(serverAnalyze, /reasoning: \{ effort: reasoningEffort \}/);
  assert.match(serverAnalyze, /max_output_tokens: maxOutputTokens/);
  assert.match(apiAnalyze, /adaptive_fast_route/);
});

test("rendimiento: prefetch solo reutiliza el análisis si la transcripción no cambia", () => {
  assert.match(config, /__CLINICAL_ANALYSIS_PREFETCH/);
  assert.match(config, /prefetched\.get\(transcript\)/);
  assert.match(config, /speaker_role_confirmation_required/);
  assert.match(config, /privacyProofs\.get\(transcript\)/);
  assert.match(config, /conserva ambos solo en memoria/);
});

test("rendimiento: el navegador fuerza una revisión fresca del cliente de privacidad", () => {
  assert.match(index, /config\.js\?v=20260910-privacy-proof-1/);
});

test("privacidad combinada de respaldo: conserva XXXXXXXXXXX y atribuye rol sin devolver nombre", async () => {
  const client = {
    responses: {
      async parse(params) {
        assert.equal(params.store, false);
        assert.equal(params.background, false);
        assert.equal(params.reasoning.effort, "none");
        return {
          status: "completed",
          output_parsed: {
            items: [
              {
                segment_id: "s1",
                redacted_text: "Soy XXXXXXXXXXX y duermo mal.",
                replacements: 1,
                residual_person_name: false,
                role: "patient",
                confidence: "high",
              },
            ],
          },
        };
      },
    },
  };

  const result = await redactAndAttributeSegments([
    { id: "s1", speaker: "B", text: "Soy Carlos Pérez y duermo mal." },
  ], { client });

  assert.doesNotMatch(result.transcript, /Carlos|Pérez/);
  assert.match(result.transcript, /^PACIENTE: Soy XXXXXXXXXXX/);
  assert.equal(result.replacements, 1);
  assert.equal(result.meta.fail_closed, true);
});

test("privacidad combinada de respaldo: falla cerrado si queda un nombre residual", async () => {
  const client = {
    responses: {
      async parse() {
        return {
          status: "completed",
          output_parsed: {
            items: [
              {
                segment_id: "s1",
                redacted_text: "Soy Carlos Pérez.",
                replacements: 0,
                residual_person_name: true,
                role: "patient",
                confidence: "high",
              },
            ],
          },
        };
      },
    },
  };

  await assert.rejects(
    () => redactAndAttributeSegments([{ id: "s1", speaker: "B", text: "Soy Carlos Pérez." }], { client }),
    /eliminación de nombres personales/
  );
});
