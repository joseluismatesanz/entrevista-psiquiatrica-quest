(() => {
  const baseUrl = String(window.CLINICAL_API_URL || '').replace(/\/+$/, '');
  if (!baseUrl) return;

  const $ = (id) => document.getElementById(id);
  const state = { result: null, health: null };
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
  engineBanner.innerHTML = '<strong>Motor V0.4</strong><span>Comprobando backend… · borrador sujeto a validación clínica.</span>';
  document.querySelector('.privacy-banner')?.insertAdjacentElement('afterend', engineBanner);

  function updateEngineBanner(result = null) {
    let status = 'Comprobando backend…';
    const health = state.health;
    if (health?.ok && health.model_transport_available !== 'missing') {
      status = `Backend disponible · ${health.model_transport_available}`;
    } else if (health?.ok) {
      status = 'Backend activo, pero falta transporte de modelo';
    } else if (health?.error) {
      status = 'Backend no verificable';
    }
    if (result?.meta) {
      status = `Structured Outputs activo · ${result.meta.model || 'modelo no informado'} · ${result.meta.transport || 'transporte no informado'} · store:false`;
    }
    engineBanner.innerHTML = `<strong>Motor V0.4</strong><span>${escapeHtml(status)} · borrador sujeto a validación clínica.</span>`;
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
      $('sessionMessage').textContent = 'Pega primero una entrevista ficticia o anonimizada.';
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

  function wipeTransientState(message = 'Sesión destruida. No queda contenido clínico en la interfaz.') {
    state.result = null;
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
    showScreen('input');
  }

  $('loadDemo')?.addEventListener('click', () => {
    $('caseText').value = DEMO_TEXT;
    $('sessionMessage').textContent = 'Caso ficticio breve cargado.';
  });
  $('analyzeCase')?.addEventListener('click', analyzeWithBackend);
  $('recordButton')?.addEventListener('click', () => alert('La captura real de audio permanece bloqueada en V0.4.'));
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
    state.result = null;
    state.health = null;
    if ($('reportEditor')) $('reportEditor').textContent = '';
  });

  checkBackendHealth();
})();
