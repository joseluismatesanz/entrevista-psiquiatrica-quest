(() => {
  if (typeof window.fetch !== 'function') return;

  const inheritedFetch = window.fetch.bind(window);
  const MAX_EVIDENCE_WAIT_MS = 5000;
  const POLL_MS = 100;

  function parseBody(init) {
    if (typeof init?.body !== 'string') return null;
    try {
      const parsed = JSON.parse(init.body);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function isLongInterviewAnalyze(url, method, body) {
    if (method !== 'POST' || !/\/api\/analyze(?:$|[?#])/i.test(url)) return false;
    const transcript = typeof body?.transcript === 'string' ? body.transcript.trim() : '';
    const expected = String(window.__LONG_INTERVIEW_TRANSCRIPT || '').trim();
    const blocks = window.__LONG_INTERVIEW_VERIFIED_BLOCKS;
    return Boolean(transcript && expected && transcript === expected && Array.isArray(blocks) && blocks.length);
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

  function markCompactReady(blocks) {
    const status = document.getElementById('recordingStatus');
    if (!status || !Array.isArray(blocks) || !blocks.length) return;
    const text = String(status.textContent || '');
    if (!/Entrevista cerrada/i.test(text)) return;
    const replaced = text.replace(/Evidencia clínica preparada:\s*\d+\/\d+\.?/i, `Evidencia clínica preparada: ${blocks.length}/${blocks.length}.`);
    status.textContent = /cierre compacto preparado/i.test(replaced)
      ? replaced
      : `${replaced} Cierre compacto preparado en segundo plano.`;
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const method = String(init?.method || 'GET').toUpperCase();
    const body = parseBody(init);

    if (!isLongInterviewAnalyze(url, method, body)) {
      return inheritedFetch(input, init);
    }

    const blocks = window.__LONG_INTERVIEW_VERIFIED_BLOCKS;
    const evidence = await waitForCompleteEvidence(blocks);

    if (!evidence) {
      return inheritedFetch(input, init);
    }

    markCompactReady(blocks);
    return inheritedFetch(input, {
      ...init,
      body: JSON.stringify({
        ...body,
        verified_blocks: blocks,
        verified_evidence: evidence,
      }),
    });
  };
})();
