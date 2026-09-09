(() => {
  const state = { validated: false };
  const EMAIL_RECIPIENTS = [
    'joseluis.matesanz@salud-juntaex.es',
    'jlmatesanzperez@gmail.com',
  ];
  const EMAIL_RECIPIENTS_DISPLAY = EMAIL_RECIPIENTS.join('; ');

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

  function configureCompactFooter(actions) {
    const back = actions?.querySelector('[data-go="review"]');
    if (back) {
      back.id = 'backToReview';
      back.textContent = '←';
      back.classList.add('footer-back');
      back.setAttribute('aria-label', 'Volver a categorización');
      back.setAttribute('title', 'Volver a categorización');
    }

    const copy = copyButton();
    if (copy) copy.textContent = 'Copiar';

    const destroy = document.getElementById('destroySession');
    if (destroy) destroy.textContent = 'DESTRUIR';

    return { back, copy, destroy };
  }

  function ensureActionButtons() {
    const actions = document.querySelector('.validation-card .actions');
    if (!actions) return {};

    const { back, copy, destroy } = configureCompactFooter(actions);

    let validate = document.getElementById('validateReport');
    if (!validate) {
      validate = document.createElement('button');
      validate.id = 'validateReport';
      validate.type = 'button';
      validate.className = 'primary';
      validate.textContent = 'Validar informe';
      if (back) back.after(validate);
      else actions.prepend(validate);
    }

    let reopen = document.getElementById('reopenReport');
    if (!reopen) {
      reopen = document.createElement('button');
      reopen.id = 'reopenReport';
      reopen.type = 'button';
      reopen.className = 'secondary hidden';
      reopen.textContent = 'Re-editar';
      if (back) back.after(reopen);
      else actions.prepend(reopen);
    }

    let email = document.getElementById('prepareReportEmail');
    if (!email) {
      email = document.createElement('button');
      email.id = 'prepareReportEmail';
      email.type = 'button';
      email.className = 'primary';
      email.textContent = 'Enviar @';
      email.disabled = true;
      if (destroy) destroy.before(email);
      else actions.append(email);
    }

    return { validate, reopen, email, back, copy, destroy };
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
    const { validate, reopen, email } = ensureActionButtons();

    if (check) check.checked = false;
    if (copy) copy.disabled = true;
    if (email) email.disabled = true;
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
    const { validate, reopen, email } = ensureActionButtons();

    if (check) check.checked = true;
    if (copy) copy.disabled = false;
    if (email) email.disabled = false;
    if (validate) validate.classList.add('hidden');
    if (reopen) reopen.classList.remove('hidden');

    setEditLocked(true);
    if (badge()) badge().textContent = 'Informe validado · edición bloqueada';
    if (eyebrow()) eyebrow().textContent = 'DOCUMENTO CLÍNICO VALIDADO';
    setHint(`Informe validado. Destinatarios: ${EMAIL_RECIPIENTS_DISPLAY}`);
  }

  function reopenEditing() {
    setUnvalidated('Edición reabierta. Cualquier cambio requerirá una nueva validación antes de copiar o enviar el informe.');
  }

  function invalidateBeforeLeavingReport() {
    if (!state.validated) return;
    setUnvalidated('Has salido del informe validado. Al volver, deberás validarlo de nuevo antes de copiarlo o enviarlo.');
  }

  function resetValidation() {
    hideLegacyValidationCheckbox();
    setUnvalidated('Revisa el borrador y pulsa «Validar informe» cuando esté listo.');
  }

  function getValidatedReportText() {
    if (!state.validated || isEditing()) return '';
    if (typeof window.getClinicalReportText === 'function') {
      return window.getClinicalReportText().trim();
    }
    return (editor()?.innerText || editor()?.textContent || '').trim();
  }

  function prepareValidatedEmail() {
    const emailButton = document.getElementById('prepareReportEmail');
    const text = getValidatedReportText();

    if (!text) {
      if (emailButton) emailButton.disabled = true;
      setHint('El informe debe estar validado antes de preparar el correo.');
      return;
    }

    const subject = 'Informe clínico validado';
    const body = `Informe clínico validado\n\n${text}`;
    const mailto = `mailto:${EMAIL_RECIPIENTS_DISPLAY}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    setHint(`Abriendo el cliente de correo: ${EMAIL_RECIPIENTS_DISPLAY}. La aplicación no envía el mensaje por sí sola.`);
    window.location.href = mailto;
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

    if (event.target.closest?.('#prepareReportEmail')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      prepareValidatedEmail();
      return;
    }

    if (event.target.closest?.('.report-edit-button, .report-section-save, .report-section-cancel')) {
      setTimeout(syncValidateAvailability, 0);
      return;
    }

    if (event.target.closest?.('[data-go="review"], [data-step="review"], [data-go="input"], [data-step="input"]')) {
      invalidateBeforeLeavingReport();
      return;
    }

    if (event.target.closest?.('[data-go="report"], [data-step="report"]')) {
      setTimeout(resetValidation, 0);
    }
  }, true);

  document.addEventListener('input', (event) => {
    if (!event.target.matches?.('.report-section-input')) return;
    const copy = copyButton();
    const check = checkbox();
    const email = document.getElementById('prepareReportEmail');
    if (copy) copy.disabled = true;
    if (email) email.disabled = true;
    if (check) check.checked = false;
    state.validated = false;
    syncValidateAvailability();
  });

  window.addEventListener('pageshow', resetValidation);
  resetValidation();
})();