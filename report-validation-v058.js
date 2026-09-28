(() => {
  const state = {
    validated: false,
    copied: false,
    pendingDestroy: false,
    destroyTimer: null,
  };

  function checkbox() {
    return document.getElementById('validateCheck');
  }

  function copyButton() {
    return document.getElementById('copyReport');
  }

  function finalizeButton() {
    return document.getElementById('finalizeSession');
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

  function resetDestroyConfirmation() {
    if (state.destroyTimer) clearTimeout(state.destroyTimer);
    state.destroyTimer = null;
    state.pendingDestroy = false;
    const finalize = finalizeButton();
    if (finalize) {
      finalize.textContent = 'Finalizar y borrar';
      finalize.classList.remove('confirm-destroy');
      finalize.disabled = !state.validated || !state.copied;
    }
  }

  function configureCompactFooter(actions) {
    const back = actions?.querySelector('[data-go="review"]');
    if (back) {
      back.id = 'backToReview';
      back.textContent = '←';
      back.classList.add('footer-back');
      back.setAttribute('aria-label', 'Volver a revisión');
      back.setAttribute('title', 'Volver a revisión');
    }

    const copy = copyButton();
    if (copy) copy.textContent = 'Copiar informe';

    document.getElementById('destroySession')?.remove();
    document.getElementById('prepareReportEmail')?.remove();

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

    let finalize = finalizeButton();
    if (!finalize) {
      finalize = document.createElement('button');
      finalize.id = 'finalizeSession';
      finalize.type = 'button';
      finalize.className = 'danger secondary-danger';
      finalize.textContent = 'Finalizar y borrar';
      finalize.disabled = true;
      finalize.setAttribute('aria-label', 'Finalizar y borrar la sesión local');
      actions.append(finalize);
    }

    return { validate, reopen, finalize, back, copy };
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
    editor()?.classList.toggle('report-locked', locked);
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
    state.copied = false;
    const check = checkbox();
    const copy = copyButton();
    const { validate, reopen } = ensureActionButtons();
    if (check) check.checked = false;
    if (copy) copy.disabled = true;
    if (validate) validate.classList.remove('hidden');
    if (reopen) reopen.classList.add('hidden');
    resetDestroyConfirmation();
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
    state.copied = false;
    const check = checkbox();
    const copy = copyButton();
    const { validate, reopen } = ensureActionButtons();
    if (check) check.checked = true;
    if (copy) copy.disabled = false;
    if (validate) validate.classList.add('hidden');
    if (reopen) reopen.classList.remove('hidden');
    resetDestroyConfirmation();
    setEditLocked(true);
    if (badge()) badge().textContent = 'Informe validado · edición bloqueada';
    if (eyebrow()) eyebrow().textContent = 'DOCUMENTO CLÍNICO VALIDADO';
    setHint('Informe validado. Copia el texto antes de finalizar y borrar la sesión local.');
  }

  function reopenEditing() {
    setUnvalidated('Edición reabierta. Cualquier cambio requerirá una nueva validación.');
  }

  function invalidateBeforeLeavingReport() {
    if (!state.validated) return;
    setUnvalidated('Has salido del informe validado. Al volver, deberás validarlo de nuevo.');
  }

  function resetValidation() {
    hideLegacyValidationCheckbox();
    setUnvalidated('Revisa el borrador y pulsa «Validar informe» cuando esté listo.');
  }

  function getValidatedReportText() {
    if (!state.validated || isEditing()) return '';
    if (typeof window.getClinicalReportText === 'function') return window.getClinicalReportText().trim();
    return (editor()?.innerText || editor()?.textContent || '').trim();
  }

  async function copyValidatedReport() {
    const text = getValidatedReportText();
    if (!text) {
      state.copied = false;
      resetDestroyConfirmation();
      setHint('El informe debe estar validado antes de copiarlo.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      state.copied = true;
      resetDestroyConfirmation();
      setHint('Informe copiado. Guárdalo en el destino autorizado; después podrás finalizar y borrar esta sesión.');
    } catch {
      state.copied = false;
      resetDestroyConfirmation();
      setHint('No se pudo copiar automáticamente. Selecciona el informe manualmente antes de cerrar la sesión.');
    }
  }

  function destroyEphemeralSession() {
    window.__CLINICAL_SESSION_DESTROYING = true;
    state.validated = false;
    state.copied = false;
    if (state.destroyTimer) clearTimeout(state.destroyTimer);
    document.querySelectorAll('textarea').forEach((field) => { field.value = ''; });
    document.querySelectorAll('input[type="text"], input[type="search"]').forEach((field) => { field.value = ''; });
    editor()?.replaceChildren();
    ['routingGrid', 'sourcesList', 'missingList', 'conflictList', 'alertList', 'reportPendingBanner'].forEach((id) => {
      document.getElementById(id)?.replaceChildren();
    });
    if (copyButton()) copyButton().disabled = true;
    if (finalizeButton()) finalizeButton().disabled = true;
    setTimeout(() => {
      const cleanUrl = `${window.location.pathname}${window.location.search}`;
      window.location.replace(cleanUrl);
    }, 300);
  }

  function requestSessionFinalization() {
    const finalize = finalizeButton();
    if (!state.validated || !state.copied) {
      if (finalize) finalize.disabled = true;
      setHint('Valida y copia el informe antes de borrar la sesión.');
      return;
    }
    if (!state.pendingDestroy) {
      state.pendingDestroy = true;
      if (finalize) {
        finalize.textContent = 'Confirmar borrado';
        finalize.classList.add('confirm-destroy');
      }
      setHint('El informe ya está copiado. Pulsa «Confirmar borrado» para eliminar los datos locales de esta sesión.');
      state.destroyTimer = setTimeout(() => {
        resetDestroyConfirmation();
        setHint('Confirmación cancelada. La sesión sigue abierta.');
      }, 8000);
      return;
    }
    if (finalize) finalize.disabled = true;
    setHint('Borrando los datos locales de la sesión…');
    destroyEphemeralSession();
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#validateReport')) {
      event.preventDefault(); event.stopImmediatePropagation(); validateReport(); return;
    }
    if (event.target.closest?.('#reopenReport')) {
      event.preventDefault(); event.stopImmediatePropagation(); reopenEditing(); return;
    }
    if (event.target.closest?.('#copyReport')) {
      event.preventDefault(); event.stopImmediatePropagation(); copyValidatedReport(); return;
    }
    if (event.target.closest?.('#finalizeSession')) {
      event.preventDefault(); event.stopImmediatePropagation(); requestSessionFinalization(); return;
    }
    if (event.target.closest?.('.report-edit-button, .report-section-save, .report-section-cancel')) {
      setTimeout(syncValidateAvailability, 0); return;
    }
    if (event.target.closest?.('[data-go="review"], [data-step="review"], [data-go="input"], [data-step="input"]')) {
      invalidateBeforeLeavingReport(); return;
    }
    if (event.target.closest?.('[data-go="report"], [data-step="report"]')) setTimeout(resetValidation, 0);
  }, true);

  document.addEventListener('input', (event) => {
    if (!event.target.matches?.('.report-section-input')) return;
    state.validated = false;
    state.copied = false;
    if (copyButton()) copyButton().disabled = true;
    if (checkbox()) checkbox().checked = false;
    resetDestroyConfirmation();
    syncValidateAvailability();
  });

  window.addEventListener('pageshow', resetValidation);
  resetValidation();
})();
