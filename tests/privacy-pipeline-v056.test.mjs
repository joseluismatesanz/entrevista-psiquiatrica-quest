import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [transcribeApi, analyzeApi, validationJs, combinedPrivacy, parallelPrivacy, redactionModule] = await Promise.all([
  readFile(new URL("../api/transcribe.mjs", import.meta.url), "utf8"),
  readFile(new URL("../api/analyze.mjs", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v058.js", import.meta.url), "utf8"),
  readFile(new URL("../server/privacy-attribution.mjs", import.meta.url), "utf8"),
  readFile(new URL("../server/privacy-attribution-parallel.mjs", import.meta.url), "utf8"),
  readFile(new URL("../server/person-name-redaction.mjs", import.meta.url), "utf8"),
]);

test("V0.5.6 privacidad: audio paralelo expone solo texto desidentificado y conserva fallback fail-closed", () => {
  assert.match(transcribeApi, /redactAndAttributeSegmentsParallel\(acoustic\.segments\)/);
  assert.match(transcribeApi, /redactAndAttributeSegments\(acoustic\.segments\)/);
  assert.match(parallelPrivacy, /redactPersonNamesInSegments\(segments/);
  assert.match(parallelPrivacy, /attributeClinicalSpeakerRoles\(segments/);
  assert.match(parallelPrivacy, /Promise\.all/);
  assert.match(parallelPrivacy, /fail_closed: true/);
  assert.match(combinedPrivacy, /residual_person_name/);
  assert.match(redactionModule, /PERSON_NAME_MASK = "XXXXXXXXXXX"/);
  assert.match(transcribeApi, /person_name_redaction_fail_closed: true/);
  assert.match(transcribeApi, /acoustic_transcript: processed\.segments/);
  assert.doesNotMatch(transcribeApi, /acoustic_transcript: acoustic\.transcript/);
  assert.match(transcribeApi, /createPrivacyProof\(processed\.transcript\)/);
});

test("V0.5.6 privacidad: cualquier texto sin prueba válida se desidentifica antes del motor clínico; una prueba válida solo evita duplicar el mismo paso", () => {
  assert.match(analyzeApi, /verifyPrivacyProof\(normalizedTranscript, body\.privacy_proof\)/);
  assert.match(analyzeApi, /if \(!privacyProofVerified\)/);
  assert.match(analyzeApi, /stage = "person_name_redaction"/);
  assert.match(analyzeApi, /redactPersonNamesInTranscript\(normalizedTranscript\)/);
  assert.match(analyzeApi, /const fastRoute = useFastClinicalRoute\(safeTranscript\)/);
  assert.match(analyzeApi, /analyzeTranscript\(safeTranscript,/);
  assert.match(analyzeApi, /deidentified_transcript: safeTranscript/);
  assert.match(analyzeApi, /privacy_proof_verified: privacyProofVerified/);
  assert.match(analyzeApi, /person_name_redaction_failed/);
});

test("V0.5.6 privacidad: el cierre usa mailto institucional y destruye el estado local después de entregarlo", () => {
  assert.match(validationJs, /mailto:\$\{EMAIL_RECIPIENT\}/);
  assert.match(validationJs, /EMAIL_RECIPIENT = 'joseluis\.matesanz@salud-juntaex\.es'/);
  assert.doesNotMatch(validationJs, /gmail\.com|\/api\/send-report/);
  assert.match(validationJs, /link\.click\(\);[\s\S]*destroyEphemeralSession\(\)/);
});
