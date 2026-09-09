(() => {
  const state = { validated: false };
  const EMAIL_RECIPIENT = 'joseluis.matesanz@salud-juntaex.es';

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

    const legacyDestroy = document.getElementById('destroySession');
    legacyDestroy?.remove();

    return { back, copy };
  }

  function ensureActionButtons() {
    const actions = document.querySelector('.validation-card .actions');
    if (!actions) return {};

    const { back, copy } = configureCompactFooter(actions);

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
      email.textContent = '@ Envío/Destruir';
      email.disabled = true;
      email.setAttribute('aria-label', 'Enviar informe y destruir sesión');
      email.setAttribute('title', 'Envío/Destruir');
      actions.append(email);
    }

    return { validate, reopen, email, back, copy };
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
    setHint(`Informe validado · destino: ${EMAIL_RECIPIENT}`);
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

  function createRequestId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `report-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function destroyEphemeralSession() {
    window.__CLINICAL_SESSION_DESTROYING = true;
    state.validated = false;

    document.querySelectorAll('textarea').forEach((field) => {
      field.value = '';
    });
    document.querySelectorAll('input[type="text"], input[type="search"]').forEach((field) => {
      field.value = '';
    });

    const reportEditor = editor();
    if (reportEditor) reportEditor.replaceChildren();

    ['routingGrid', 'sourcesList', 'missingList', 'conflictList', 'alertList', 'reportPendingBanner'].forEach((id) => {
      const element = document.getElementById(id);
      if (element) element.replaceChildren();
    });

    setTimeout(() => {
      const cleanUrl = `${window.location.pathname}${window.location.search}`;
      window.location.replace(cleanUrl);
    }, 250);
  }

  async function sendAndDestroy() {
    const emailButton = document.getElementById('prepareReportEmail');
    const text = getValidatedReportText();

    if (!text) {
      if (emailButton) emailButton.disabled = true;
      setHint('El informe debe estar validado antes del envío.');
      return;
    }

    if (emailButton) {
      emailButton.disabled = true;
      emailButton.textContent = 'Enviando…';
    }
    setHint(`Enviando informe validado a ${EMAIL_RECIPIENT}…`);

    try {
      const response = await fetch('/api/send-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'clinical-report',
        },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          report: text,
          requestId: createRequestId(),
        }),
      });

      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }

      if (!response.ok || payload?.ok !== true || payload?.accepted !== true) {
        const error = new Error(payload?.error || 'email_send_failed');
        error.status = response.status;
        error.code = payload?.error || 'email_send_failed';
        throw error;
      }

      setHint('Envío aceptado por el servidor. Destruyendo la sesión…');
      destroyEphemeralSession();
    } catch (error) {
      if (emailButton) {
        emailButton.textContent = '@ Envío/Destruir';
        emailButton.disabled = !state.validated;
      }

      if (error?.status === 503 || error?.code === 'email_transport_not_configured') {
        setHint('El envío automático todavía no está configurado en el servidor. No se ha enviado nada y la sesión se conserva.');
        return;
      }

      setHint('No se ha podido confirmar el envío. La sesión se conserva para poder reintentarlo.');
    }
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
      void sendAndDestroy();
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