import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [tokenApi, finalizerApi, realtimeAudio, controller, config, semanticUi, index] = await Promise.all([
  readFile(new URL("../api/realtime-token.mjs", import.meta.url), "utf8"),
  readFile(new URL("../api/finalize-realtime-transcript.mjs", import.meta.url), "utf8"),
  readFile(new URL("../realtime-audio.js", import.meta.url), "utf8"),
  readFile(new URL("../realtime-recorder-controller.js", import.meta.url), "utf8"),
  readFile(new URL("../config.js", import.meta.url), "utf8"),
  readFile(new URL("../semantic-role-ui.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
]);

test("Realtime: el servidor emite solo un client secret efímero ligado a una sesión de transcripción", () => {
  assert.match(tokenApi, /\/v1\/realtime\/client_secrets/);
  assert.match(tokenApi, /type:\s*"transcription"/);
  assert.match(tokenApi, /model:\s*REALTIME_TRANSCRIPTION_MODEL/);
  assert.match(tokenApi, /REALTIME_TRANSCRIPTION_MODEL = "gpt-live-transcribe"/);
  assert.match(tokenApi, /languages:\s*\["es"\]/);
  assert.match(tokenApi, /delay:\s*"low"/);
  assert.match(tokenApi, /type:\s*"server_vad"/);
  assert.match(tokenApi, /value:\s*data\.value/);
  assert.doesNotMatch(tokenApi, /apiKey:\s*auth\.apiKey/);
  assert.match(tokenApi, /auth\.transport !== "openai-direct"/);
});

test("Realtime: el navegador usa WebRTC y mantiene la transcripción cruda solo en memoria", () => {
  assert.match(realtimeAudio, /new RTCPeerConnection\(\)/);
  assert.match(realtimeAudio, /\/api\/realtime-token/);
  assert.match(realtimeAudio, /https:\/\/api\.openai\.com\/v1\/realtime\/calls/);
  assert.match(realtimeAudio, /conversation\.item\.input_audio_transcription\.delta/);
  assert.match(realtimeAudio, /conversation\.item\.input_audio_transcription\.completed/);
  assert.match(realtimeAudio, /input_audio_buffer\.commit/);
  assert.match(realtimeAudio, /completed\.clear\(\)/);
  assert.doesNotMatch(realtimeAudio, /caseText|innerHTML|textContent/);
  assert.doesNotMatch(realtimeAudio, /console\.(?:log|debug|info)\(/);
});

test("Realtime: antes de cualquier salida clínica se reutiliza la misma privacidad fail-closed", () => {
  assert.match(finalizerApi, /redactAndAttributeSegments\(rawSegments\)/);
  assert.match(finalizerApi, /redactPersonNamesInSegments\(rawSegments\)[\s\S]*attributeClinicalSpeakerRoles\(redaction\.segments\)/);
  assert.match(finalizerApi, /createPrivacyProof\(processed\.transcript\)/);
  assert.match(finalizerApi, /person_name_redaction_fail_closed:\s*true/);
  assert.match(finalizerApi, /speaker:\s*"RT"/);
  assert.match(finalizerApi, /persistent_audio_storage:\s*false/);
  assert.match(finalizerApi, /realtime_transcription:\s*true/);
});

test("Realtime: el grabador conserva MediaRecorder como fallback batch y solo muestra respuesta ya procesada", () => {
  assert.match(controller, /ClinicalRealtimeAudio\?\.start/);
  assert.match(controller, /recorder\.start\(1000\)/);
  assert.match(controller, /\/api\/finalize-realtime-transcript/);
  assert.match(controller, /\/api\/transcribe/);
  assert.match(controller, /applySafePayload/);
  assert.match(controller, /payload\.transcript/);
  assert.doesNotMatch(controller, /segments\[[^\]]*\]\.textContent/);
  assert.match(controller, /realtimeSession\.stop\(\)/);
  assert.match(controller, /transcribeBatch\(blob\)/);
});

test("Realtime: diagnóstico, prueba firmada y atribución semántica reconocen ambas rutas", () => {
  assert.match(config, /finalize-realtime-transcript/);
  assert.match(config, /transcripción durante la entrevista/);
  assert.match(config, /privacyProofs\.set\(transcript, proof\)/);
  assert.match(semanticUi, /finalize-realtime-transcript/);
  assert.match(semanticUi, /En transcripción en tiempo real no se usa identidad acústica/);
});

test("Realtime: los módulos se cargan antes del motor batch y con cache-busting", () => {
  assert.match(index, /config\.js\?v=20260910-realtime-1/);
  assert.match(index, /semantic-role-ui\.js\?v=20260910-realtime-1/);
  assert.match(index, /realtime-audio\.js\?v=20260910-realtime-1/);
  assert.match(index, /realtime-recorder-controller\.js\?v=20260910-realtime-1/);
  assert.match(index, /loader\.js\?v=20260910-realtime-1/);
  assert.ok(index.indexOf("realtime-recorder-controller.js") < index.indexOf("loader.js"));
});
