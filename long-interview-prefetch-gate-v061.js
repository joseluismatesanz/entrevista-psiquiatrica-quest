(() => {
  if (typeof window.fetch !== 'function') return;

  const inheritedFetch = window.fetch.bind(window);
  const MAX_EVIDENCE_WAIT_MS = 12000;
  const POLL_MS = 100;
  const verifiedPrefetches = new Map();

  function parseBody(init) {
    if (typeof init?.body !== 'string') return null;
    try {
      const parsed = JSON.parse(init.body);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function responseFromSnapshot(snapshot) {
    return new Response(JSON.stringify(snapshot?.payload || {}), {
      status: Number(snapshot?.status) || 503,
      statusText: String(snapshot?.statusText || ''),
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  function currentLongInterview(body) {
    const transcript = typeof body?.transcript === 'string' ? body.transcript.trim() : '';
    const expected = String(window.__LONG_INTERVIEW_TRANSCRIPT || '').trim();
    const blocks = window.__LONG_INTERVIEW_VERIFIED_BLOCKS;
    if (!transcript || !expected || transcript !== expected || !Array.isArray(blocks) || !blocks.length) return null;
    return { transcript, blocks };
  }

  function isAnalyze(url, method) {
    return method === 'POST' && /\/api\/analyze(?:$|[?#])/i.test(url);
  }

  function completeEvidenceFor(blocks) {
    const evidence = window.__LONG_INTERVIEW_EVIDENCE;
    return Array.isArray(evidence) && evidence.length === blocks.length ? evidence : null;
  }

  async function waitForCompleteEvidence(blocks) {
    const immediate = completeEvidenceFor(blocks);
    if (immediate) return immediate;

    const startedAt = performance.now();
    while (performance.now() - startedAt < MAX_EVIDENCE_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const evidence = completeEvidenceFor(blocks);
      if (evidence) return evidence;
    }
    return null;
  }

  function markReady(blocks, evidence) {
    const status = document.getElementById('recordingStatus');
    if (!status || !Array.isArray(blocks) || !blocks.length) return;
    const text = String(status.textContent || '');
    if (!/Entrevista cerrada/i.test(text)) return;
    const count = Array.isArray(evidence) ? evidence.length : 0;
    const replaced = text.replace(/Evidencia clínica preparada:\s*\d+\/\d+\.?/i, `Evidencia clínica preparada: ${count}/${blocks.length}.`);
    const suffix = count === blocks.length
      ? ' Análisis clínico verificado preparado en segundo plano.'
      : ' Privacidad por bloques verificada; análisis clínico completo pendiente.';
    status.textContent = replaced.includes(suffix.trim()) ? replaced : `${replaced}${suffix}`;
  }

  function prefetchCache() {
    return window.__CLINICAL_ANALYSIS_PREFETCH instanceof Map
      ? window.__CLINICAL_ANALYSIS_PREFETCH
      : null;
  }

  function startVerifiedPrefetch(transcript, blocks) {
    if (verifiedPrefetches.has(transcript)) return verifiedPrefetches.get(transcript);

    // Bloquea el prefetch antiguo de long-interview-v06: solo queremos una petición
    // construida con pruebas de privacidad de todos los bloques y, si llega a tiempo,
    // evidencia clínica verificada. El bloqueo vive únicamente en memoria.
    const legacyCache = prefetchCache();
    if (legacyCache) {
      legacyCache.set(transcript, Promise.resolve({
        status: 409,
        statusText: 'Superseded by verified long-interview prefetch',
        payload: { error: 'superseded_prefetch' },
      }));
    }

    const pending = (async () => {
      const evidence = await waitForCompleteEvidence(blocks);
      const body = {
        transcript,
        verified_blocks: blocks,
        ...(evidence ? { verified_evidence: evidence } : {}),
      };

      // El wrapper config.js reutiliza __CLINICAL_ANALYSIS_PREFETCH. Se elimina el
      // marcador justo antes de la petición verificada para impedir que devuelva una
      // instantánea antigua sin proofs/evidence.
      legacyCache?.delete(transcript);

      const response = await inheritedFetch(`${String(window.CLINICAL_API_URL || '').replace(/\/+$/, '')}/api/analyze`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const snapshot = {
        status: response.status,
        statusText: response.statusText,
        payload: await response.json().catch(() => ({})),
      };
      markReady(blocks, evidence);
      return snapshot;
    })().catch(() => ({
      status: 503,
      statusText: 'Verified prefetch failed',
      payload: { message: 'No se pudo completar el análisis anticipado verificado.' },
    }));

    verifiedPrefetches.set(transcript, pending);
    return pending;
  }

  // publishAggregate dispara este evento antes de intentar su antiguo prefetch. Al
  // registrar aquí una entrada en la caché de inmediato, ese prefetch antiguo queda
  // inhibido; esta promesa espera a las pruebas verificadas y lanza una única petición.
  window.addEventListener('clinical-long-attribution-ready', (event) => {
    const transcript = String(event?.detail?.transcript || window.__LONG_INTERVIEW_TRANSCRIPT || '').trim();
    const expected = String(window.__LONG_INTERVIEW_TRANSCRIPT || '').trim();
    const blocks = window.__LONG_INTERVIEW_VERIFIED_BLOCKS;
    if (!transcript || transcript !== expected || !Array.isArray(blocks) || !blocks.length) return;
    startVerifiedPrefetch(transcript, blocks);
  });

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const method = String(init?.method || 'GET').toUpperCase();
    const body = parseBody(init);

    if (!isAnalyze(url, method)) return inheritedFetch(input, init);

    const current = currentLongInterview(body);
    if (!current) return inheritedFetch(input, init);

    const pending = startVerifiedPrefetch(current.transcript, current.blocks);
    const snapshot = await pending;
    verifiedPrefetches.delete(current.transcript);
    prefetchCache()?.delete(current.transcript);
    return responseFromSnapshot(snapshot);
  };

  window.addEventListener('pagehide', () => {
    verifiedPrefetches.clear();
  });
})();
