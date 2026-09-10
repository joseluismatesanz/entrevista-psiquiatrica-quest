// El backend V0.4 se activa automáticamente solo en despliegues de prueba Vercel.
// En GitHub Pages o al abrir el prototipo localmente, se mantiene el motor local.
window.CLINICAL_API_URL = window.location.hostname.endsWith(".vercel.app")
  ? window.location.origin
  : "";

// Diagnóstico efímero de rendimiento: mide únicamente milisegundos, nunca contenido clínico.
// Se instala antes del prefetch para incluir también el análisis anticipado en la medición.
(() => {
  if (!window.CLINICAL_API_URL || typeof window.fetch !== 'function') return;

  const nativeFetch = window.fetch.bind(window);
  const samples = { audio: null, analysis: null };
  const TRANSCRIPTION_RE = /\/api\/(?:transcribe|finalize-realtime-transcript)(?:$|[?#])/i;
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
      if (samples.audio.realtime) {
        parts.push(`Audio post-fin navegador ${seconds(samples.audio.roundTripMs)} · transcripción durante la entrevista · privacidad+voces ${seconds(p.privacy_and_speaker_attribution)} · servidor ${seconds(p.total_audio_pipeline)} · Realtime`);
      } else {
        parts.push(`Audio navegador ${seconds(samples.audio.roundTripMs)} · transcripción ${seconds(p.transcription)} · privacidad+voces ${seconds(p.privacy_and_speaker_attribution)} · servidor ${seconds(p.total_audio_pipeline)} · batch`);
      }
    }
    if (samples.analysis) {
      const request = samples.analysis.request || {};
      const core = samples.analysis.core || {};
      const route = samples.analysis.fastRoute ? 'rápida' : 'clínica completa';
      const privacy = samples.analysis.proofVerified
        ? `anonimización ${seconds(request.person_name_redaction)} (ya verificada)`
        : `anonimización ${seconds(request.person_name_redaction)}`;
      parts.push(`Organización navegador ${seconds(samples.analysis.roundTripMs)} · ${privacy} · modelo clínico ${seconds(core.structured_clinical_model || request.clinical_analysis)} · CIMA ${seconds(core.medication_verification)} · postproceso ${seconds(core.deterministic_postprocessing)} · servidor ${seconds(request.total_request)} · ruta ${route}`);
    }

    target.textContent = parts.join(' | ');
    panel.hidden = parts.length === 0;
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const isAudio = TRANSCRIPTION_RE.test(url);
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
          realtime: Boolean(payload?.meta?.realtime_transcription),
        };
      }
      if (isAnalysis) {
        samples.analysis = {
          roundTripMs,
          request: payload?.meta?.request_performance_ms || {},
          core: payload?.meta?.performance_ms || {},
          fastRoute: Boolean(payload?.meta?.adaptive_fast_route),
          proofVerified: Boolean(payload?.meta?.privacy_proof_verified),
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

// Latencia percibida y privacidad: las vías batch y Realtime devuelven texto ya desidentificado
// junto con una prueba criptográfica efímera ligada exactamente a ese texto. El navegador
// conserva ambos solo en memoria. /api/analyze puede saltarse la segunda anonimización
// únicamente cuando el servidor valida esa prueba. Cualquier edición cambia el texto y
// obliga automáticamente a ejecutar de nuevo la anonimización completa.
(() => {
  if (!window.CLINICAL_API_URL || typeof window.fetch !== 'function') return;

  const nativeFetch = window.fetch.bind(window);
  const prefetched = new Map();
  const privacyProofs = new Map();
  const TRANSCRIPTION_RE = /\/api\/(?:transcribe|finalize-realtime-transcript)(?:$|[?#])/i;
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

    if (method === 'POST' && response.ok && TRANSCRIPTION_RE.test(url)) {
      response.clone().json().then((payload) => {
        const transcript = typeof payload?.transcript === 'string' ? payload.transcript.trim() : '';
        const proof = typeof payload?.privacy_proof === 'string' ? payload.privacy_proof : '';
        if (transcript && proof) privacyProofs.set(transcript, proof);

        if (!transcript || payload?.meta?.speaker_role_confirmation_required) return;
        if (prefetched.has(transcript)) return;

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
