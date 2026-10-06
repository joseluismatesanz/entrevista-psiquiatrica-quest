(() => {
  const baseUrl = String(window.CLINICAL_API_URL || '').replace(/\/+$/, '');
  if (!baseUrl || typeof MediaRecorder === 'undefined') return;

  const BLOCK_SECONDS = 60;
  const MAX_SESSION_SECONDS = 60 * 60;
  const MAX_CONCURRENT_BLOCKS = 3;
  const MAX_BUFFERED_BLOCKS = 128;
  const MAX_CONCURRENT_EVIDENCE_BLOCKS = 1;
  const EVIDENCE_WAIT_MS = 3500;
  const EVIDENCE_REQUEST_TIMEOUT_MS = 90_000;
  const MAX_BLOCK_BYTES = 3_000_000;
  const MIN_BLOCK_BYTES = 256;
  const BLOCK_REQUEST_TIMEOUT_MS = 150_000;
  const FINALIZATION_TIMEOUT_MS = 300_000;
  const RECORDER_STOP_TIMEOUT_MS = 6_000;
  const MAX_BLOCK_ATTEMPTS = 2;
  const FINAL_RETRY_ATTEMPTS = 2;
  const RETRY_BASE_DELAY_MS = 1_500;

  const $ = (id) => document.getElementById(id);
  const state = {
    active: false,
    finishing: false,
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
    failedBlocks: new Map(),
    captureFailures: [],
    evidenceByBlock: new Map(),
    evidencePromises: [],
    evidencePending: 0,
    evidenceInFlight: 0,
    evidenceQueue: [],
    rotationPromise: null,
    blockTimer: null,
    uiTimer: null,
    maxTimer: null,
    finalTranscript: '',
    analysisPrefetchStarted: false,
    finalizationStartedAt: 0,
    peakPendingBlocks: 0,
    sessionAbortController: null,
  };

  function formatClock(seconds) {
    const safe = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  }

  function chooseRecorderMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
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
    window.__LONG_INTERVIEW_EVIDENCE = null;
    window.__LONG_INTERVIEW_EVIDENCE_READY = null;
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
    state.sessionAbortController?.abort(new DOMException('Sesión finalizada.', 'AbortError'));
    stopTracks();
    drainQueuedTasks();
    state.active = false;
    state.finishing = false;
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
    state.failedBlocks = new Map();
    state.captureFailures = [];
    state.evidenceByBlock = new Map();
    state.evidencePromises = [];
    state.evidencePending = 0;
    state.evidenceInFlight = 0;
    state.evidenceQueue = [];
    state.rotationPromise = null;
    state.finalTranscript = '';
    state.analysisPrefetchStarted = false;
    state.finalizationStartedAt = 0;
    state.peakPendingBlocks = 0;
    state.sessionAbortController = null;
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
    if (mode === 'recording') label.textContent = 'Finalizar entrevista';
    else if (mode === 'processing') {
      label.textContent = 'Cerrando entrevista…';
      detail.textContent = 'Procesando últimos bloques';
    } else {
      label.textContent = 'Iniciar entrevista';
      detail.textContent = 'Hasta 60 min';
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
      const recovery = state.failedBlocks.size ? ` · ${state.failedBlocks.size} por recuperar` : '';
      const evidence = state.evidencePending ? ` · ${state.evidencePending} clasificando` : '';
      status.textContent = `Grabando · ${safe} bloque${safe === 1 ? '' : 's'} seguro${safe === 1 ? '' : 's'} · ${processing} transcribiendo${waiting ? ` · ${waiting} en cola` : ''}${recovery}${evidence}.`;
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

  function isRetriableStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  function isRetriableRequestError(error) {
    return error?.code === 'request_timeout' || error?.name === 'TypeError';
  }

  function waitBeforeRetry(attempt) {
    const delayMs = Math.min(8_000, RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1)));
    return new Promise((resolve, reject) => {
      const signal = state.sessionAbortController?.signal;
      if (signal?.aborted) return reject(signal.reason || new DOMException('Solicitud cancelada.', 'AbortError'));
      let timer = null;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(signal.reason || new DOMException('Solicitud cancelada.', 'AbortError'));
      };
      timer = setTimeout(() => {
        cleanup();
        resolve();
      }, delayMs);
      signal?.addEventListener?.('abort', onAbort, { once: true });
    });
  }

  async function fetchBlock(blob, index, { maxAttempts = MAX_BLOCK_ATTEMPTS } = {}) {
    if (blob.size > MAX_BLOCK_BYTES) throw new Error(`El bloque ${index} supera el tamaño permitido.`);
    const audioBase64 = await blobToBase64(blob);
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;
      try {
        response = await window.ClinicalRequest.fetchWithDeadline(`${baseUrl}/api/transcribe-block`, {
          method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audio_base64: audioBase64,
            mime_type: blob.type || state.mimeType || 'audio/webm',
            long_interview_block: true,
            block_index: index,
          }),
          signal: state.sessionAbortController?.signal,
        }, {
          timeoutMs: BLOCK_REQUEST_TIMEOUT_MS,
          label: `La transcripción del bloque ${index}`,
        });
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isRetriableRequestError(error)) throw error;
        await waitBeforeRetry(attempt);
        continue;
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = new Error(payload.message || `No se pudo procesar el bloque ${index}.`);
        if (attempt >= maxAttempts || !isRetriableStatus(response.status)) throw lastError;
        await waitBeforeRetry(attempt);
        continue;
      }
      if (!String(payload.transcript || '').trim() || !String(payload.privacy_proof || '').trim()) {
        lastError = new Error(`El bloque ${index} no devolvió una transcripción privada verificable.`);
        if (attempt >= maxAttempts) throw lastError;
        await waitBeforeRetry(attempt);
        continue;
      }
      return payload;
    }

    throw lastError || new Error(`No se pudo procesar el bloque ${index}.`);
  }

  function prefixedBlock(payload, index) {
    const idMap = new Map();
    const segments = (payload.segments || []).map((segment, position) => {
      const oldId = String(segment.id || `segment-${position + 1}`);
      const id = `b${index}-${oldId}`;
      idMap.set(oldId, id);
      return { ...segment, id, block_index: index, acoustic_speaker: `B${index}:${segment.acoustic_speaker || segment.speaker || '?'}` };
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

  function publishEvidenceWindow() {
    if (state.evidenceByBlock.size !== state.processedBlocks.length || !state.processedBlocks.length) {
      window.__LONG_INTERVIEW_EVIDENCE = null;
      return null;
    }
    const evidence = [...state.processedBlocks]
      .sort((a, b) => a.index - b.index)
      .map((block) => state.evidenceByBlock.get(block.index))
      .filter(Boolean);
    if (evidence.length !== state.processedBlocks.length) {
      window.__LONG_INTERVIEW_EVIDENCE = null;
      return null;
    }
    window.__LONG_INTERVIEW_EVIDENCE = evidence;
    return evidence;
  }

  async function fetchEvidence(block) {
    const response = await window.ClinicalRequest.fetchWithDeadline(`${baseUrl}/api/extract-block-evidence`, {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        block_index: block.index,
        transcript: block.transcript,
        privacy_proof: block.privacy_proof,
      }),
    }, {
      timeoutMs: EVIDENCE_REQUEST_TIMEOUT_MS,
      label: `La preparación clínica del bloque ${block.index}`,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !String(payload.clinical_transcript || '').trim() || !String(payload.evidence_proof || '').trim()) return null;
    return {
      block_index: block.index,
      clinical_transcript: String(payload.clinical_transcript).trim(),
      evidence_proof: String(payload.evidence_proof),
      performance_ms: payload?.meta?.performance_ms || {},
    };
  }

  function pumpEvidenceQueue() {
    // Esta extracción es una optimización opcional. Se limita a una petición y
    // solo avanza cuando no hay audio esperando: la transcripción tiene prioridad.
    while (
      state.evidenceInFlight < MAX_CONCURRENT_EVIDENCE_BLOCKS
      && state.evidenceQueue.length
      && state.pendingBlocks === 0
      && state.inFlightBlocks === 0
    ) {
      const task = state.evidenceQueue.shift();
      state.evidenceInFlight += 1;
      (async () => {
        try {
          const evidence = await fetchEvidence(task.block);
          if (evidence) state.evidenceByBlock.set(task.block.index, evidence);
          publishEvidenceWindow();
          task.resolve(evidence);
        } catch {
          task.resolve(null);
        } finally {
          state.evidenceInFlight = Math.max(0, state.evidenceInFlight - 1);
          state.evidencePending = Math.max(0, state.evidencePending - 1);
          updateRecordingUi();
          pumpEvidenceQueue();
        }
      })();
    }
  }

  function startEvidenceExtraction(block) {
    state.evidencePending += 1;
    let resolveTask;
    const promise = new Promise((resolve) => { resolveTask = resolve; });
    state.evidencePromises.push(promise);
    state.evidenceQueue.push({ block, resolve: resolveTask });
    pumpEvidenceQueue();
    return promise;
  }

  function storeProcessedBlock(payload, index) {
    if (state.processedBlocks.some((block) => block.index === index)) return;
    const block = prefixedBlock(payload, index);
    state.processedBlocks.push(block);
    state.processedBlocks.sort((a, b) => a.index - b.index);
    state.failedBlocks.delete(index);
    startEvidenceExtraction(block);
  }

  function rememberBlockFailure(blob, index, error) {
    state.failedBlocks.set(index, { blob, index, error });
    console.warn('Long-interview block retained in volatile memory for retry without logging clinical content.', {
      blockIndex: index,
      errorName: error?.name || 'Error',
    });
    const message = $('sessionMessage');
    if (message && state.active) {
      message.textContent = 'La grabación continúa. Hay un bloque pendiente que se volverá a intentar antes de cerrar la entrevista.';
    }
  }

  function pumpBlockQueue() {
    while (state.inFlightBlocks < MAX_CONCURRENT_BLOCKS && state.taskQueue.length) {
      const task = state.taskQueue.shift();
      state.inFlightBlocks += 1;
      updateRecordingUi();
      (async () => {
        try {
          const payload = await fetchBlock(task.blob, task.index);
          storeProcessedBlock(payload, task.index);
          task.resolve({ ok: true });
        } catch (error) {
          task.resolve({ ok: false });
          rememberBlockFailure(task.blob, task.index, error);
        } finally {
          state.inFlightBlocks = Math.max(0, state.inFlightBlocks - 1);
          state.pendingBlocks = Math.max(0, state.pendingBlocks - 1);
          updateRecordingUi();
          pumpBlockQueue();
          pumpEvidenceQueue();
        }
      })();
    }
  }

  function enqueueBlock(blob, index) {
    if (!blob) return null;
    if (blob.size < MIN_BLOCK_BYTES) {
      state.captureFailures.push({ index, message: 'El bloque de audio recibido era demasiado pequeño para verificarse.' });
      return null;
    }
    if (state.pendingBlocks >= MAX_BUFFERED_BLOCKS) {
      rememberBlockFailure(blob, index, new Error('La cola de procesamiento está temporalmente llena.'));
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

  async function retryFailedBlocksAtClose() {
    const retryQueue = [...state.failedBlocks.values()].sort((a, b) => a.index - b.index);
    if (!retryQueue.length) return;
    state.failedBlocks.clear();
    let cursor = 0;
    const workerCount = Math.min(MAX_CONCURRENT_BLOCKS, retryQueue.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < retryQueue.length) {
        const item = retryQueue[cursor++];
        const status = $('recordingStatus');
        if (status) status.textContent = `Recuperando bloques pendientes antes de cerrar · ${Math.max(0, retryQueue.length - cursor + 1)} restantes…`;
        try {
          const payload = await fetchBlock(item.blob, item.index, { maxAttempts: FINAL_RETRY_ATTEMPTS });
          storeProcessedBlock(payload, item.index);
        } catch (error) {
          rememberBlockFailure(item.blob, item.index, error);
        }
      }
    });
    await Promise.all(workers);
  }

  async function settleAllBlocks() {
    await Promise.all([...state.taskPromises]);
    await retryFailedBlocksAtClose();
    if (state.captureFailures.length) {
      throw new Error('El navegador interrumpió al menos un bloque de audio y no puede garantizarse una entrevista completa.');
    }
    if (state.failedBlocks.size) {
      const failed = [...state.failedBlocks.keys()].sort((a, b) => a - b).join(', ');
      throw new Error(`No se pudieron verificar todos los bloques (pendientes: ${failed}).`);
    }
  }

  function startBlockRecorder() {
    if (!state.active || state.finishing || !state.stream) return;
    const recorder = makeRecorder();
    const parts = [];
    state.recorder = recorder;
    state.recorderParts = parts;
    recorder.addEventListener('dataavailable', (event) => { if (event.data?.size) parts.push(event.data); });
    recorder.addEventListener('stop', () => {
      // Algunos navegadores móviles detienen MediaRecorder sin que la pista del
      // micrófono termine. Conservamos lo ya capturado y reiniciamos el bloque
      // inmediatamente; las paradas deliberadas ya desacoplan state.recorder.
      if (!state.active || state.finishing || state.recorder !== recorder) return;
      if (state.blockTimer) clearTimeout(state.blockTimer);
      state.blockTimer = null;
      state.recorder = null;
      state.recorderParts = [];
      const type = recorder.mimeType || state.mimeType || parts[0]?.type || 'audio/webm';
      const blob = parts.length ? new Blob(parts, { type }) : null;
      const index = ++state.blockIndex;
      if (blob) enqueueBlock(blob, index);
      else state.captureFailures.push({ index, message: 'El grabador móvil se detuvo sin entregar audio.' });
      if (state.active && !state.finishing) startBlockRecorder();
    });
    recorder.start(1000);
    state.blockTimer = setTimeout(() => {
      state.rotationPromise = rotateBlock().finally(() => { state.rotationPromise = null; });
    }, BLOCK_SECONDS * 1000);
  }

  function stopRecorderToBlob(recorder, parts) {
    return new Promise((resolve, reject) => {
      if (!recorder) return resolve(null);
      const type = recorder.mimeType || state.mimeType || parts[0]?.type || 'audio/webm';
      if (recorder.state === 'inactive') return resolve(parts.length ? new Blob(parts, { type }) : null);
      let settled = false;
      let timer = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        recorder.removeEventListener?.('error', onError);
        recorder.removeEventListener?.('stop', onStop);
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const onError = () => finish(reject, new Error('Falló el cierre de un bloque de audio.'));
      const onStop = () => finish(resolve, parts.length ? new Blob(parts, { type }) : null);
      recorder.addEventListener('error', onError, { once: true });
      recorder.addEventListener('stop', onStop, { once: true });
      timer = setTimeout(() => {
        try { if (recorder.state !== 'inactive') recorder.stop(); } catch {}
        if (parts.length) finish(resolve, new Blob(parts, { type }));
        else finish(reject, new Error('El grabador no entregó el último bloque de audio a tiempo.'));
      }, RECORDER_STOP_TIMEOUT_MS);
      try { recorder.requestData?.(); } catch {}
      try { recorder.stop(); } catch (error) { finish(reject, error); }
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
    try {
      const blob = await stopRecorderToBlob(recorder, parts);
      if (blob) enqueueBlock(blob, index);
      else state.captureFailures.push({ index, message: 'El bloque de audio estaba vacío.' });
    } catch (error) {
      state.captureFailures.push({ index, message: error.message });
      console.warn('Long-interview recorder rotation failed without logging clinical content.', {
        blockIndex: index,
        errorName: error?.name || 'Error',
      });
    }
    if (state.active && !state.finishing) startBlockRecorder();
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
      transcript, segments, participants: [...participantMap.values()], review_items: reviewItems,
      meta: {
        automatic_role_attribution: true,
        long_interview: true,
        block_count: blocks.length,
        expected_block_count: state.blockIndex,
        critical_role_review_count: reviewItems.length,
        speaker_role_confirmation_required: reviewItems.length > 0,
      },
    };
  }

  async function waitForEvidenceBriefly() {
    if (!state.evidencePromises.length || state.evidenceByBlock.size === state.processedBlocks.length) return;
    await Promise.race([
      Promise.allSettled([...state.evidencePromises]),
      new Promise((resolve) => setTimeout(resolve, EVIDENCE_WAIT_MS)),
    ]);
    publishEvidenceWindow();
  }

  function startSpeculativeAnalysis(transcript) {
    const cache = window.__CLINICAL_ANALYSIS_PREFETCH;
    if (!(cache instanceof Map) || !transcript || cache.has(transcript)) return;
    state.analysisPrefetchStarted = true;
    const pending = fetch(`${baseUrl}/api/analyze`, {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    }).then(async (response) => ({
      status: response.status,
      statusText: response.statusText,
      payload: await response.json().catch(() => ({})),
    })).catch(() => null);
    cache.set(transcript, pending.then((snapshot) => snapshot || {
      status: 503, statusText: 'Long-interview prefetch failed', payload: { message: 'No se pudo completar el análisis anticipado.' },
    }));
  }

  function publishAggregate() {
    const aggregate = aggregatePayload();
    if (!aggregate.transcript) throw new Error('No se obtuvo texto clínico de los bloques procesados.');
    const expectedIndexes = Array.from({ length: state.blockIndex }, (_, position) => position + 1);
    const processedIndexes = new Set(state.processedBlocks.map((block) => block.index));
    const missingIndexes = expectedIndexes.filter((index) => !processedIndexes.has(index));
    if (missingIndexes.length) {
      throw new Error(`Faltan bloques de audio antes de publicar la transcripción (${missingIndexes.join(', ')}).`);
    }
    state.finalTranscript = aggregate.transcript;
    const verifiedBlocks = [...state.processedBlocks].sort((a, b) => a.index - b.index).map((block) => ({
      block_index: block.index,
      transcript: block.transcript,
      privacy_proof: block.privacy_proof,
    }));
    window.__LONG_INTERVIEW_TRANSCRIPT = aggregate.transcript;
    window.__LONG_INTERVIEW_VERIFIED_BLOCKS = verifiedBlocks;
    publishEvidenceWindow();

    // Todas las extracciones ya se han iniciado antes de publicar el agregado. La
    // compuerta de análisis puede esperar esta promesa exacta en vez de sondear
    // durante un plazo fijo. Si alguna extracción falla, allSettled termina igual
    // y publishEvidenceWindow conserva el fallback seguro (evidencia = null).
    window.__LONG_INTERVIEW_EVIDENCE_READY = Promise
      .allSettled([...state.evidencePromises])
      .then(() => publishEvidenceWindow());

    if ($('caseText')) $('caseText').value = aggregate.transcript;
    window.dispatchEvent(new CustomEvent('clinical-long-attribution-ready', { detail: aggregate }));
    startSpeculativeAnalysis(aggregate.transcript);

    const totalAudioMs = state.processedBlocks.reduce((sum, block) => sum + Number(block.performance_ms?.total_audio_pipeline || 0), 0);
    const closeMs = state.finalizationStartedAt ? Math.max(0, performance.now() - state.finalizationStartedAt) : 0;
    const status = $('recordingStatus');
    if (status) status.textContent = `Entrevista cerrada · ${state.processedBlocks.length} bloques desidentificados · audio descartado. Servidor acumulado: ${(totalAudioMs / 1000).toFixed(1)} s durante la entrevista. Cierre tras Finalizar: ${(closeMs / 1000).toFixed(1)} s. Pico de cola: ${state.peakPendingBlocks}. Evidencia clínica preparada: ${state.evidenceByBlock.size}/${state.processedBlocks.length}.`;
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
    if ($('recordingStatus')) $('recordingStatus').textContent = 'Cerrando el último bloque y esperando solo la transcripción pendiente…';
    try {
      if (state.rotationPromise) await state.rotationPromise;
      if (state.recorder && state.recorder.state !== 'inactive') {
        const recorder = state.recorder;
        const parts = state.recorderParts;
        state.recorder = null;
        state.recorderParts = [];
        const index = ++state.blockIndex;
        const blob = await stopRecorderToBlob(recorder, parts);
        if (blob) enqueueBlock(blob, index);
      }
      stopTracks();
      await window.ClinicalRequest.waitWithDeadline(settleAllBlocks(), {
        timeoutMs: FINALIZATION_TIMEOUT_MS,
        label: 'El cierre completo de la entrevista',
      });
      publishAggregate();
      state.sessionAbortController = null;
    } catch (error) {
      state.sessionAbortController?.abort(error);
      drainQueuedTasks();
      console.error('Long-interview finalization failed without logging clinical content.', error);
      invalidateVerifiedBlocks();
      if ($('caseText')) $('caseText').value = '';
      if ($('sessionMessage')) $('sessionMessage').textContent = `No se pudo cerrar la entrevista larga: ${error.message}`;
      if ($('recordingStatus')) $('recordingStatus').textContent = 'No se conserva audio ni se genera un documento incompleto. Puedes iniciar una nueva entrevista.';
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
      state.sessionAbortController = new AbortController();
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
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
          await waitForEvidenceBriefly();
          const evidence = window.__LONG_INTERVIEW_EVIDENCE;
          init = {
            ...init,
            body: JSON.stringify({
              ...body,
              verified_blocks: blocks,
              ...(Array.isArray(evidence) && evidence.length === blocks.length ? { verified_evidence: evidence } : {}),
            }),
          };
        }
      } catch {
        // El backend conserva el camino completo si el acelerador incremental no está disponible.
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
  if (sectionLabel) sectionLabel.textContent = 'ENTREVISTA CLÍNICA';
  if (description) description.textContent = 'Graba una entrevista de hasta 60 minutos. La transcripción se organiza progresivamente mientras continúa la entrevista.';
  setButton('idle');
  if ($('recordingStatus')) $('recordingStatus').textContent = 'Micrófono preparado.';
})();
