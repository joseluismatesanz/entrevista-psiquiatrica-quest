import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyTranscriptionError } from "../api/transcribe.mjs";

test("transcripción: el saldo agotado se comunica como acción de facturación y no se reintenta", () => {
  const failure = classifyTranscriptionError(Object.assign(
    new Error("429 You have no credits remaining. Add credits to continue using the API."),
    { code: "credit_balance_exhausted", status: 429 }
  ));

  assert.deepEqual(failure, {
    status: 402,
    error: "transcription_billing_required",
    message: "La cuenta de transcripción configurada no tiene saldo disponible. Añade créditos en OpenAI y vuelve a intentarlo.",
    retryable: false,
    action_required: "add_openai_credits",
  });
});

test("transcripción: un límite temporal sigue siendo recuperable", () => {
  const failure = classifyTranscriptionError(Object.assign(
    new Error("Rate limit reached"),
    { code: "rate_limit_exceeded", status: 429 }
  ));

  assert.equal(failure.status, 429);
  assert.equal(failure.retryable, true);
  assert.equal(failure.error, "transcription_rate_limited");
});

test("entrevista larga: conserva bloques ya transcritos y bloquea el análisis incompleto", async () => {
  const controller = await readFile(new URL("../long-interview-v06.js", import.meta.url), "utf8");

  assert.match(controller, /publishPartialTranscript\(\)/);
  assert.match(controller, /__LONG_INTERVIEW_PARTIAL_TRANSCRIPT/);
  assert.match(controller, /__LONG_INTERVIEW_INCOMPLETE/);
  assert.match(controller, /incomplete_long_interview/);
  assert.match(controller, /error\?\.retryable === false/);
  assert.doesNotMatch(controller, /No se pudo cerrar[^\n]+\n\s*if \(\$\('caseText'\)\) \$\('caseText'\)\.value = ''/);
});
