(() => {
  const baseUrl = String(window.CLINICAL_API_URL || '').replace(/\/+$/, '');
  if (!baseUrl || typeof MediaRecorder === 'undefined') return;

  const $ = (id) => document.getElementById(id);
  const MAX_AUDIO_SECONDS = 120;
  const MAX_AUDIO_BYTES = 3_000_000;
  const state = {
    recorder: null,
    stream: null,
    chunks: [],
    realtime: null,
    startedAt: 0,
    timerId: null,
    autoStopId: null,
    preparing: false,
    processing: false,
  };

  function setButton(mode, detail = '') {
    const button = $('recordButton');
    const label = $('recordButtonLabel');
    const status = $('recordButtonStatus');
    if (!button || !label || !status) return;
    const recording = mode === 'recording';
    const busy = mode === 'preparing' || mode === 'processing';
    button.classList.toggle('recording', recording);
    button.classList.toggle('processing', busy);
    button.setAttribute('aria-pressed', recording ? 'true' : 'false');
    button.disabled = busy;
    if (mode === 'preparing') {
      label.textContent = 'Preparando…';
      status.textContent = detail || 'Conectando transcripción';
    } else if (mode === 'processing') {
      label.textContent = 'Finalizando…';
      status.textContent = detail || 'Verificando privacidad';
    } else if (recording) {
      label.textContent = 'Finalizar entrevista';
      status.textContent = detail || 'Grabando…';
    } else {
      label.textContent = 'Iniciar entrevista';
      status.textContent = detail || 'Máx. 2 min · audio ficticio';
    }
  }

  function formatClock(seconds) {
    const safe = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  }

  function clearTimers() {
    if (state.timerId) clearInterval(state.timerId);
    if (state.autoStopId) clearTimeout(state.autoStopId);
    state.timerId = null;
    state.autoStopId = null;
  }

  function stopTracks() {
    for (const track of state.stream?.getTracks?.() || []) track.stop();
    state.stream = null;
  }

  function chooseMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/mp4',
      'audio/webm',
      'audio/ogg;codecs=opus',
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo preparar el audio.'));
      reader.onload = () => {
        const value = String(reader.result || '');
        resolve(value.includes(',') ? value.slice(value.indexOf(',') + 1) : value);
      };
      reader.readAsDataURL(blob);
    });
  }

  function clearSpeakerCard() {
    $('speakerMappingCard')?.classList.add('hidden');
    if ($('speakerMappingFields')) $('speakerMappingFields').innerHTML = '';
    if ($('speakerMappingMessage')) $('speakerMappingMessage').textContent = '';
  }

  function applySafePayload(payload, mode) {
    const transcript = typeof payload?.transcript === 'string' ? payload.transcript.trim() : '';
    if (!transcript) throw new Error('La transcripción segura está vacía.');
    $('caseText').value = transcript;
    $('sessionMessage').textContent = mode === 'realtime'
      ? 'Transcripción en tiempo real desidentificada lista. Revisa el texto antes de organizar.'
      : 'Transcripción desidentificada lista. Revisa el texto antes de organizar.';
    $('recordingStatus').textContent = 'Audio descartado de la memoria local de la sesión tras obtener la transcripción.';
  }

  async function finalizeRealtime(segments) {
    const response = await fetch(`${baseUrl}/api/finalize-realtime-transcript`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'No se pudo verificar la transcripción en tiempo real.');
    return payload;
  }

  async function transcribeBatch(blob) {
    if (blob.size > MAX_AUDIO_BYTES) {
      throw new Error('El archivo supera el tamaño seguro del piloto. Repite la prueba con una grabación más corta.');
    }
    const audioBase64 = await blobToBase64(blob);
    const response = await fetch(`${baseUrl}/api/transcribe`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_base64: audioBase64,
        mime_type: blob.type || 'audio/webm',
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `Error de transcripción (${response.status})`);
    return payload;
  }

  async function finishRecording(recorder, mimeType) {
    clearTimers();
    state.processing = true;
    setButton('processing');
    $('recordingStatus').textContent = state.realtime
      ? 'Cerrando la transcripción en tiempo real y verificando privacidad…'
      : 'Transcribiendo el audio con el modo compatible…';

    const chunks = state.chunks;
    const type = recorder.mimeType || mimeType || chunks[0]?.type || 'audio/webm';
    const blob = new Blob(chunks, { type });
    const realtimeSession = state.realtime;
    state.recorder = null;
    state.realtime = null;

    try {
      if (realtimeSession) {
        try {
          const segments = await realtimeSession.stop();
          if (Array.isArray(segments) && segments.length) {
            stopTracks();
            const payload = await finalizeRealtime(segments);
            applySafePayload(payload, 'realtime');
            return;
          }
        } catch {
          // No se registra texto/audio. Se conserva el blob efímero y se usa el fallback batch.
        }
      }

      stopTracks();
      const payload = await transcribeBatch(blob);
      applySafePayload(payload, 'batch');
    } catch (error) {
      stopTracks();
      clearSpeakerCard();
      $('sessionMessage').textContent = `No se pudo completar la transcripción: ${error.message}`;
      $('recordingStatus').textContent = 'No se conserva el audio de la prueba fallida.';
    } finally {
      state.chunks = [];
      state.processing = false;
      setButton('idle');
    }
  }

  async function startRecording() {
    if (state.preparing || state.processing || state.recorder?.state === 'recording') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      $('recordingStatus').textContent = 'Este navegador no ofrece captura de audio para el piloto.';
      return;
    }

    state.preparing = true;
    clearSpeakerCard();
    $('sessionMessage').textContent = '';
    setButton('preparing');
    $('recordingStatus').textContent = 'Preparando el micrófono y la transcripción durante la entrevista…';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      state.stream = stream;

      try {
        state.realtime = await window.ClinicalRealtimeAudio?.start?.(stream) || null;
      } catch {
        state.realtime = null;
      }

      const mimeType = chooseMimeType();
      let recorder;
      try {
        recorder = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
          audioBitsPerSecond: 64_000,
        });
      } catch {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      }

      state.recorder = recorder;
      state.chunks = [];
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) state.chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => finishRecording(recorder, mimeType), { once: true });

      recorder.start(1000);
      state.startedAt = Date.now();
      state.preparing = false;
      setButton('recording', `00:00 / ${formatClock(MAX_AUDIO_SECONDS)}`);
      $('recordingStatus').textContent = state.realtime
        ? 'Grabando · transcripción en tiempo real activa · pulsa de nuevo para finalizar.'
        : 'Grabando · modo compatible activo · pulsa de nuevo para finalizar.';

      state.timerId = setInterval(() => {
        const elapsed = Math.min(MAX_AUDIO_SECONDS, (Date.now() - state.startedAt) / 1000);
        setButton('recording', `${formatClock(elapsed)} / ${formatClock(MAX_AUDIO_SECONDS)}`);
      }, 500);
      state.autoStopId = setTimeout(() => {
        if (state.recorder?.state === 'recording') state.recorder.stop();
      }, MAX_AUDIO_SECONDS * 1000);
    } catch {
      state.realtime?.abort?.();
      state.realtime = null;
      state.preparing = false;
      clearTimers();
      stopTracks();
      state.recorder = null;
      state.chunks = [];
      setButton('idle');
      $('recordingStatus').textContent = 'No se pudo acceder al micrófono. Revisa el permiso del navegador.';
    }
  }

  function stopRecording() {
    if (state.recorder?.state !== 'recording') return;
    $('recordingStatus').textContent = 'Finalizando la grabación…';
    state.recorder.stop();
  }

  function abortRealtimeState() {
    state.realtime?.abort?.();
    state.realtime = null;
    clearTimers();
    if (state.recorder?.state === 'recording') {
      try { state.recorder.stop(); } catch {}
    }
    state.recorder = null;
    state.chunks = [];
    stopTracks();
  }

  // Captura el click antes del listener batch heredado de backend-client.js.
  // El resto de la aplicación continúa usando el motor estable existente.
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('#recordButton') : null;
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (state.recorder?.state === 'recording') stopRecording();
    else if (!state.preparing && !state.processing) startRecording();
  }, true);

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('#destroyInput, #destroySession') : null;
    if (target) abortRealtimeState();
  }, true);

  window.addEventListener('pagehide', abortRealtimeState);
})();
