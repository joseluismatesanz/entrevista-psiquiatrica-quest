(() => {
  const state = { validated: false };

  function checkbox() {
    return document.getElementById('validateCheck');
  }

  function copyButton() {
    return document.getElementById('copyReport');
  }

  function editor() {
    return document.getElementById('reportEditor');
  }

  function validationHint() {
    return document.querySelector('.validation-card .muted.small');
  }

  function badge() {
    return document.querySelector('#screen-report .draft-badge');
  }

  function eyebrow() {
    return document.querySelector('#screen-report .report-heading .section-label');
  }

  function isEditing() {
    return Boolean(editor()?.querySelector('.report-section-editing'));
  }

  function setHint(message) {
    const hint = validationHint();
    if (hint) hint.textContent = message;
  }

  function ensureActionButtons() {
    const actions = document.querySelector('.validation-card .actions');
    if (!actions) return {};

    let validate = document.getElementById('validateReport');
    if (!validate) {
      validate = document.createElement('button');
      validate.id = 'validateReport';
      validate.type = 'button';
      validate.className = 'primary';
      validate.textContent = 'Validar informe';
      actions.prepend(validate);
    }

    let reopen = document.getElementById('reopenReport');
    if (!reopen) {
      reopen = document.createElement('button');
      reopen.id = 'reopenReport';
      reopen.type = 'button';
      reopen.className = 'secondary hidden';
      reopen.textContent = 'Reabrir edición';
      actions.prepend(reopen);
    }

    return { validate, reopen };
  }

  function hideLegacyValidationCheckbox() {
    const checkline = document.querySelector('.validation-card .checkline');
    if (checkline) checkline.classList.add('hidden');
    const check = checkbox();
    if (check) {
      check.checked = false;
      check.disabled = false;
      check.setAttribute('aria-hidden', 'true');
      check.tabIndex = -1;
    }
  }

  function setEditLocked(locked) {
    const reportEditor = editor();
    reportEditor?.classList.toggle('report-locked', locked);

    document.querySelectorAll('.report-edit-button').forEach((button) => {
      button.disabled = locked;
      button.classList.toggle('hidden', locked);
      button.setAttribute('aria-hidden', locked ? 'true' : 'false');
    });
  }

  function syncValidateAvailability() {
    const { validate } = ensureActionButtons();
    if (validate) validate.disabled = isEditing() || state.validated;
  }

  function setUnvalidated(message = 'Revisa el borrador y pulsa «Validar informe» cuando esté listo.') {
    state.validated = false;

    const check = checkbox();
    const copy = copyButton();
    const { validate, reopen } = ensureActionButtons();

    if (check) check.checked = false;
    if (copy) copy.disabled = true;
    if (validate) validate.classList.remove('hidden');
    if (reopen) reopen.classList.add('hidden');

    setEditLocked(false);
    if (badge()) badge().textContent = 'Pendiente de validación profesional';
    if (eyebrow()) eyebrow().textContent = 'DOCUMENTO CLÍNICO PENDIENTE DE REVISIÓN';
    setHint(message);
    syncValidateAvailability();
  }

  function validateReport() {
    if (isEditing()) {
      setHint('Finaliza la edición abierta antes de validar el informe.');
      syncValidateAvailability();
      return;
    }

    state.validated = true;

    const check = checkbox();
    const copy = copyButton();
    const { validate, reopen } = ensureActionButtons();

    if (check) check.checked = true;
    if (copy) copy.disabled = false;
    if (validate) validate.classList.add('hidden');
    if (reopen) reopen.classList.remove('hidden');

    setEditLocked(true);
    if (badge()) badge().textContent = 'Informe validado · edición bloqueada';
    if (eyebrow()) eyebrow().textContent = 'DOCUMENTO CLÍNICO VALIDADO';
    setHint('Informe validado. La edición está bloqueada. Pulsa «Reabrir edición» si necesitas modificarlo.');
  }

  function reopenEditing() {
    setUnvalidated('Edición reabierta. Cualquier cambio requerirá una nueva validación antes de copiar el informe.');
  }

  function resetValidation() {
    hideLegacyValidationCheckbox();
    setUnvalidated('Revisa el borrador y pulsa «Validar informe» cuando esté listo.');
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#validateReport')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      validateReport();
      return;
    }

    if (event.target.closest?.('#reopenReport')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      reopenEditing();
      return;
    }

    if (event.target.closest?.('.report-edit-button, .report-section-save, .report-section-cancel')) {
      setTimeout(syncValidateAvailability, 0);
      return;
    }

    if (event.target.closest?.('[data-go="report"], [data-step="report"]')) {
      setTimeout(resetValidation, 0);
    }
  });

  document.addEventListener('input', (event) => {
    if (!event.target.matches?.('.report-section-input')) return;
    const copy = copyButton();
    const check = checkbox();
    if (copy) copy.disabled = true;
    if (check) check.checked = false;
    state.validated = false;
    syncValidateAvailability();
  });

  window.addEventListener('pageshow', resetValidation);
  resetValidation();
})();
