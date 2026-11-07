// El backend V0.4 se activa automáticamente solo en despliegues de prueba Vercel.
// En GitHub Pages o al abrir el prototipo localmente, se mantiene el motor local.
window.CLINICAL_API_URL = window.location.hostname.endsWith(".vercel.app")
  ? window.location.origin
  : "";

// Latencia percibida y privacidad: /api/transcribe devuelve texto ya desidentificado
// junto con una prueba criptográfica efímera ligada exactamente a ese texto. El navegador
// conserva ambos solo en memoria. /api/analyze puede saltarse la segunda anonimización
// únicamente cuando el servidor valida esa prueba. Cualquier edición cambia el texto y
// obliga automáticamente a ejecutar de nuevo la anonimización completa.
(() => {
  if (!window.CLINICAL_API_URL || typeof window.fetch !== 'function') return;

  const nativeFetch = window.fetch.bind(window);
  const prefetched = new Map();
  const privacyProofs = new Map();
  window.__CLINICAL_ANALYSIS_PREFETCH = prefetched;

  function bodyFromInit(init) {
    if (typeof init?.body !== 'string') return {};
    try {
      const parsed = JSON.parse(init.body);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function transcriptFromBody(body) {
    return typeof body?.transcript === 'string' ? body.transcript.trim() : '';
  }

  function withPrivacyProof(init, transcript) {
    const proof = privacyProofs.get(transcript);
    if (!proof) return init;
    const body = bodyFromInit(init);
    if (!transcriptFromBody(body)) return init;
    return {
      ...init,
      body: JSON.stringify({ ...body, privacy_proof: proof }),
    };
  }

  function responseFromSnapshot(snapshot) {
    return new Response(JSON.stringify(snapshot.payload), {
      status: snapshot.status,
      statusText: snapshot.statusText,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const method = String(init?.method || 'GET').toUpperCase();

    if (method === 'POST' && /\/api\/analyze(?:$|[?#])/.test(url)) {
      const body = bodyFromInit(init);
      const transcript = transcriptFromBody(body);
      const pending = transcript ? prefetched.get(transcript) : null;
      if (pending) {
        prefetched.delete(transcript);
        return responseFromSnapshot(await pending);
      }
      if (transcript) init = withPrivacyProof(init, transcript);
    }

    const response = await nativeFetch(input, init);

    if (method === 'POST' && response.ok && /\/api\/transcribe(?:$|[?#])/.test(url)) {
      response.clone().json().then((payload) => {
        const transcript = typeof payload?.transcript === 'string' ? payload.transcript.trim() : '';
        const proof = typeof payload?.privacy_proof === 'string' ? payload.privacy_proof : '';
        if (transcript && proof) privacyProofs.set(transcript, proof);

        if (!transcript || prefetched.has(transcript)) return;

        // Análisis anticipado especulativo: se reutiliza solo para esta transcripción exacta.
        // Si el profesional corrige una voz o edita una palabra, la transcripción cambia y
        // el resultado anticipado deja de coincidir; el análisis se ejecuta de nuevo.
        const pending = nativeFetch(`${window.CLINICAL_API_URL}/api/analyze`, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript, ...(proof ? { privacy_proof: proof } : {}) }),
        }).then(async (analysisResponse) => ({
          status: analysisResponse.status,
          statusText: analysisResponse.statusText,
          payload: await analysisResponse.json().catch(() => ({})),
        })).catch(() => null);

        prefetched.set(transcript, pending.then((snapshot) => {
          if (!snapshot) {
            prefetched.delete(transcript);
            return { status: 503, statusText: 'Prefetch failed', payload: { message: 'No se pudo completar el análisis anticipado.' } };
          }
          return snapshot;
        }));
      }).catch(() => {});
    }

    return response;
  };

  window.addEventListener('pagehide', () => {
    prefetched.clear();
    privacyProofs.clear();
  });
})();
