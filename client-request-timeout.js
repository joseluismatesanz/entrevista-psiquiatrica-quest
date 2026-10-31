(() => {
  const DEFAULT_TIMEOUT_MS = 90_000;

  function timeoutError(label, timeoutMs) {
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    const error = new Error(`${label || 'La solicitud'} no respondió en ${seconds} segundos.`);
    error.name = 'RequestTimeoutError';
    error.code = 'request_timeout';
    error.timeoutMs = timeoutMs;
    return error;
  }

  async function fetchWithDeadline(input, init = {}, options = {}) {
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
    const fetchImpl = options.fetchImpl || window.fetch.bind(window);
    const controller = new AbortController();
    const externalSignal = init.signal;
    let timedOut = false;

    const abortFromExternalSignal = () => {
      const reason = externalSignal?.reason;
      controller.abort(reason instanceof Error ? reason : new DOMException('Solicitud cancelada.', 'AbortError'));
    };

    if (externalSignal?.aborted) abortFromExternalSignal();
    else externalSignal?.addEventListener?.('abort', abortFromExternalSignal, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('Tiempo de espera agotado.', 'TimeoutError'));
    }, timeoutMs);

    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) throw timeoutError(options.label, timeoutMs);
      throw error;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', abortFromExternalSignal);
    }
  }

  function waitWithDeadline(promise, options = {}) {
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
    let timer;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(options.label, timeoutMs)), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  window.ClinicalRequest = Object.freeze({
    DEFAULT_TIMEOUT_MS,
    fetchWithDeadline,
    waitWithDeadline,
  });
})();
