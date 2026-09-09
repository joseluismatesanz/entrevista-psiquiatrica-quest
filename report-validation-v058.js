(() => {
  const state = {
    revision: 0,
    reviewedRevision: 0,
    validatedRevision: null,
  };

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

  function validationLabel() {
    return document.querySelector('.validation-card .checkline span');
  }

  function isEditing() {
    return Boolean(editor()?.querySelector('.report-section-editing'));
  }

  function ensureReviewChangesButton() {
    let button = document.getElementById('reviewReportChanges');
    if (button) return button;

    const actions = document.querySelector('.validation-card .actions');
    if (!actions) return null;

    button = document.createElement('button');
    button.id = 'reviewReportChanges';
    button.type = 'button';
    button.className = 'secondary hidden';
    button.textContent = 'He revisado los cambios';
    actions.prepend(button);
    return button;
  }

  function setHint(message) {
    const hint = validationHint();
    if (hint) hint.textContent = message;
  }

  function setValidationLabel(message) {
    const label = validationLabel();
    if (label) label.textContent = message;
  }

  function hasUnreviewedChanges() {
    return state.reviewedRevision !== state.revision;
  }

  function syncControls() {
    const check = checkbox();
    const copy = copyButton();
    const reviewButton = ensureReviewChangesButton();
    const editing = isEditing();
    const pendingReview = hasUnreviewedChanges();

    if (reviewButton) {
      reviewButton.classList.toggle('hidden', !pendingReview);
      reviewButton.disabled = editing;
    }

    if (check) {
      check.disabled = editing || pendingReview;
      if (editing || pendingReview) check.checked = false;
    }

    if (editing) {
      setValidationLabel('Finaliza la edición para poder validar el informe.');
    } else if (pendingReview) {
      setValidationLabel('Validación bloqueada hasta confirmar que has revisado los cambios.');
    } else {
      setValidationLabel('He revisado el contenido y asumo la validación clínica del informe.');
    }

    if (copy) {
      const validCurrent = Boolean(
        check?.checked
        && state.validatedRevision === state.revision
        && !editing
        && !pendingReview
      );
      copy.disabled = !validCurrent;
    }
  }

  function invalidateValidation(message = 'Cambios pendientes de revalidación. Pulsa «He revisado los cambios» antes de volver a validar el informe.') {
    state.revision += 1;
    state.reviewedRevision = null;
    state.validatedRevision = null;

    const check = checkbox();
    const copy = copyButton();
    if (check) check.checked = false;
    if (copy) copy.disabled = true;
    setHint(message);
    syncControls();
  }

  function resetValidation() {
    state.revision = 0;
    state.reviewedRevision = 0;
    state.validatedRevision = null;

    const check = checkbox();
    const copy = copyButton();
    if (check) {
      check.checked = false;
      check.disabled = false;
    }
    if (copy) copy.disabled = true;

    const reviewButton = ensureReviewChangesButton();
    reviewButton?.classList.add('hidden');
    setHint('El borrador no debe exportarse sin revisión profesional.');
    syncControls();
  }

  function markChangesReviewed() {
    if (isEditing()) return;
    state.reviewedRevision = state.revision;
    state.validatedRevision = null;

    const check = checkbox();
    if (check) {
      check.checked = false;
      check.disabled = false;
      check.focus();
    }

    setHint('Cambios revisados; falta la validación clínica. Marca ahora la casilla para validar esta versión del informe.');
    syncControls();
  }

  function handleValidationChange(event) {
    const check = event.target.closest?.('#validateCheck');
    if (!check) return;

    event.stopImmediatePropagation();

    const copy = copyButton();
    if (!check.checked) {
      state.validatedRevision = null;
      if (copy) copy.disabled = true;
      setHint(hasUnreviewedChanges()
        ? 'Cambios pendientes de revalidación. Pulsa «He revisado los cambios» antes de validar.'
        : 'El borrador no debe exportarse sin revisión profesional.');
      syncControls();
      return;
    }

    if (isEditing() || hasUnreviewedChanges()) {
      check.checked = false;
      state.validatedRevision = null;
      if (copy) copy.disabled = true;
      setHint(isEditing()
        ? 'Finaliza la edición antes de validar el informe.'
        : 'Primero confirma que has revisado los cambios antes de volver a validar.');
      syncControls();
      return;
    }

    state.validatedRevision = state.revision;
    if (copy) copy.disabled = false;
    setHint('Informe revisado y validado por el profesional para esta versión.');
    syncControls();
  }

  async function handleCopy(event) {
    const button = event.target.closest?.('#copyReport');
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const check = checkbox();
    const validForCurrentRevision = Boolean(
      check?.checked
      && state.validatedRevision === state.revision
      && state.reviewedRevision === state.revision
      && !isEditing()
    );

    if (!validForCurrentRevision) {
      if (check) check.checked = false;
      button.disabled = true;
      state.validatedRevision = null;
      setHint('El informe no está validado para su revisión actual. Revisa los cambios y vuelve a validarlo.');
      syncControls();
      return;
    }

    const text = typeof window.getClinicalReportText === 'function'
      ? window.getClinicalReportText()
      : (editor()?.innerText || editor()?.textContent || '').trim();

    try {
      await navigator.clipboard.writeText(text);
      setHint('Informe copiado tras validación clínica de esta versión.');
    } catch {
      setHint('No se pudo copiar automáticamente; selecciona el texto manualmente.');
    }
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#reviewReportChanges')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      markChangesReviewed();
      return;
    }

    if (event.target.closest?.('.report-edit-button')) {
      invalidateValidation('Edición iniciada. Finaliza los cambios y después pulsa «He revisado los cambios».');
      setTimeout(syncControls, 0);
      return;
    }

    if (event.target.closest?.('.report-section-save')) {
      invalidateValidation();
      setTimeout(syncControls, 0);
      return;
    }

    if (event.target.closest?.('.report-section-cancel')) {
      invalidateValidation('La validación anterior se ha retirado tras abrir una edición. Pulsa «He revisado los cambios» antes de volver a validar.');
      setTimeout(syncControls, 0);
      return;
    }

    if (event.target.closest?.('[data-go="report"], [data-step="report"]')) {
      setTimeout(resetValidation, 0);
    }
  }, true);

  document.addEventListener('input', (event) => {
    if (!event.target.matches?.('.report-section-input')) return;
    invalidateValidation();
  }, true);

  document.addEventListener('change', handleValidationChange, true);
  document.addEventListener('click', handleCopy, true);

  window.addEventListener('pageshow', resetValidation);
  resetValidation();
})();
