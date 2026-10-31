export const MODEL_REQUEST_MAX_RETRIES = 0;
export const SINGLE_CLINICAL_MODEL_TIMEOUT_MS = 110_000;
export const PARALLEL_CLINICAL_MODEL_TIMEOUT_MS = 65_000;

export function clinicalModelRequestOptions({ parallel = false } = {}) {
  return {
    timeout: parallel ? PARALLEL_CLINICAL_MODEL_TIMEOUT_MS : SINGLE_CLINICAL_MODEL_TIMEOUT_MS,
    maxRetries: MODEL_REQUEST_MAX_RETRIES,
  };
}
