(() => {
  const state = { validated: false };
  const EMAIL_RECIPIENT = 'joseluis.matesanz@salud-juntaex.es';

  const checkbox = () => document.getElementById('validateCheck');
  const editor = () => document.getElementById('reportEditor');
  const emailButton = () => document.getElementById('prepareReportEmail');
  const validationHint = () => document.querySelector('.validation-card .muted.small');
  const badge = () => document.querySelector('#screen-report .draft-badge');
  const eyebrow = () => document.querySelector('#screen-report .report-heading .section-label');
  const isEditing = () => Boolean(editor()?.querySelector('.report-section-editing'));

  function setHint(message) {
    const hint = validationHint();
    if (hint) hint.textContent = message;
  }

  function configureSingleSendAction() {
    const button = emailButton();
    if (!button) return;
    button.textContent = 'Envío / Borrar';
    button.setAttribute('aria-label', 'Enviar el informe validado y borrar la sesión');
    button.setAttribute('title', 'Envío / Borrar');
  }

  function setEditLocked(locked) {
    editor()?.classList.toggle('report-locked', locked);
    document.querySelectorAll('.report-edit-button').forEach((button) => {
      button.disabled = locked;
      button.classList.toggle('hidden', locked);
      button.setAttribute('aria-hidden', locked ? 'true' : 'false');
    });
  }

  function setUnvalidated(message = 'Revisa el borrador y marca la validación clínica para habilitar «Envío / Borrar».') {
    state.validated = false;
    const check = checkbox();
    const email = emailButton();
    if (check) check.checked = false;
    if (email) email.disabled = true;
    setEditLocked(false);
    if (badge()) badge().textContent = 'Pendiente de validación profesional';
    if (eyebrow()) eyebrow().textContent = 'DOCUMENTO CLÍNICO PENDIENTE DE REVISIÓN';
    setHint(message);
  }

  function validateReport() {
    const check = checkbox();
    if (isEditing()) {
      if (check) check.checked = false;
      setHint('Finaliza la edición abierta antes de validar el informe.');
      return;
    }
    state.validated = true;
    if (emailButton()) emailButton().disabled = false;
    setEditLocked(true);
    if (badge()) badge().textContent = 'Informe validado · edición bloqueada';
    if (eyebrow()) eyebrow().textContent = 'DOCUMENTO CLÍNICO VALIDADO';
    setHint(`Informe validado · destino: ${EMAIL_RECIPIENT}`);
  }

  function resetValidation() {
    configureSingleSendAction();
    document.querySelector('.validation-card .checkline')?.classList.remove('hidden');
    const check = checkbox();
    if (check) {
      check.disabled = false;
      check.removeAttribute('aria-hidden');
      check.tabIndex = 0;
    }
    setUnvalidated();
  }

  function getValidatedReportText() {
    if (!state.validated || isEditing()) return '';
    if (typeof window.getClinicalReportText === 'function') return window.getClinicalReportText().trim();
    return (editor()?.innerText || editor()?.textContent || '').trim();
  }

  function destroyEphemeralSession() {
    window.__CLINICAL_SESSION_DESTROYING = true;
    window.__CLINICAL_REPORT_AVAILABLE = false;
    state.validated = false;
    document.querySelectorAll('textarea').forEach((field) => { field.value = ''; });
    document.querySelectorAll('input[type="text"], input[type="search"]').forEach((field) => { field.value = ''; });
    editor()?.replaceChildren();
    ['routingGrid', 'sourcesList', 'missingList', 'conflictList', 'alertList', 'reportPendingBanner'].forEach((id) => {
      document.getElementById(id)?.replaceChildren();
    });
    if (emailButton()) emailButton().disabled = true;
    setTimeout(() => {
      const cleanUrl = `${window.location.pathname}${window.location.search}`;
      window.location.replace(cleanUrl);
    }, 900);
  }

  function sendAndDestroy() {
    const button = emailButton();
    const text = getValidatedReportText();
    if (!text) {
      if (button) button.disabled = true;
      setHint('El informe debe estar revisado y validado antes del envío.');
      return;
    }
    const subject = 'Informe clínico validado';
    const body = `Informe clínico validado\n\n${text}`;
    const mailto = `mailto:${EMAIL_RECIPIENT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (button) {
      button.disabled = true;
      button.textContent = 'Abriendo correo…';
    }
    setHint('Abriendo el correo institucional y destruyendo la sesión local…');
    const link = document.createElement('a');
    link.href = mailto;
    link.style.display = 'none';
    link.setAttribute('aria-hidden', 'true');
    document.body.append(link);
    link.click();
    link.remove();
    destroyEphemeralSession();
  }

  checkbox()?.addEventListener('change', (event) => {
    if (event.target.checked) validateReport();
    else setUnvalidated();
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#prepareReportEmail')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      sendAndDestroy();
      return;
    }
    if (event.target.closest?.('.report-section-save, .report-section-cancel')) {
      setTimeout(() => setUnvalidated(), 0);
    }
  }, true);

  document.addEventListener('input', (event) => {
    if (event.target.matches?.('.report-section-input')) setUnvalidated();
  });

  window.addEventListener('pageshow', resetValidation);
  window.addEventListener('clinical-report-ready', resetValidation);
  window.sendValidatedClinicalReport = sendAndDestroy;
  resetValidation();
})();
