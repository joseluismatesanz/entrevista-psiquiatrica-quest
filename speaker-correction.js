(() => {
  const $ = (id) => document.getElementById(id);
  const ROLE_OPTIONS = [
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

  let diarizedSegments = [];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[c]);
  }

  function parseRawDiarizedTranscript() {
    const text = String($('caseText')?.value || '');
    return text.split(/\r?\n/).map((line) => {
      const match = line.match(/^HABLANTE\s+([^:]+):\s*(.*)$/i);
      if (!match) return null;
      return {
        speaker: String(match[1] || '').trim(),
        text: String(match[2] || '').trim(),
      };
    }).filter((segment) => segment?.speaker && segment?.text);
  }

  function correctionOptions(speaker) {
    const fallback = `<option value="">Usar asignación de Voz ${escapeHtml(speaker)}</option>`;
    const roles = ROLE_OPTIONS.map(([value, label]) =>
      `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`
    ).join('');
    return fallback + roles;
  }

  function renderSegmentCorrection() {
    const card = $('speakerMappingCard');
    const fields = $('speakerMappingFields');
    if (!card || !fields || card.classList.contains('hidden')) return;

    const parsed = parseRawDiarizedTranscript();
    if (!parsed.length) return;
    diarizedSegments = parsed;

    let panel = $('segmentSpeakerCorrection');
    if (!panel) {
      panel = document.createElement('details');
      panel.id = 'segmentSpeakerCorrection';
      panel.className = 'segment-speaker-correction';
      panel.open = true;
      fields.insertAdjacentElement('afterend', panel);
    }

    const detectedCount = new Set(parsed.map((segment) => segment.speaker)).size;
    panel.innerHTML = `
      <summary><b>Corregir interlocutor por fragmento</b> · ${detectedCount} voz${detectedCount === 1 ? '' : 'es'} acústica${detectedCount === 1 ? '' : 's'} detectada${detectedCount === 1 ? '' : 's'}</summary>
      <p class="muted small">Si la diarización ha unido a dos personas bajo la misma voz, cambia solo los fragmentos necesarios. El resto usará la asignación general de Voz A/B/C.</p>
      <div class="speaker-mapping-grid">
        ${parsed.map((segment, index) => `
          <label class="speaker-row">
            <span><b>Fragmento ${index + 1} · Voz ${escapeHtml(segment.speaker)}</b><small>${escapeHtml(segment.text.slice(0, 150))}</small></span>
            <select data-segment-role="${index}" aria-label="Corregir interlocutor del fragmento ${index + 1}">${correctionOptions(segment.speaker)}</select>
          </label>
        `).join('')}
      </div>`;

    const message = $('speakerMappingMessage');
    if (message) {
      message.textContent = detectedCount < 3
        ? `${detectedCount} voces acústicas detectadas. Si había más personas, corrige abajo los fragmentos que el modelo haya agrupado.`
        : 'Confirma las voces y corrige únicamente los fragmentos cuya atribución no sea correcta.';
    }
  }

  function applySegmentAwareMapping(event) {
    const button = event.target instanceof Element ? event.target.closest('#applySpeakerMapping') : null;
    if (!button || !diarizedSegments.length || !$('segmentSpeakerCorrection')) return;

    const voiceSelects = [...document.querySelectorAll('#speakerMappingFields select[data-speaker]')];
    const mapping = new Map();

    for (const select of voiceSelects) {
      if (!select.value) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const message = $('speakerMappingMessage');
        if (message) message.textContent = 'Falta asignar al menos una de las voces detectadas.';
        select.focus();
        return;
      }
      mapping.set(select.dataset.speaker, select.value);
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const transcript = diarizedSegments.map((segment, index) => {
      const override = document.querySelector(`select[data-segment-role="${index}"]`)?.value || '';
      const role = override || mapping.get(segment.speaker) || `HABLANTE ${segment.speaker}`;
      return `${role}: ${segment.text}`;
    }).join('\n');

    if ($('caseText')) $('caseText').value = transcript;
    const message = $('speakerMappingMessage');
    if (message) message.textContent = 'Interlocutores confirmados y correcciones por fragmento aplicadas. Revisa la transcripción antes del análisis clínico.';
    const session = $('sessionMessage');
    if (session) session.textContent = 'Etiquetas de interlocutor aplicadas por revisión humana, incluidas las correcciones por fragmento.';
  }

  document.addEventListener('click', applySegmentAwareMapping, true);

  const card = $('speakerMappingCard');
  if (card) {
    const observer = new MutationObserver(() => queueMicrotask(renderSegmentCorrection));
    observer.observe(card, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }

  renderSegmentCorrection();
})();
