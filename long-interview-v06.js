(() => {
  const baseUrl = String(window.CLINICAL_API_URL || '').replace(/\/+$/, '');
  if (!baseUrl || typeof MediaRecorder === 'undefined') return;

  const BLOCK_SECONDS = 20;
  const MAX_SESSION_SECONDS = 30 * 60;
  const MAX_CONCURRENT_BLOCKS = 2;
  const MAX_BUFFERED_BLOCKS = 8;
  const MAX_BLOCK_BYTES = 3_000_000;
  const MIN_BLOCK_BYTES = 1200;

  const $ = (id) => document.getElementById(id);
  const state = {
    active: false,
    finishing: false,
    failed: false,
    stream: null,
    recorder: null,
    recorderParts: [],
    mimeType: '',
    startedAt: 0,
    blockIndex: 0,
    processedBlocks: [],
    pendingBlocks: 0,
    inFlightBlocks: 0,
    taskQueue: [],
    taskPromises: [],
    rotationPromise: null,
    blockTimer: null,
    uiTimer: null,
    maxTimer: null,
    finalTranscript: '',
    analysisPrefetchStarted: false,
    finalizationStartedAt: 0,
    peakPendingBlocks: 0,
  };

  function formatClock(seconds) {
    const safe = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  }

  function chooseRecorderMimeType() {
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
      reader.onerror = () => reject(new Error('No se pudo preparar el bloque de audio.'));
      reader.onload = () => {
        const value = String(reader.result || '');
        resolve(value.includes(',') ? value.slice(value.indexOf(',') + 1) : value);
      };
      reader.readAsDataURL(blob);
    });
  }

  function clearTimers() {
    if (state.blockTimer) clearTimeout(state.blockTimer);
    if (state.uiTimer) clearInterval(state.uiTimer);
    if (state.maxTimer) clearTimeout(state.maxTimer);
    state.blockTimer = null;
    state.uiTimer = null;
    state.maxTimer = null;
  }

  function stopTracks() {
    for (const track of state.stream?.getTracks?.() || []) track.stop();
    state.stream = null;
  }

  function invalidateVerifiedBlocks() {
    window.__LONG_INTERVIEW_VERIFIED_BLOCKS = null;
    window.__LONG_INTERVIEW_TRANSCRIPT = '';
  }

  function drainQueuedTasks() {
    while (state.taskQueue.length) {
      const task = state.taskQueue.shift();
      task?.resolve?.({ ok: false, skipped: true });
      state.pendingBlocks = Math.max(0, state.pendingBlocks - 1);
    }
  }

  function resetState({ keepText = false } = {}) {
    clearTimers();
    stopTracks();
    drainQueuedTasks();
    state.active = false;
    state.finishing = false;
    state.failed = false;
    state.recorder = null;
    state.recorderParts = [];
    state.mimeType = '';
    state.startedAt = 0;
    state.blockIndex = 0;
    state.processedBlocks = [];
    state.pendingBlocks = 0;
    state.inFlightBlocks = 0;
    state.taskQueue = [];
    state.taskPromises = [];
    state.rotationPromise = null;
    state.finalTranscript = '';
    state.analysisPrefetchStarted = false;
    state.finalizationStartedAt = 0;
    state.peakPendingBlocks = 0;
    invalidateVerifiedBlocks();
    if (!keepText && $('caseText')) $('caseText').value = '';
  }

  function setButton(mode) {
    const button = $('recordButton');
    const label = $('recordButtonLabel');
    const detail = $('recordButtonStatus');
    if (!button || !label || !detail) return;

    button.classList.toggle('recording', mode === 'recording');
    button.classList.toggle('processing', mode === 'processing');
    button.setAttribute('aria-pressed', mode === 'recording' ? 'true' : 'false');
    button.disabled = mode === 'processing';

    if (mode === 'recording') {
      label.textContent = 'Finalizar entrevista';
    } else if (mode === 'processing') {
      label.textContent = 'Cerrando entrevista…';
      detail.textContent = 'Procesando últimos bloques';
    } else {
      label.textContent = 'Iniciar entrevista';
      detail.textContent = 'Máx. 30 min · bloques de 20 s';
    }
  }

  function updateRecordingUi() {
    if (!state.active) return;
    const elapsed = (Date.now() - state.startedAt) / 1000;
    const safe = state.processedBlocks.length;
    const pending = state.pendingBlocks;
    const detail = $('recordButtonStatus');
    const status = $('recordingStatus');
    if (detail) detail.textContent = `${formatClock(elapsed)} / ${formatClock(MAX_SESSION_SECONDS)}`;
    if (status) {
      const processing = state.inFlightBlocks;
      const waiting = Math.max(0, pending - processing);
      status.textContent = `Grabando · ${safe} bloque${safe === 1 ? '' : 's'} seguro${safe === 1 ? '' : 's'} · ${processing} procesando${waiting ? ` · ${waiting} en cola` : ''}. El audio de cada bloque se descarta al quedar desidentificado.`;
    }
  }

  function makeRecorder() {
    try {
      return new MediaRecorder(state.stream, {
        ...(state.mimeType ? { mimeType: state.mimeType } : {}),
        audioBitsPerSecond: 64_000,
      });
    } catch {
      return new MediaRecorder(state.stream, state.mimeType ? { mimeType: state.mimeType } : undefined);
    }
  }

  async function fetchBlock(blob, index, attempt = 1) {
    if (blob.size > MAX_BLOCK_BYTES) throw new Error(`El bloque ${index} supera el tamaño permitido.`);
    const audioBase64 = await blobToBase64(blob);
    const response = await fetch(`${baseUrl}/api/transcribe-block`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_base64: audioBase64,
        mime_type: blob.type || state.mimeType || 'audio/webm',
        long_interview_block: true,
        block_index: index,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (attempt < 2) return fetchBlock(blob, index, attempt + 1);
      throw new Error(payload.message || `No se pudo procesar el bloque ${index}.`);
    }
    if (!String(payload.transcript || '').trim() || !String(payload.privacy_proof || '').trim()) {
      throw new Error(`El bloque ${index} no devolvió una transcripción privada verificable.`);
    }
    return payload;
  }

  function prefixedBlock(payload, index) {
    const idMap = new Map();
    const segments = (payload.segments || []).map((segment, position) => {
      const oldId = String(segment.id || `segment-${position + 1}`);
      const id = `b${index}-${oldId}`;
      idMap.set(oldId, id);
      return {
        ...segment,
        id,
        block_index: index,
        acoustic_speaker: `B${index}:${segment.acoustic_speaker || segment.speaker || '?'}`,
      };
    });
    const reviewItems = (payload.review_items || []).map((item) => ({
      ...item,
      segment_id: idMap.get(String(item.segment_id)) || `b${index}-${String(item.segment_id)}`,
      acoustic_speaker: `B${index}:${item.acoustic_speaker || '?'}`,
    }));
    return {
      index,
      transcript: String(payload.transcript).trim(),
      privacy_proof: String(payload.privacy_proof),
      segments,
      participants: Array.isArray(payload.participants) ? payload.participants : [],
      review_items: reviewItems,
      performance_ms: payload?.meta?.performance_ms || {},
    };
  }

  function markBlockFailure(index, error) {
    if (state.failed) return;
    state.failed = true;
    drainQueuedTasks();
    console.error('Long-interview block failed without logging clinical content.', error);
    const message = $('sessionMessage');
    if (message) message.textContent = `No se pudo asegurar el bloque ${index}: ${error.message}. La entrevista se detendrá y no se generará ningún documento incompleto.`;
    if (state.active) setTimeout(() => finishLongRecording(), 0);
  }

  function pumpBlockQueue() {
    while (!state.failed && state.inFlightBlocks < MAX_CONCURRENT_BLOCKS && state.taskQueue.length) {
      const task = state.taskQueue.shift();
      state.inFlightBlocks += 1;
      updateRecordingUi();

      (async () => {
        try {
          const payload = await fetchBlock(task.blob, task.index);
          state.processedBlocks.push(prefixedBlock(payload, task.index));
          state.processedBlocks.sort((a, b) => a.index - b.index);
          task.resolve({ ok: true });
        } catch (error) {
          task.resolve({ ok: false });
          markBlockFailure(task.index, error);
        } finally {
          state.inFlightBlocks = Math.max(0, state.inFlightBlocks - 1);
          state.pendingBlocks = Math.max(0, state.pendingBlocks - 1);
          updateRecordingUi();
          pumpBlockQueue();
        }
      })();
    }
  }

  function enqueueBlock(blob, index) {
    if (!blob || blob.size < MIN_BLOCK_BYTES) return null;
    if (state.pendingBlocks >= MAX_BUFFERED_BLOCKS) {
      markBlockFailure(index, new Error('La cola de procesamiento no puede seguir el ritmo de la entrevista.'));
      return null;
    }

    let resolveTask;
    const promise = new Promise((resolve) => { resolveTask = resolve; });
    state.taskPromises.push(promise);
    state.taskQueue.push({ blob, index, resolve: resolveTask });
    state.pendingBlocks += 1;
    state.peakPendingBlocks = Math.max(state.peakPendingBlocks, state.pendingBlocks);
    updateRecordingUi();
    pumpBlockQueue();
    return promise;
  }

  function startBlockRecorder() {
    if (!state.active || state.finishing || !state.stream) return;
    const recorder = makeRecorder();
    const parts = [];
    state.recorder = recorder;
    state.recorderParts = parts;

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) parts.push(event.data);
    });

    recorder.start(1000);
    state.blockTimer = setTimeout(() => {
      state.rotationPromise = rotateBlock().finally(() => { state.rotationPromise = null; });
    }, BLOCK_SECONDS * 1000);
  }

  function stopRecorderToBlob(recorder, parts) {
    return new Promise((resolve, reject) => {
      if (!recorder || recorder.state === 'inactive') {
        resolve(null);
        return;
      }
      const type = recorder.mimeType || state.mimeType || parts[0]?.type || 'audio/webm';
      recorder.addEventListener('error', () => reject(new Error('Falló el cierre de un bloque de audio.')), { once: true });
      recorder.addEventListener('stop', () => resolve(new Blob(parts, { type })), { once: true });
      try {
        recorder.stop();
      } catch (error) {
        reject(error);
      }
    });
  }

  async function rotateBlock() {
    if (!state.active || state.finishing) return;
    if (state.blockTimer) clearTimeout(state.blockTimer);
    state.blockTimer = null;

    const recorder = state.recorder;
    const parts = state.recorderParts;
    state.recorder = null;
    state.recorderParts = [];
    const index = ++state.blockIndex;
    const blob = await stopRecorderToBlob(recorder, parts);
    if (blob) enqueueBlock(blob, index);

    if (state.active && !state.finishing && !state.failed) startBlockRecorder();
  }

  function aggregatePayload() {
    const blocks = [...state.processedBlocks].sort((a, b) => a.index - b.index);
    const transcript = blocks.map((block) => block.transcript).filter(Boolean).join('\n').trim();
    const segments = blocks.flatMap((block) => block.segments);
    const reviewItems = blocks.flatMap((block) => block.review_items);
    const participantMap = new Map();
    for (const block of blocks) {
      for (const participant of block.participants) {
        const key = String(participant?.role || participant?.label || '');
        if (key && !participantMap.has(key)) participantMap.set(key, participant);
      }
    }
    return {
      transcript,
      segments,
      participants: [...participantMap.values()],
      review_items: reviewItems,
      meta: {
        automatic_role_attribution: true,
        long_interview: true,
        block_count: blocks.length,
        critical_role_review_count: reviewItems.length,
        speaker_role_confirmation_required: reviewItems.length > 0,
      },
    };
  }

  function startSpeculativeAnalysis(transcript) {
    const cache = window.__CLINICAL_ANALYSIS_PREFETCH;
    if (!(cache instanceof Map) || !transcript || cache.has(transcript)) return;
    state.analysisPrefetchStarted = true;
    const pending = fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    }).then(async (response) => ({
      status: response.status,
      statusText: response.statusText,
      payload: await response.json().catch(() => ({})),
    })).catch(() => null);
    cache.set(transcript, pending.then((snapshot) => snapshot || {
      status: 503,
      statusText: 'Long-interview prefetch failed',
      payload: { message: 'No se pudo completar el análisis anticipado.' },
    }));
  }

  function publishAggregate() {
    const aggregate = aggregatePayload();
    if (!aggregate.transcript) throw new Error('No se obtuvo texto clínico de los bloques procesados.');

    state.finalTranscript = aggregate.transcript;
    const verifiedBlocks = [...state.processedBlocks]
      .sort((a, b) => a.index - b.index)
      .map((block) => ({ transcript: block.transcript, privacy_proof: block.privacy_proof }));

    window.__LONG_INTERVIEW_TRANSCRIPT = aggregate.transcript;
    window.__LONG_INTERVIEW_VERIFIED_BLOCKS = verifiedBlocks;
    if ($('caseText')) $('caseText').value = aggregate.transcript;

    window.dispatchEvent(new CustomEvent('clinical-long-attribution-ready', { detail: aggregate }));
    startSpeculativeAnalysis(aggregate.transcript);

    const totalAudioMs = state.processedBlocks.reduce((sum, block) => sum + Number(block.performance_ms?.total_audio_pipeline || 0), 0);
    const closeMs = state.finalizationStartedAt ? Math.max(0, performance.now() - state.finalizationStartedAt) : 0;
    const status = $('recordingStatus');
    if (status) status.textContent = `Entrevista cerrada · ${state.processedBlocks.length} bloques desidentificados · audio descartado. Procesamiento acumulado del servidor: ${(totalAudioMs / 1000).toFixed(1)} s, realizado durante la entrevista. Cierre tras Finalizar: ${(closeMs / 1000).toFixed(1)} s. Pico de cola: ${state.peakPendingBlocks}.`;
    const message = $('sessionMessage');
    if (message) message.textContent = 'Transcripción larga desidentificada lista. Revisa únicamente las fuentes críticas señaladas antes de organizar.';
  }

  async function finishLongRecording() {
    if (state.finishing) return;
    state.finishing = true;
    state.active = false;
    state.finalizationStartedAt = performance.now();
    clearTimers();
    setButton('processing');
    if ($('recordingStatus')) $('recordingStatus').textContent = 'Cerrando el último bloque y esperando solo el procesamiento pendiente…';

    try {
      if (state.rotationPromise) await state.rotationPromise;
      if (state.recorder?.state === 'recording') {
        const recorder = state.recorder;
        const parts = state.recorderParts;
        state.recorder = null;
        state.recorderParts = [];
        const index = ++state.blockIndex;
        const blob = await stopRecorderToBlob(recorder, parts);
        if (blob) enqueueBlock(blob, index);
      }
      stopTracks();
      await Promise.all(state.taskPromises);

      if (state.failed) {
        invalidateVerifiedBlocks();
        if ($('caseText')) $('caseText').value = '';
        if ($('recordingStatus')) $('recordingStatus').textContent = 'Sesión detenida: al menos un bloque no pudo verificarse. No se conserva audio ni se genera un documento incompleto.';
        return;
      }
      publishAggregate();
    } catch (error) {
      console.error('Long-interview finalization failed without logging clinical content.', error);
      invalidateVerifiedBlocks();
      if ($('caseText')) $('caseText').value = '';
      if ($('sessionMessage')) $('sessionMessage').textContent = `No se pudo cerrar la entrevista larga: ${error.message}`;
    } finally {
      state.finishing = false;
      setButton('idle');
    }
  }

  async function startLongRecording() {
    if (state.active || state.finishing) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      if ($('recordingStatus')) $('recordingStatus').textContent = 'Este navegador no ofrece acceso al micrófono.';
      return;
    }

    resetState({ keepText: false });
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      state.mimeType = chooseRecorderMimeType();
      state.active = true;
      state.startedAt = Date.now();
      setButton('recording');
      startBlockRecorder();
      updateRecordingUi();
      state.uiTimer = setInterval(updateRecordingUi, 500);
      state.maxTimer = setTimeout(() => finishLongRecording(), MAX_SESSION_SECONDS * 1000);
      if ($('sessionMessage')) $('sessionMessage').textContent = '';
    } catch (error) {
      console.error('Long-interview microphone start failed without recording data.', error);
      resetState({ keepText: false });
      setButton('idle');
      if ($('recordingStatus')) $('recordingStatus').textContent = 'No se pudo acceder al micrófono. Revisa el permiso del navegador.';
    }
  }

  const inheritedFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const method = String(init?.method || 'GET').toUpperCase();
    if (method === 'POST' && /\/api\/analyze(?:$|[?#])/i.test(url) && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        const transcript = typeof body?.transcript === 'string' ? body.transcript.trim() : '';
        const expected = String(window.__LONG_INTERVIEW_TRANSCRIPT || '').trim();
        const blocks = window.__LONG_INTERVIEW_VERIFIED_BLOCKS;
        if (transcript && transcript === expected && Array.isArray(blocks) && blocks.length) {
          init = { ...init, body: JSON.stringify({ ...body, verified_blocks: blocks }) };
        }
      } catch {
        // El backend volverá a aplicar desidentificación completa si el atajo no es verificable.
      }
    }
    return inheritedFetch(input, init);
  };

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('#recordButton') : null;
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (state.active) finishLongRecording();
    else if (!state.finishing) startLongRecording();
  }, true);

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('#destroyInput, #destroySession') : null;
    if (!target) return;
    resetState({ keepText: false });
  }, true);

  $('caseText')?.addEventListener('input', () => {
    const value = $('caseText')?.value?.trim() || '';
    if (state.finalTranscript && value !== state.finalTranscript) invalidateVerifiedBlocks();
  });

  window.addEventListener('pagehide', () => resetState({ keepText: false }));

  const recorderCard = document.querySelector('.recorder-card');
  const sectionLabel = recorderCard?.querySelector('.section-label');
  const description = recorderCard?.querySelector('.muted');
  if (sectionLabel) sectionLabel.textContent = 'ENTRADA DESDE MÓVIL · PILOTO V0.6';
  if (description) description.textContent = 'Entrevista larga de prueba, hasta 30 minutos. El navegador rota bloques de aproximadamente 20 segundos y procesa hasta dos a la vez; cada bloque se diariza, desidentifica y descarta de memoria mientras la entrevista continúa.';
  setButton('idle');
  if ($('recordingStatus')) $('recordingStatus').textContent = 'Micrófono preparado para entrevista ficticia larga por bloques de 20 s.';
})();