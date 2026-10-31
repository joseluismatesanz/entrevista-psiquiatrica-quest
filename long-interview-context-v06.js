(() => {
  const baseUrl = String(window.CLINICAL_API_URL || '').replace(/\/+$/, '');
  if (!baseUrl) return;

  const safeBlocks = new Map();
  let finalizationStartedAt = 0;
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

        if (blockIndex === 1) safeBlocks.clear();

        // Con procesamiento concurrente solo se aporta contexto si el bloque inmediatamente
        // anterior YA terminó y está firmado. Nunca se usa un bloque antiguo como si fuera
        // el precedente: si aún no está disponible, el servidor procesa sin contexto y
        // conserva sus reglas fail-closed/revisión de fuentes.
        const previous = safeBlocks.get(blockIndex - 1);
        if (blockIndex > 1 && previous?.transcript && previous?.privacyProof) {
          body.previous_safe_context = previous.transcript;
          body.previous_context_proof = previous.privacyProof;
          requestInit = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        // La petición original continúa; el servidor procesará el bloque sin contexto previo.
      }
    }

    const response = await inheritedFetch(input, requestInit);

    if (method === 'POST' && /\/api\/transcribe-block(?:$|[?#])/i.test(url) && response.ok) {
      try {
        const payload = await response.clone().json();
        const transcript = String(payload?.transcript || '').trim();
        const privacyProof = String(payload?.privacy_proof || '').trim();
        if (transcript && privacyProof && Number.isFinite(blockIndex)) {
          safeBlocks.set(blockIndex, { transcript, privacyProof });
        }
      } catch {
        // Nunca interfiere con la respuesta consumida por el grabador.
      }
    }

    return response;
  };

  // Métrica exclusivamente temporal y efímera; no contiene contenido clínico.
  const label = document.getElementById('recordButtonLabel');
  if (label && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => {
      if (String(label.textContent || '').includes('Cerrando entrevista')) {
        finalizationStartedAt = performance.now();
      }
    });
    observer.observe(label, { childList: true, characterData: true, subtree: true });
  }

  window.addEventListener('clinical-long-attribution-ready', () => {
    if (!finalizationStartedAt) return;
    const elapsedMs = Math.max(0, performance.now() - finalizationStartedAt);
    finalizationStartedAt = 0;
    setTimeout(() => {
      const status = document.getElementById('recordingStatus');
      if (!status || status.textContent.includes('Cierre tras Finalizar:')) return;
      status.textContent += ` Cierre tras Finalizar: ${(elapsedMs / 1000).toFixed(1)} s.`;
    }, 0);
  });

  window.addEventListener('pagehide', () => {
    safeBlocks.clear();
    finalizationStartedAt = 0;
  });
})();