(() => {
  const baseUrl = String(window.CLINICAL_API_URL || '').replace(/\/+$/, '');
  if (!baseUrl) return;

  let lastSafeBlock = null;
  const inheritedFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const method = String(init?.method || 'GET').toUpperCase();
    let requestInit = init;
    let blockIndex = null;

    if (method === 'POST' && /\/api\/transcribe-block(?:$|[?#])/i.test(url) && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        blockIndex = Number(body?.block_index);

        if (blockIndex === 1) lastSafeBlock = null;

        if (blockIndex > 1 && lastSafeBlock?.transcript && lastSafeBlock?.privacyProof) {
          body.previous_safe_context = lastSafeBlock.transcript;
          body.previous_context_proof = lastSafeBlock.privacyProof;
          requestInit = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        // The original request continues. The server will simply process without context.
      }
    }

    const response = await inheritedFetch(input, requestInit);

    if (method === 'POST' && /\/api\/transcribe-block(?:$|[?#])/i.test(url) && response.ok) {
      try {
        const payload = await response.clone().json();
        const transcript = String(payload?.transcript || '').trim();
        const privacyProof = String(payload?.privacy_proof || '').trim();
        if (transcript && privacyProof) {
          lastSafeBlock = { transcript, privacyProof, blockIndex };
        }
      } catch {
        // Never interfere with the actual response consumed by the recorder.
      }
    }

    return response;
  };

  window.addEventListener('pagehide', () => {
    lastSafeBlock = null;
  });
})();
