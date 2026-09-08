(() => {
  const EMPTY_PHRASES = [
    'sin datos pendientes',
    'sin información pendiente',
    'sin discrepancias detectadas',
    'sin alertas estructuradas',
  ];

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

  function resetReportValidation() {
    const checkbox = document.getElementById('validateCheck');
    const copyButton = document.getElementById('copyReport');
    if (checkbox) checkbox.checked = false;
    if (copyButton) copyButton.disabled = true;
  }

  function refreshReportScreen() {
    resetReportValidation();
    normalizeReportHeading();
    buildReportPendingBanner();
  }

  document.addEventListener('click', (event) => {
    const navigation = event.target.closest('[data-go="report"], [data-step="report"]');
    if (navigation) setTimeout(refreshReportScreen, 0);
  });

  window.addEventListener('pageshow', resetReportValidation);
  refreshReportScreen();
})();