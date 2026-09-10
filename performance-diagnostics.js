(() => {
  if (typeof window.fetch !== 'function') return;

  const nativeFetch = window.fetch.bind(window);
  const samples = { audio: null, analysis: null };

  const seconds = (ms) => Number.isFinite(Number(ms)) ? `${(Number(ms) / 1000).toFixed(1)} s` : '—';

  function ensurePanel() {
    let panel = document.getElementById('performanceDiagnostics');
    if (panel) return panel;

    const anchor = document.querySelector('.privacy-banner');
    if (!anchor) return null;

    panel = document.createElement('section');
    panel.id = 'performanceDiagnostics';
    panel.className = 'privacy-banner';
    panel.hidden = true;
    panel.setAttribute('aria-live', 'polite');
    panel.style.marginTop = '8px';
    panel.innerHTML = '<strong>Diagnóstico de velocidad</strong><span id="performanceDiagnosticsText"></span>';
    anchor.insertAdjacentElement('afterend', panel);
    return panel;
  }

  function render() {
    const panel = ensurePanel();
    if (!panel) return;
    const target = document.getElementById('performanceDiagnosticsText');
    if (!target) return;

    const parts = [];
    if (samples.audio) {
      const p = samples.audio.server || {};
      parts.push(`Audio total navegador ${seconds(samples.audio.roundTripMs)} · transcripción ${seconds(p.transcription)} · privacidad+voces ${seconds(p.privacy_and_speaker_attribution)} · servidor ${seconds(p.total_audio_pipeline)}`);
    }
    if (samples.analysis) {
      const request = samples.analysis.request || {};
      const core = samples.analysis.core || {};
      const route = samples.analysis.fastRoute ? 'rápida' : 'clínica completa';
      parts.push(`Organización total navegador ${seconds(samples.analysis.roundTripMs)} · anonimización ${seconds(request.person_name_redaction)} · modelo clínico ${seconds(core.structured_clinical_model || request.clinical_analysis)} · CIMA ${seconds(core.medication_verification)} · postproceso ${seconds(core.deterministic_postprocessing)} · servidor ${seconds(request.total_request)} · ruta ${route}`);
    }

    if (!parts.length) {
      panel.hidden = true;
      return;
    }
    target.textContent = parts.join(' | ');
    panel.hidden = false;
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const isAudio = /\/api\/transcribe(?:$|[?#])/i.test(url);
    const isAnalysis = /\/api\/analyze(?:$|[?#])/i.test(url);
    if (!isAudio && !isAnalysis) return nativeFetch(input, init);

    const startedAt = performance.now();
    const response = await nativeFetch(input, init);
    const roundTripMs = performance.now() - startedAt;

    response.clone().json().then((payload) => {
      if (!response.ok || !payload) return;
      if (isAudio) {
        samples.audio = {
          roundTripMs,
          server: payload?.meta?.performance_ms || {},
        };
      }
      if (isAnalysis) {
        samples.analysis = {
          roundTripMs,
          request: payload?.meta?.request_performance_ms || {},
          core: payload?.meta?.performance_ms || {},
          fastRoute: Boolean(payload?.meta?.adaptive_fast_route),
        };
      }
      render();
    }).catch(() => {});

    return response;
  };

  window.addEventListener('pagehide', () => {
    samples.audio = null;
    samples.analysis = null;
  });
})();
