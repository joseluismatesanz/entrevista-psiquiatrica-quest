import test from "node:test";
import assert from "node:assert/strict";
import {
  MODEL_REQUEST_MAX_RETRIES,
  SINGLE_CLINICAL_MODEL_TIMEOUT_MS,
  PARALLEL_CLINICAL_MODEL_TIMEOUT_MS,
  clinicalModelRequestOptions,
} from "../server/model-request-policy.mjs";

test("modelo clínico: ninguna llamada hereda la espera de diez minutos del SDK", () => {
  assert.equal(MODEL_REQUEST_MAX_RETRIES, 0);
  assert.equal(SINGLE_CLINICAL_MODEL_TIMEOUT_MS, 110_000);
  assert.equal(PARALLEL_CLINICAL_MODEL_TIMEOUT_MS, 65_000);
  assert.deepEqual(clinicalModelRequestOptions(), { timeout: 110_000, maxRetries: 0 });
  assert.deepEqual(clinicalModelRequestOptions({ parallel: true }), { timeout: 65_000, maxRetries: 0 });
});
