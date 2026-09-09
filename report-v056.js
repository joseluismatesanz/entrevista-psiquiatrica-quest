(() => {
  const EMPTY_PHRASES = [
    'sin datos pendientes',
    'sin información pendiente',
    'sin discrepancias detectadas',
    'sin alertas estructuradas',
  ];

  const REPORT_HEADINGS = new Set([
    'MOTIVO DE LA CONSULTA',
    'PSQ GUARDIA',
    'ALERGIAS / RAM',
    'ANTECEDENTES PERSONALES SOMÁTICOS',
    'ANTECEDENTES PERSONALES EN SALUD MENTAL',
    'ANTECEDENTES FAMILIARES PSIQUIÁTRICOS',
    'SITUACIÓN SOCIOFAMILIAR',
    'HÁBITOS TÓXICOS',
    'TRATAMIENTO HABITUAL',
    'ENFERMEDAD ACTUAL',
    'INTERVENCIÓN',
    'EXPLORACIÓN PSICOPATOLÓGICA',
    'ORIENTACIÓN DIAGNÓSTICA',
    'PLAN TERAPÉUTICO',
    'TRATAMIENTO ACTUAL',
  ]);

  const EMPTY_SECTION_TEXTS = new Set([
    'no explorado.',
    'no consta.',
    'información insuficiente.',
  ]);

  function meaningfulItems(listId) {
    const list = document.getElementById(listId);
    if (!list) return [];
    return [...list.querySelectorAll('li')].filter((item) => {
      const text = item.textContent?.trim().toLowerCase() || '';
      return text && !EMPTY_PHRASES.some((phrase) => text.includes(phrase));
    });
  }

  function mandatoryReviewItems() {
    return meaningfulItems('alertList').filter((item) => {
      const topic = item.querySelector('b')?.textContent?.trim().toLowerCase() || '';
      return topic === 'revisión obligatoria';
    });
  }

  function itemLabel(item) {
    return item.querySelector('b')?.textContent?.trim()
      || item.textContent?.trim().split(':')[0]
      || 'Dato pendiente';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[char]);
  }

  function buildReportPendingBanner() {
    const banner = document.getElementById('reportPendingBanner');
    if (!banner) return;

    const missing = meaningfulItems('missingList');
    const conflicts = meaningfulItems('conflictList');
    const mandatory = mandatoryReviewItems();
    const total = missing.length + conflicts.length + mandatory.length;

    if (!total) {
      banner.classList.add('hidden');
      banner.innerHTML = '';
      return;
    }

    const chips = [
      ...missing.map((item) => ({ label: itemLabel(item), kind: 'pending' })),
      ...conflicts.map((item) => ({ label: itemLabel(item), kind: 'conflict' })),
      ...mandatory.map((item) => ({ label: itemLabel(item), kind: 'review' })),
    ].slice(0, 5);

    const details = [];
    if (missing.length) details.push(`${missing.length} dato${missing.length === 1 ? '' : 's'} pendiente${missing.length === 1 ? '' : 's'}`);
    if (conflicts.length) details.push(`${conflicts.length} discrepancia${conflicts.length === 1 ? '' : 's'}`);
    if (mandatory.length) details.push(`${mandatory.length} revisión${mandatory.length === 1 ? '' : 'es'} obligatoria${mandatory.length === 1 ? '' : 's'}`);

    banner.innerHTML = `
      <div class="report-pending-copy">
        <p class="section-label">INFORMACIÓN PENDIENTE EN ESTE BORRADOR</p>
        <h2>${total} elemento${total === 1 ? '' : 's'} siguen pendientes de revisión</h2>
        <p>El borrador conserva estos datos como no explorados, insuficientes o discrepantes. No los transforma en hallazgos negativos.</p>
        <small>${details.join(' · ')}</small>
      </div>
      <div class="report-pending-chips" aria-label="Resumen de información pendiente">
        ${chips.map((chip) => `<span class="report-pending-chip ${chip.kind}">${escapeHtml(chip.label)}</span>`).join('')}
      </div>
    `;
    banner.classList.remove('hidden');
  }

  function normalizeReportHeading() {
    const screen = document.getElementById('screen-report');
    if (!screen) return;
    const heading = screen.querySelector('.report-heading h2');
    const eyebrow = screen.querySelector('.report-heading .section-label');
    const badge = screen.querySelector('.draft-badge');

    if (heading) heading.textContent = 'Borrador de informe clínico';
    if (eyebrow) eyebrow.textContent = 'DOCUMENTO CLÍNICO PENDIENTE DE REVISIÓN';
    if (badge) badge.textContent = 'Pendiente de validación profesional';
  }

  function parseReportSections(rawText) {
    const lines = String(rawText || '').replace(/\r/g, '').split('\n');
    const sections = [];
    let current = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (REPORT_HEADINGS.has(trimmed)) {
        if (current) sections.push(current);
        current = { title: trimmed, body: [] };
        continue;
      }

      if (current) current.body.push(line);
    }

    if (current) sections.push(current);
    return sections.map((section) => ({
      title: section.title,
      body: section.body.join('\n').trim(),
    }));
  }

  function updateEmptySectionState(block, body) {
    block.classList.toggle('report-section-empty', EMPTY_SECTION_TEXTS.has(String(body || '').trim().toLowerCase()));
  }

  function resetReportValidation() {
    const checkbox = document.getElementById('validateCheck');
    const copyButton = document.getElementById('copyReport');
    if (checkbox) checkbox.checked = false;
    if (copyButton) copyButton.disabled = true;
  }

  function closeSectionEditor(block) {
    block.classList.remove('report-section-editing');
    block.querySelector('.report-section-text')?.classList.remove('hidden');
    block.querySelector('.report-section-input')?.classList.add('hidden');
    block.querySelector('.report-section-edit-actions')?.classList.add('hidden');
    block.querySelector('.report-edit-button')?.classList.remove('hidden');
  }

  function startSectionEditor(block) {
    const text = block.querySelector('.report-section-text');
    const input = block.querySelector('.report-section-input');
    if (!text || !input) return;

    resetReportValidation();
    input.value = text.textContent || '';
    text.classList.add('hidden');
    input.classList.remove('hidden');
    block.querySelector('.report-section-edit-actions')?.classList.remove('hidden');
    block.querySelector('.report-edit-button')?.classList.add('hidden');
    block.classList.add('report-section-editing');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function saveSectionEditor(block) {
    const text = block.querySelector('.report-section-text');
    const input = block.querySelector('.report-section-input');
    if (!text || !input) return;

    const newBody = input.value.trim();
    text.textContent = newBody;
    const generatedBody = block.dataset.generatedBody || '';
    const edited = newBody !== generatedBody;
    block.classList.toggle('report-section-edited', edited);
    block.querySelector('.report-edited-label')?.classList.toggle('hidden', !edited);
    updateEmptySectionState(block, newBody);
    closeSectionEditor(block);
    resetReportValidation();
  }

  function formatReportEditor() {
    const editor = document.getElementById('reportEditor');
    if (!editor || editor.querySelector('.report-section-block')) return;

    const rawText = editor.innerText || editor.textContent || '';
    const sections = parseReportSections(rawText);
    if (!sections.length) return;

    editor.innerHTML = sections.map((section) => {
      const body = section.body || 'No consta.';
      const empty = EMPTY_SECTION_TEXTS.has(body.toLowerCase());
      return `
        <section class="report-section-block${empty ? ' report-section-empty' : ''}">
          <div class="report-section-header">
            <h3>${escapeHtml(section.title)}</h3>
            <div class="report-section-tools" contenteditable="false">
              <span class="report-edited-label hidden">Editado por profesional</span>
              <button class="report-edit-button" type="button">Editar</button>
            </div>
          </div>
          <p class="report-section-text">${escapeHtml(body)}</p>
          <textarea class="report-section-input hidden" aria-label="Editar ${escapeHtml(section.title)}"></textarea>
          <div class="report-section-edit-actions hidden" contenteditable="false">
            <button class="report-section-cancel" type="button">Cancelar</button>
            <button class="report-section-save" type="button">Guardar cambios</button>
          </div>
        </section>
      `;
    }).join('');

    [...editor.querySelectorAll('.report-section-block')].forEach((block, index) => {
      block.dataset.generatedBody = sections[index]?.body || 'No consta.';
    });

    editor.classList.add('structured-report-editor');
    editor.setAttribute('contenteditable', 'false');
  }

  function getClinicalReportText() {
    const editor = document.getElementById('reportEditor');
    if (!editor) return '';

    const blocks = [...editor.querySelectorAll('.report-section-block')];
    if (!blocks.length) return (editor.innerText || editor.textContent || '').trim();

    return blocks.map((block) => {
      const title = block.querySelector('h3')?.textContent?.trim() || '';
      const body = block.querySelector('.report-section-text')?.textContent?.trim() || '';
      return `${title}\n${body}`.trim();
    }).filter(Boolean).join('\n\n');
  }

  function refreshReportScreen() {
    resetReportValidation();
    normalizeReportHeading();
    buildReportPendingBanner();
    formatReportEditor();
  }

  document.addEventListener('click', (event) => {
    const editButton = event.target.closest('.report-edit-button');
    if (editButton) {
      startSectionEditor(editButton.closest('.report-section-block'));
      return;
    }

    const cancelButton = event.target.closest('.report-section-cancel');
    if (cancelButton) {
      closeSectionEditor(cancelButton.closest('.report-section-block'));
      return;
    }

    const saveButton = event.target.closest('.report-section-save');
    if (saveButton) {
      saveSectionEditor(saveButton.closest('.report-section-block'));
      return;
    }

    const navigation = event.target.closest('[data-go="report"], [data-step="report"]');
    if (navigation) setTimeout(refreshReportScreen, 0);
  });

  document.addEventListener('input', (event) => {
    if (event.target.matches?.('.report-section-input')) resetReportValidation();
  });

  const validationCheck = document.getElementById('validateCheck');
  validationCheck?.addEventListener('change', (event) => {
    if (!event.target.checked) return;
    const editor = document.getElementById('reportEditor');
    if (editor?.querySelector('.report-section-editing')) {
      event.target.checked = false;
      const copy = document.getElementById('copyReport');
      if (copy) copy.disabled = true;
    }
  }, { capture: true });

  const copyButton = document.getElementById('copyReport');
  copyButton?.addEventListener('click', async (event) => {
    event.stopImmediatePropagation();
    const checkbox = document.getElementById('validateCheck');
    if (!checkbox?.checked) return;
    try {
      await navigator.clipboard.writeText(getClinicalReportText());
      const message = document.getElementById('sessionMessage');
      if (message) message.textContent = 'Informe copiado tras validación clínica.';
    } catch {
      const message = document.getElementById('sessionMessage');
      if (message) message.textContent = 'No se pudo copiar automáticamente; selecciona el texto manualmente.';
    }
  }, { capture: true });

  window.getClinicalReportText = getClinicalReportText;
  window.addEventListener('pageshow', resetReportValidation);
  refreshReportScreen();
})();