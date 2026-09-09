import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [transcribeApi, analyzeApi, validationJs] = await Promise.all([
  readFile(new URL("../api/transcribe.mjs", import.meta.url), "utf8"),
  readFile(new URL("../api/analyze.mjs", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v058.js", import.meta.url), "utf8"),
]);

test("V0.5.6 privacidad: el audio se desidentifica antes de atribuir roles o llegar al cliente", () => {
  assert.match(transcribeApi, /redactPersonNamesInSegments/);
  assert.match(transcribeApi, /const redaction = await redactPersonNamesInSegments\(acoustic\.segments\)/);
  assert.match(transcribeApi, /attributeClinicalSpeakerRoles\(safeAcoustic\.segments\)/);
  assert.match(transcribeApi, /acoustic_transcript: safeAcoustic\.transcript/);
  assert.doesNotMatch(transcribeApi, /acoustic_transcript: acoustic\.transcript/);
  assert.match(transcribeApi, /person_name_redaction_fail_closed: true/);
});

test("V0.5.6 privacidad: cualquier texto se desidentifica antes del motor clínico", () => {
  assert.match(analyzeApi, /stage = "person_name_redaction"/);
  assert.match(analyzeApi, /redactPersonNamesInTranscript\(transcript\)/);
  assert.match(analyzeApi, /analyzeTranscript\(redaction\.transcript\)/);
  assert.match(analyzeApi, /deidentified_transcript: redaction\.transcript/);
  assert.match(analyzeApi, /person_name_redaction_failed/);
});

test("V0.5.6 privacidad: el cierre usa mailto institucional y destruye el estado local después de entregarlo", () => {
  assert.match(validationJs, /mailto:\$\{EMAIL_RECIPIENT\}/);
  assert.match(validationJs, /EMAIL_RECIPIENT = 'joseluis\.matesanz@salud-juntaex\.es'/);
  assert.doesNotMatch(validationJs, /gmail\.com|\/api\/send-report/);
  assert.match(validationJs, /link\.click\(\);[\s\S]*destroyEphemeralSession\(\)/);
});
