(() => {
  const SILENT_MARKER = 'SISTEMA: [BLOQUE_SILENCIOSO]';
  const $ = (id) => document.getElementById(id);

  function cleanTranscript(value) {
    return String(value || '')
      .split(/\r?\n/)
      .filter((line) => line.trim() && line.trim() !== SILENT_MARKER)
      .join('\n')
      .trim();
  }

  window.addEventListener('clinical-long-attribution-ready', (event) => {
    const blocks = Array.isArray(window.__LONG_INTERVIEW_VERIFIED_BLOCKS)
      ? window.__LONG_INTERVIEW_VERIFIED_BLOCKS
      : [];
    const silentIndexes = new Set(
      blocks
        .filter((block) => String(block?.transcript || '').trim() === SILENT_MARKER)
        .map((block) => Number(block.block_index))
        .filter(Number.isInteger)
    );
    if (!silentIndexes.size) return;

    const cleaned = cleanTranscript(event?.detail?.transcript || window.__LONG_INTERVIEW_TRANSCRIPT);
    if (event?.detail && typeof event.detail === 'object') event.detail.transcript = cleaned;
    window.__LONG_INTERVIEW_TRANSCRIPT = cleaned;
    window.__LONG_INTERVIEW_VERIFIED_BLOCKS = blocks.filter(
      (block) => !silentIndexes.has(Number(block?.block_index))
    );

    const evidence = window.__LONG_INTERVIEW_EVIDENCE;
    if (Array.isArray(evidence)) {
      window.__LONG_INTERVIEW_EVIDENCE = evidence.filter(
        (item) => !silentIndexes.has(Number(item?.block_index))
      );
    }

    const textArea = $('caseText');
    if (textArea) textArea.value = cleaned;

    setTimeout(() => {
      const status = $('recordingStatus');
      if (status && /Entrevista cerrada/i.test(String(status.textContent || ''))) {
        status.textContent += ` Pausas silenciosas omitidas: ${silentIndexes.size}.`;
      }
      const message = $('sessionMessage');
      if (!cleaned && message) {
        message.textContent = 'La grabación solo contenía pausas sin voz; no hay transcripción clínica que organizar.';
      }
    }, 0);
  });
})();
