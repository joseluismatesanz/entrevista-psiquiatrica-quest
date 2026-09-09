(() => {
  const baseUrl = String(window.CLINICAL_API_URL || '').replace(/\/+$/, '');
  if (!baseUrl) return;

  const $ = (id) => document.getElementById(id);
  const MAX_AUDIO_SECONDS = 120;
  const MAX_AUDIO_BYTES = 3_000_000;
  const state = {
    result: null,
    health: null,
    recorder: null,
    stream: null,
    audioChunks: [],
    recordingStartedAt: 0,
    timerId: null,
    autoStopId: null,
    diarized: null,
  };

  const DEMO_TEXT = `PSIQUIATRA: ¿Por qué venís hoy?\nPACIENTE: Ayer me hice varios cortes superficiales en el antebrazo izquierdo después de discutir con mi madre. No quería morirme, quería dejar de sentirme tan agobiada.\nMADRE: Dijo que no quería seguir viviendo y lleva unas seis semanas más triste, aislada y durmiendo mal.\nPSIQUIATRA: ¿Has pensado en matarte o en cómo hacerlo?\nPACIENTE: El domingo abrí el cajón donde están las pastillas y las miré, pero no tomé ninguna. Ahora no quiero morirme y no tengo intención ni plan.\nPSIQUIATRA: ¿Qué tratamiento tomas y con qué regularidad?\nPACIENTE: Sertralina 50 mg por la mañana, pero estas últimas semanas la tomo unos cuatro días de siete.\nPSIQUIATRA: Mantendremos sertralina 50 mg por la mañana, con administración supervisada, retomaremos psicoterapia y revisión en una semana.`;

  const SECTION_TITLES = {
    motivo_consulta: 'MOTIVO DE LA CONSULTA',
    psq_guardia: 'PSQ GUARDIA',
    alergias_ram: 'ALERGIAS / RAM',
    antecedentes_somaticos: 'ANTECEDENTES PERSONALES SOMÁTICOS',
    antecedentes_salud_mental: 'ANTECEDENTES PERSONALES EN SALUD MENTAL',
    antecedentes_familiares_psiquiatricos: 'ANTECEDENTES FAMILIARES PSIQUIÁTRICOS',
    situacion_sociofamiliar: 'SITUACIÓN SOCIOFAMILIAR',
    habitos_toxicos: 'HÁBITOS TÓXICOS',
    tratamiento_habitual: 'TRATAMIENTO HABITUAL',
    enfermedad_actual: 'ENFERMEDAD ACTUAL',
    intervencion: 'INTERVENCIÓN',
    exploracion_psicopatologica: 'EXPLORACIÓN PSICOPATOLÓGICA',
    orientacion_diagnostica: 'ORIENTACIÓN DIAGNÓSTICA',
    plan_terapeutico: 'PLAN TERAPÉUTICO',
    tratamiento_actual: 'TRATAMIENTO ACTUAL',
  };

  const SPEAKER_ROLES = [
    ['', 'Seleccionar…'],
    ['PSIQUIATRA', 'Psiquiatra'],
    ['PACIENTE', 'Paciente'],
    ['MADRE', 'Madre'],
    ['PADRE', 'Padre'],
    ['HERMANO', 'Hermano'],
    ['HERMANA', 'Hermana'],
    ['CUIDADOR', 'Cuidador/a'],
    ['ENFERMERA', 'Enfermería'],
    ['POLICÍA', 'Policía'],
    ['SEGURIDAD', 'Seguridad'],
    ['OTRO', 'Otro interlocutor'],
  ];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[c]);
  }

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((x) => x.classList.remove('active'));
    const target = $(`screen-${name}`);
    if (target) target.classList.add('active');
    document.querySelectorAll('.step').forEach((x) => x.classList.toggle('active', x.dataset.step === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function formatClock(seconds) {
    const safe = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  }

  function setRecordButton(mode, detail = '') {
    const button = $('recordButton');
    const label = $('recordButtonLabel');
    const status = $('recordButtonStatus');
    if (!button || !label || !status) return;

    button.classList.toggle('recording', mode === 'recording');
    button.classList.toggle('processing', mode === 'processing');
    button.setAttribute('aria-pressed', mode === 'recording' ? 'true' : 'false');
    button.disabled = mode === 'processing';

    if (mode === 'recording') {
      label.textContent = 'Finalizar entrevista';
      status.textContent = detail || 'Grabando…';
    } else if (mode === 'processing') {
      label.textContent = 'Transcribiendo…';
      status.textContent = detail || 'Audio efímero en proceso';
    } else {
      label.textContent = 'Iniciar entrevista';
      status.textContent = detail || 'Máx. 2 min · audio ficticio';
    }
  }

  function stopMediaTracks() {
    for (const track of state.stream?.getTracks?.() || []) track.stop();
    state.stream = null;
  }

  function clearRecordingTimers() {
    if (state.timerId) clearInterval(state.timerId);
    if (state.autoStopId) clearTimeout(state.autoStopId);
    state.timerId = null;
    state.autoStopId = null;
  }

  function clearAudioMappingState() {
    state.diarized = null;
    $('speakerMappingCard')?.classList.add('hidden');
    if ($('speakerMappingFields')) $('speakerMappingFields').innerHTML = '';
    if ($('speakerMappingMessage')) $('speakerMappingMessage').textContent = '';
  }

  function chooseRecorderMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
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
      reader.onerror = () => reject(new Error('No se pudo preparar el audio para transcripción.'));
      reader.onload = () => {
        const value = String(reader.result || '');
        resolve(value.includes(',') ? value.slice(value.indexOf(',') + 1) : value);
      };
      reader.readAsDataURL(blob);
    });
  }

  function renderSpeakerMapping(payload) {
    state.diarized = payload;
    const card = $('speakerMappingCard');
    const fields = $('speakerMappingFields');
    if (!card || !fields) return;

    fields.innerHTML = (payload.speakers || []).map((speaker) => {
      const options = SPEAKER_ROLES.map(([value, label]) =>
        `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`
      ).join('');
      const sample = (payload.segments || []).find((segment) => segment.speaker === speaker)?.text || '';
      return `<label class="speaker-row">
        <span><b>Voz ${escapeHtml(speaker)}</b><small>${escapeHtml(sample.slice(0, 110))}</small></span>
        <select data-speaker="${escapeHtml(speaker)}" aria-label="Rol de voz ${escapeHtml(speaker)}">${options}</select>
      </label>`;
    }).join('');

    card.classList.remove('hidden');
    $('speakerMappingMessage').textContent = 'Confirma todos los interlocutores antes del análisis clínico.';
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function transcribeRecordedBlob(blob) {
    setRecordButton('processing');
    $('recordingStatus').textContent = 'Enviando audio efímero para transcripción y diarización…';

    try {
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

      $('caseText').value = payload.transcript || '';
      renderSpeakerMapping(payload);
      $('sessionMessage').textContent = 'Transcripción diarizada lista. Revisa el texto y asigna quién es cada voz.';
      $('recordingStatus').textContent = 'Audio descartado de la memoria de la sesión tras obtener la transcripción.';
    } catch (error) {
      console.error('Audio transcription failed without logging audio.', error);
      $('sessionMessage').textContent = `No se pudo completar la transcripción: ${error.message}`;
      $('recordingStatus').textContent = 'No se conserva el audio de la prueba fallida.';
      clearAudioMappingState();
    } finally {
      state.audioChunks = [];
      setRecordButton('idle');
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      $('recordingStatus').textContent = 'Este navegador no ofrece la captura de audio necesaria para el piloto.';
      return;
    }

    clearAudioMappingState();
    state.result = null;
    $('sessionMessage').textContent = '';

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

      const mimeType = chooseRecorderMimeType();
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
      state.audioChunks = [];
      state.recordingStartedAt = Date.now();

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) state.audioChunks.push(event.data);
      });

      recorder.addEventListener('stop', async () => {
        clearRecordingTimers();
        stopMediaTracks();
        const chunks = state.audioChunks;
        const type = recorder.mimeType || mimeType || chunks[0]?.type || 'audio/webm';
        state.recorder = null;
        const blob = new Blob(chunks, { type });
        await transcribeRecordedBlob(blob);
      }, { once: true });

      recorder.start(1000);
      setRecordButton('recording', `00:00 / ${formatClock(MAX_AUDIO_SECONDS)}`);
      $('recordingStatus').textContent = 'Grabando audio ficticio. Pulsa de nuevo para finalizar.';

      state.timerId = setInterval(() => {
        const elapsed = Math.min(MAX_AUDIO_SECONDS, (Date.now() - state.recordingStartedAt) / 1000);
        setRecordButton('recording', `${formatClock(elapsed)} / ${formatClock(MAX_AUDIO_SECONDS)}`);
      }, 500);

      state.autoStopId = setTimeout(() => {
        if (state.recorder?.state === 'recording') state.recorder.stop();
      }, MAX_AUDIO_SECONDS * 1000);
    } catch (error) {
      console.error('Microphone start failed without recording data.', error);
      clearRecordingTimers();
      stopMediaTracks();
      state.recorder = null;
      state.audioChunks = [];
      setRecordButton('idle');
      $('recordingStatus').textContent = 'No se pudo acceder al micrófono. Revisa el permiso del navegador.';
    }
  }

  function stopRecording() {
    if (state.recorder?.state === 'recording') {
      $('recordingStatus').textContent = 'Finalizando la grabación…';
      state.recorder.stop();
    }
  }

  function applySpeakerMapping() {
    if (!state.diarized?.segments?.length) return;
    const selects = [...document.querySelectorAll('#speakerMappingFields select[data-speaker]')];
    const mapping = new Map();

    for (const select of selects) {
      if (!select.value) {
        $('speakerMappingMessage').textContent = 'Falta asignar al menos una voz.';
        select.focus();
        return;
      }
      mapping.set(select.dataset.speaker, select.value);
    }

    $('caseText').value = state.diarized.segments
      .map((segment) => `${mapping.get(segment.speaker) || `HABLANTE ${segment.speaker}`}: ${segment.text}`)
      .join('\n');

    $('speakerMappingMessage').textContent = 'Interlocutores confirmados. Revisa la transcripción y ya puedes organizar la información clínica.';
    $('sessionMessage').textContent = 'Etiquetas de interlocutor aplicadas por revisión humana.';
  }

  function metaAlertItems(result) {
    const items = [];
    for (const warning of result.meta?.warnings || []) {
      items.push(`<li><b>Guarda clínica aplicada</b>: ${escapeHtml(warning)}</li>`);
    }
    for (const violation of result.meta?.invariant_violations || []) {
      items.push(`<li><b>Revisión obligatoria</b>: ${escapeHtml(violation)}</li>`);
    }
    return items;
  }

  const engineBanner = document.createElement('section');
  engineBanner.className = 'privacy-banner';
  engineBanner.innerHTML = '<strong>Motor V0.5</strong><span>Comprobando backend… · borrador sujeto a validación clínica.</span>';
  document.querySelector('.privacy-banner')?.insertAdjacentElement('afterend', engineBanner);

  function updateEngineBanner(result = null) {
    let status = 'Comprobando backend…';
    const health = state.health;
    if (health?.ok && health.model_transport_available !== 'missing') {
      const audio = health.recording_enabled ? ` · audio ${health.transcription_model || 'activo'}` : '';
      status = `Backend disponible · ${health.model_transport_available}${audio}`;
    } else if (health?.ok) {
      status = 'Backend activo, pero falta transporte de modelo';
    } else if (health?.error) {
      status = 'Backend no verificable';
    }
    if (result?.meta) {
      status = `Structured Outputs activo · ${result.meta.model || 'modelo no informado'} · ${result.meta.transport || 'transporte no informado'} · store:false`;
    }
    engineBanner.innerHTML = `<strong>Motor V0.5</strong><span>${escapeHtml(status)} · borrador sujeto a validación clínica.</span>`;
  }

  function renderReview(result) {
    const assessment = result.assessment;
    $('routingGrid').innerHTML = Object.entries(SECTION_TITLES)
      .filter(([key]) => !(key === 'intervencion' && assessment.sections[key]?.evidence_status !== 'supported'))
      .map(([key, title]) => {
        const section = assessment.sections[key] || {};
        const text = section.text?.trim() || 'Sin información suficiente.';
        return `<article class="route-card ${section.evidence_status === 'supported' ? 'active' : ''}">
          <div class="route-head"><h3>${escapeHtml(title)}</h3><span class="route-count">${escapeHtml(section.evidence_status || 'not_provided')}</span></div>
          <p class="route-preview">${escapeHtml(text)}</p>
        </article>`;
      }).join('');

    $('sourcesList').innerHTML = (assessment.sources || [])
      .map((source) => `<span class="tag">${escapeHtml(source.label)} · ${escapeHtml(source.kind)}</span>`)
      .join('') || '<span class="tag">Sin fuentes identificadas</span>';

    $('missingList').innerHTML = (assessment.missing_or_not_explored || [])
      .map((item) => `<li><b>${escapeHtml(item.topic)}</b>: ${escapeHtml(item.note)}</li>`)
      .join('') || '<li>Sin datos pendientes señalados.</li>';

    $('conflictList').innerHTML = (assessment.conflicts || [])
      .map((conflict) => `<li><b>${escapeHtml(conflict.topic)}</b>: ${(conflict.accounts || []).map((a) => escapeHtml(a.statement)).join(' / ')}</li>`)
      .join('') || '<li>Sin discrepancias detectadas.</li>';

    const clinicalAlerts = (assessment.safety_review || [])
      .map((item) => `<li><b>${escapeHtml(item.topic)}</b>: ${escapeHtml(item.evidence)}</li>`);
    $('alertList').innerHTML = [...clinicalAlerts, ...metaAlertItems(result)].join('') || '<li>Sin alertas estructuradas.</li>';

    $('reportEditor').textContent = result.report;
    $('validateCheck').checked = false;
    $('copyReport').disabled = true;
    updateEngineBanner(result);
  }

  async function checkBackendHealth() {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      state.health = response.ok ? payload : { error: true };
    } catch {
      state.health = { error: true };
    }
    updateEngineBanner();
  }

  async function analyzeWithBackend() {
    const transcript = $('caseText').value.trim();
    if (!transcript) {
      $('sessionMessage').textContent = 'Pega o graba primero una entrevista ficticia o anonimizada.';
      return;
    }
    if (/^HABLANTE\s+[^:]+:/mi.test(transcript)) {
      $('sessionMessage').textContent = 'Antes del análisis debes confirmar quién es cada voz en el panel de interlocutores.';
      $('speakerMappingCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const button = $('analyzeCase');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Analizando con Structured Outputs…';
    $('sessionMessage').textContent = '';

    try {
      const response = await fetch(`${baseUrl}/api/analyze`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `Error del backend (${response.status})`);
      if (typeof payload.deidentified_transcript === 'string' && payload.deidentified_transcript.trim()) {
        $('caseText').value = payload.deidentified_transcript;
        $('sessionMessage').textContent = 'Transcripción desidentificada aplicada. Al volver a Entrevista puedes comprobar literalmente la máscara XXXXXXXXXXX y las entidades conservadas.';
      }
      state.result = payload;
      renderReview(payload);
      showScreen('review');
    } catch (error) {
      console.error('Backend analysis failed without logging transcript.', error);
      $('sessionMessage').textContent = `No se pudo completar el análisis: ${error.message}`;
      showScreen('input');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function wipeTransientState(message = 'Sesión destruida. No queda contenido clínico ni audio en la interfaz.') {
    if (state.recorder?.state === 'recording') state.recorder.stop();
    clearRecordingTimers();
    stopMediaTracks();
    state.recorder = null;
    state.audioChunks = [];
    state.result = null;
    clearAudioMappingState();
    $('caseText').value = '';
    $('sourcesList').innerHTML = '';
    $('missingList').innerHTML = '';
    $('conflictList').innerHTML = '';
    $('alertList').innerHTML = '';
    $('routingGrid').innerHTML = '';
    $('reportEditor').textContent = '';
    $('validateCheck').checked = false;
    $('copyReport').disabled = true;
    $('sessionMessage').textContent = message;
    $('recordingStatus').textContent = 'Micrófono preparado para una prueba ficticia.';
    setRecordButton('idle');
    showScreen('input');
  }

  $('loadDemo')?.addEventListener('click', () => {
    clearAudioMappingState();
    $('caseText').value = DEMO_TEXT;
    $('sessionMessage').textContent = 'Caso ficticio breve cargado.';
  });
  for (const id of ['loadCase1', 'loadCase2']) {
    $(id)?.addEventListener('click', () => clearAudioMappingState());
  }
  $('analyzeCase')?.addEventListener('click', analyzeWithBackend);
  $('recordButton')?.addEventListener('click', () => {
    if (state.recorder?.state === 'recording') stopRecording();
    else startRecording();
  });
  $('applySpeakerMapping')?.addEventListener('click', applySpeakerMapping);
  $('destroyInput')?.addEventListener('click', () => wipeTransientState());
  $('destroySession')?.addEventListener('click', () => wipeTransientState());
  $('validateCheck')?.addEventListener('change', (event) => { $('copyReport').disabled = !event.target.checked; });
  $('copyReport')?.addEventListener('click', async () => {
    if (!$('validateCheck').checked) return;
    try {
      await navigator.clipboard.writeText($('reportEditor').innerText);
      $('sessionMessage').textContent = 'Informe copiado tras validación clínica.';
    } catch {
      $('sessionMessage').textContent = 'No se pudo copiar automáticamente; selecciona el texto manualmente.';
    }
  });

  document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => {
    const target = button.dataset.go;
    if ((target === 'review' || target === 'report') && !state.result) return;
    showScreen(target);
  }));
  document.querySelectorAll('.step').forEach((button) => button.addEventListener('click', () => {
    const target = button.dataset.step;
    if ((target === 'review' || target === 'report') && !state.result) return;
    showScreen(target);
  }));

  window.addEventListener('pagehide', () => {
    clearRecordingTimers();
    stopMediaTracks();
    state.audioChunks = [];
    state.diarized = null;
    state.result = null;
    state.health = null;
    if ($('reportEditor')) $('reportEditor').textContent = '';
  });

  checkBackendHealth();
})();
