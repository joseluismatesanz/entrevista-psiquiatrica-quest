import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { redactAndAttributeSegments } from "../server/privacy-attribution.mjs";
import { useFastClinicalRoute } from "../api/analyze.mjs";

const [apiAnalyze, apiTranscribe, config, index] = await Promise.all([
  readFile(new URL("../api/analyze.mjs", import.meta.url), "utf8"),
  readFile(new URL("../api/transcribe.mjs", import.meta.url), "utf8"),
  readFile(new URL("../config.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
]);

test("rendimiento: audio anonimiza una vez con Presidio y mantiene una sola atribución de roles", () => {
  assert.match(apiTranscribe, /redactAndAttributeSegments/);
  assert.match(apiTranscribe, /duplicate_name_redaction_skipped_after_presidio/);
  assert.doesNotMatch(apiTranscribe, /redactPersonNamesInSegments/);
  assert.match(apiTranscribe, /fallbackUsed/);
});

test("rendimiento: ruta rápida excluye señales clínicas complejas, no una mención farmacológica simple", () => {
  assert.match(apiAnalyze, /HIGH_COMPLEXITY_PATTERNS/);
  for (const token of ["suicid", "psicos", "agresi", "cannabis", "bipolar"]) {
    assert.match(apiAnalyze, new RegExp(token, "i"));
  }
  assert.match(apiAnalyze, /MEDICATION_COMPLEXITY_ACTION_PATTERN/);
  assert.match(apiAnalyze, /gpt-5\.6-luna/);
  assert.match(apiAnalyze, /adaptive_fast_route/);

  assert.equal(useFastClinicalRoute("PACIENTE: Tomo lorazepam y sertralina."), true);
  assert.equal(useFastClinicalRoute("PACIENTE: Tomo sertralina 50 mg por la mañana."), true);
  assert.equal(useFastClinicalRoute("PSIQUIATRA: Vamos a subir sertralina de 50 mg a 100 mg."), false);
  assert.equal(useFastClinicalRoute("PACIENTE: No tomo la sertralina desde hace una semana."), false);
  assert.equal(useFastClinicalRoute("PACIENTE: Escucho voces que me hablan."), false);
});

test("rendimiento: el prefetch especulativo se reutiliza solo si la transcripción no cambia", () => {
  assert.match(config, /__CLINICAL_ANALYSIS_PREFETCH/);
  assert.match(config, /prefetched\.get\(transcript\)/);
  assert.match(config, /privacyProofs\.get\(transcript\)/);
  assert.match(config, /Análisis anticipado especulativo/);
  assert.doesNotMatch(config, /if \(!transcript \|\| payload\?\.meta\?\.speaker_role_confirmation_required\) return/);
  assert.match(config, /Si el profesional corrige[\s\S]*la transcripción cambia/);
  assert.match(config, /conserva ambos solo en memoria/);
});

test("rendimiento: el navegador fuerza una revisión fresca del cliente de privacidad", () => {
  assert.match(index, /config\.js\?v=[^"']+/);
});

test("privacidad combinada: conserva XXXXXXXXXXX y atribuye rol sin devolver nombre", async () => {
  const client = {
    responses: {
      async parse(params) {
        assert.equal(params.store, false);
        assert.equal(params.background, false);
        assert.equal(params.reasoning.effort, "none");
        return {
          status: "completed",
          output_parsed: {
            assignments: [
              {
                segment_id: "s1",
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
    { id: "s1", speaker: "B", text: "Soy XXXXXXXXXXX y duermo mal.", presidio_replacements: 1 },
  ], { client });

  assert.doesNotMatch(result.transcript, /Carlos|Pérez/);
  assert.match(result.transcript, /^PACIENTE: Soy XXXXXXXXXXX/);
  assert.equal(result.replacements, 1);
  assert.equal(result.meta.fail_closed, true);
});

test("privacidad combinada: falla cerrado si se omite la prueba de paso por Presidio", async () => {
  await assert.rejects(
    () => redactAndAttributeSegments([{ id: "s1", speaker: "B", text: "Soy Carlos Pérez." }]),
    /previamente desidentificados por Presidio/
  );
});
