(() => {
  const STATUS_LABELS = {
    supported: 'Consta',
    explicitly_denied: 'Negado explícitamente',
    not_explored: 'No explorado',
    not_provided: 'No explorado',
    insufficient: 'Información insuficiente',
    insufficient_information: 'Información insuficiente',
    discrepancy: 'Discrepancia',
    requires_review: 'Requiere revisión',
  };

  const STATUS_CLASSES = [
    'status-supported',
    'status-denied',
    'status-not-explored',
    'status-insufficient',
    'status-discrepancy',
    'status-review',
  ];

  function normalizeStatus(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  }

  function statusClass(status) {
    if (status === 'supported') return 'status-supported';
    if (status === 'explicitly_denied') return 'status-denied';
    if (status === 'not_explored' || status === 'not_provided') return 'status-not-explored';
    if (status === 'insufficient' || status === 'insufficient_information') return 'status-insufficient';
    if (status === 'discrepancy') return 'status-discrepancy';
    if (status === 'requires_review') return 'status-review';
    return 'status-not-explored';
  }

  function isPureExplicitDenial(text) {
    const clauses = String(text || '')
      .split(/[.;]\s*/)
      .map((clause) => clause.trim())
      .filter(Boolean);

    if (!clauses.length) return false;

    const denialStart = /^(?:niega\b|no\s+(?:refiere|presenta|toma|consume|tiene|ha\b|consta\b|se\s+objetiva\b|existen\b|hay\b)|sin\s+(?:antecedentes\b|tratamiento\b|medicaci[oó]n\b|alergias\b|consumo\b|enfermedad\b))/i;
    return clauses.every((clause) => denialStart.test(clause));
  }

  function displayStatusForCard(card, rawStatus) {
    if (rawStatus !== 'supported') return rawStatus;
    const preview = card.querySelector('.route-preview')?.textContent?.trim() || '';
    return isPureExplicitDenial(preview) ? 'explicitly_denied' : rawStatus;
  }

  function decorateRouteStatuses() {
    document.querySelectorAll('#routingGrid .route-card').forEach((card) => {
      const badge = card.querySelector('.route-count');
      if (!badge) return;

      const rawStatus = normalizeStatus(badge.dataset.rawStatus || badge.textContent);
      if (!rawStatus) return;

      if (badge.dataset.rawStatus !== rawStatus) badge.dataset.rawStatus = rawStatus;
      const displayStatus = displayStatusForCard(card, rawStatus);
      const label = STATUS_LABELS[displayStatus];
      if (label && badge.textContent !== label) badge.textContent = label;

      card.classList.remove(...STATUS_CLASSES);
      card.classList.add(statusClass(displayStatus));
      badge.classList.remove(...STATUS_CLASSES);
      badge.classList.add(statusClass(displayStatus));
    });
  }

  function meaningfulItems(listId, emptyPhrases) {
    const list = document.getElementById(listId);
    if (!list) return [];

    return [...list.querySelectorAll('li')].filter((item) => {
      const text = item.textContent.trim().toLowerCase();
      return text && !emptyPhrases.some((phrase) => text.includes(phrase));
    });
  }

  function mandatoryReviewItems() {
    return meaningfulItems('alertList', ['sin alertas estructuradas']).filter((item) => {
      const topic = item.querySelector('b')?.textContent?.trim().toLowerCase() || '';
      return topic === 'revisión obligatoria';
    });
  }

  function topicFromItem(item) {
    return item.querySelector('b')?.textContent?.trim() || item.textContent.trim().split(':')[0];
  }

  function ensureAttentionBanner() {
    const reviewScreen = document.getElementById('screen-review');
    if (!reviewScreen) return null;

    let banner = document.getElementById('organizationAttention');
    if (banner) return banner;

    banner = document.createElement('section');
    banner.id = 'organizationAttention';
    banner.className = 'organization-attention hidden';

    const firstCard = reviewScreen.querySelector(':scope > .card');
    if (firstCard) reviewScreen.insertBefore(banner, firstCard);
    else reviewScreen.prepend(banner);

    return banner;
  }

  function updateSafetySummaryHeading() {
    const list = document.getElementById('alertList');
    const card = list?.closest('.card');
    if (!card) return;

    card.classList.add('safety-summary-card');
    const heading = card.querySelector('h2');
    if (heading && heading.textContent !== 'Resumen de seguridad clínica') {
      heading.textContent = 'Resumen de seguridad clínica';
    }
  }

  function updateAttentionBanner() {
    const banner = ensureAttentionBanner();
    if (!banner) return;

    const missing = meaningfulItems('missingList', [
      'sin datos pendientes',
      'sin información pendiente',
    ]);
    const conflicts = meaningfulItems('conflictList', [
      'sin discrepancias detectadas',
    ]);
    const mandatory = mandatoryReviewItems();

    const total = missing.length + conflicts.length + mandatory.length;
    if (!total) {
      banner.classList.add('hidden');
      if (banner.innerHTML) banner.innerHTML = '';
      return;
    }

    const chips = [
      ...missing.slice(0, 3).map((item) => ({ label: topicFromItem(item), kind: 'pending' })),
      ...conflicts.slice(0, 2).map((item) => ({ label: topicFromItem(item), kind: 'conflict' })),
      ...mandatory.slice(0, 2).map((item) => ({ label: topicFromItem(item), kind: 'alert' })),
    ].slice(0, 5);

    const parts = [];
    if (missing.length) parts.push(`${missing.length} dato${missing.length === 1 ? '' : 's'} pendiente${missing.length === 1 ? '' : 's'}`);
    if (conflicts.length) parts.push(`${conflicts.length} discrepancia${conflicts.length === 1 ? '' : 's'}`);
    if (mandatory.length) parts.push(`${mandatory.length} revisión${mandatory.length === 1 ? '' : 'es'} obligatoria${mandatory.length === 1 ? '' : 's'}`);

    const html = `
      <div class="organization-attention-copy">
        <p class="section-label">REVISIÓN ANTES DEL INFORME</p>
        <h2>${total} elemento${total === 1 ? '' : 's'} requieren atención</h2>
        <p>La herramienta conserva como pendientes los datos que no constan o necesitan revisión. No se completarán por inferencia.</p>
        <small>${parts.join(' · ')}</small>
      </div>
      <div class="organization-attention-chips" aria-label="Resumen de elementos pendientes">
        ${chips.map((chip) => `<span class="attention-chip ${chip.kind}">${escapeHtml(chip.label)}</span>`).join('')}
      </div>
    `;

    if (banner.innerHTML !== html) banner.innerHTML = html;
    banner.classList.remove('hidden');
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

  function updateGenerateButton() {
    const button = document.querySelector('#screen-review button[data-go="report"]');
    if (button && button.textContent !== 'Generar borrador de informe') {
      button.textContent = 'Generar borrador de informe';
    }
  }

  function refreshOrganizationUi() {
    decorateRouteStatuses();
    updateSafetySummaryHeading();
    updateAttentionBanner();
    updateGenerateButton();
  }

  function installObserver() {
    const targets = ['routingGrid', 'missingList', 'conflictList', 'alertList']
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    if (!targets.length) return;

    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        refreshOrganizationUi();
      });
    });

    targets.forEach((target) => observer.observe(target, { childList: true, subtree: true }));
  }

  document.addEventListener('click', (event) => {
    const navigation = event.target.closest('[data-go="review"], [data-step="review"]');
    if (navigation) setTimeout(refreshOrganizationUi, 0);
  });

  refreshOrganizationUi();
  installObserver();
})();