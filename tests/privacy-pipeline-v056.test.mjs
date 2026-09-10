import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [transcribeApi, analyzeApi, validationJs, combinedPrivacy, redactionModule] = await Promise.all([
  readFile(new URL("../api/transcribe.mjs", import.meta.url), "utf8"),
  readFile(new URL("../api/analyze.mjs", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v058.js", import.meta.url), "utf8"),
  readFile(new URL("../server/privacy-attribution.mjs", import.meta.url), "utf8"),
  readFile(new URL("../server/person-name-redaction.mjs", import.meta.url), "utf8"),
]);

test("V0.5.6 privacidad: el audio queda desidentificado antes de llegar al cliente y la vía rápida falla cerrado", () => {
  assert.match(transcribeApi, /redactAndAttributeSegments\(acoustic\.segments\)/);
  assert.match(combinedPrivacy, /redacted_text/);
  assert.match(combinedPrivacy, /residual_person_name/);
  assert.match(combinedPrivacy, /PERSON_NAME_MASK/);
  assert.match(redactionModule, /PERSON_NAME_MASK = "XXXXXXXXXXX"/);
  assert.match(combinedPrivacy, /fail_closed: true/);
  assert.match(transcribeApi, /person_name_redaction_fail_closed: true/);
  assert.match(transcribeApi, /acoustic_transcript: processed\.segments/);
  assert.doesNotMatch(transcribeApi, /acoustic_transcript: acoustic\.transcript/);
  assert.match(transcribeApi, /createPrivacyProof\(processed\.transcript\)/);
  // Si falla la llamada combinada, el fallback conserva la secuencia segura:
  // primero redacta y solo después atribuye roles.
  assert.match(transcribeApi, /redactPersonNamesInSegments\(acoustic\.segments\)[\s\S]*attributeClinicalSpeakerRoles\(redaction\.segments\)/);
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
