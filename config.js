// El backend V0.4 se activa automáticamente solo en despliegues de prueba Vercel.
// En GitHub Pages o al abrir el prototipo localmente, se mantiene el motor local.
window.CLINICAL_API_URL = window.location.hostname.endsWith(".vercel.app")
  ? window.location.origin
  : "";

// Latencia percibida: cuando /api/transcribe ya ha devuelto una transcripción
// desidentificada y atribuida, empezamos /api/analyze mientras el profesional revisa
// el texto. Si después pulsa «Organizar» sin modificarlo, se reutiliza exactamente
// esa petición. Si modifica una sola palabra, la clave ya no coincide y se hace un
// análisis nuevo. No se persiste nada: el mapa vive únicamente en memoria de esta página.
(() => {
  if (!window.CLINICAL_API_URL || typeof window.fetch !== 'function') return;

  const nativeFetch = window.fetch.bind(window);
  const prefetched = new Map();
  window.__CLINICAL_ANALYSIS_PREFETCH = prefetched;

  function transcriptFromInit(init) {
    if (typeof init?.body !== 'string') return '';
    try {
      const parsed = JSON.parse(init.body);
      return typeof parsed?.transcript === 'string' ? parsed.transcript.trim() : '';
    } catch {
      return '';
    }
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
      const transcript = transcriptFromInit(init);
      const pending = transcript ? prefetched.get(transcript) : null;
      if (pending) {
        prefetched.delete(transcript);
        return responseFromSnapshot(await pending);
      }
    }

    const response = await nativeFetch(input, init);

    if (method === 'POST' && response.ok && /\/api\/transcribe(?:$|[?#])/.test(url)) {
      response.clone().json().then((payload) => {
        const transcript = typeof payload?.transcript === 'string' ? payload.transcript.trim() : '';
        if (!transcript || payload?.meta?.speaker_role_confirmation_required) return;
        if (prefetched.has(transcript)) return;

        const pending = nativeFetch(`${window.CLINICAL_API_URL}/api/analyze`, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript }),
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
})();
