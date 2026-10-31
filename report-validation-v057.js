(() => {
  const state = {
    revision: 0,
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

  function isEditing() {
    return Boolean(editor()?.querySelector('.report-section-editing'));
  }

  function setHint(message) {
    const hint = validationHint();
    if (hint) hint.textContent = message;
  }

  function invalidateValidation(message = 'El informe ha sido modificado. Revísalo y vuelve a validarlo antes de copiarlo.') {
    state.revision += 1;
    state.validatedRevision = null;

    const check = checkbox();
    const copy = copyButton();
    if (check) check.checked = false;
    if (copy) copy.disabled = true;
    setHint(message);
  }

  function resetValidation() {
    state.validatedRevision = null;
    const check = checkbox();
    const copy = copyButton();
    if (check) {
      check.checked = false;
      check.disabled = false;
    }
    if (copy) copy.disabled = true;
    setHint('El borrador no debe exportarse sin revisión profesional.');
  }

  function syncEditingState() {
    const check = checkbox();
    const copy = copyButton();
    const editing = isEditing();

    if (check) check.disabled = editing;
    if (editing) {
      if (check) check.checked = false;
      if (copy) copy.disabled = true;
      state.validatedRevision = null;
      setHint('Finaliza la edición antes de validar el informe.');
    }
  }

  function handleValidationChange(event) {
    const check = event.target.closest?.('#validateCheck');
    if (!check) return;

    event.stopImmediatePropagation();

    const copy = copyButton();
    if (!check.checked) {
      state.validatedRevision = null;
      if (copy) copy.disabled = true;
      setHint('El borrador no debe exportarse sin revisión profesional.');
      return;
    }

    if (isEditing()) {
      check.checked = false;
      check.disabled = true;
      state.validatedRevision = null;
      if (copy) copy.disabled = true;
      setHint('Finaliza la edición antes de validar el informe.');
      return;
    }

    state.validatedRevision = state.revision;
    if (copy) copy.disabled = false;
    setHint('Informe revisado y validado por el profesional para esta versión.');
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
      && !isEditing()
    );

    if (!validForCurrentRevision) {
      if (check) check.checked = false;
      button.disabled = true;
      state.validatedRevision = null;
      setHint('El informe ha cambiado desde la última validación. Revísalo y vuelve a validarlo.');
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
    if (event.target.closest?.('.report-edit-button')) {
      invalidateValidation('Se ha iniciado una edición. Finalízala y vuelve a validar el informe.');
      setTimeout(syncEditingState, 0);
      return;
    }

    if (event.target.closest?.('.report-section-save')) {
      invalidateValidation();
      setTimeout(syncEditingState, 0);
      return;
    }

    if (event.target.closest?.('.report-section-cancel')) {
      invalidateValidation('La validación anterior se ha retirado tras abrir una edición. Revisa el informe y vuelve a validarlo.');
      setTimeout(syncEditingState, 0);
      return;
    }

    if (event.target.closest?.('[data-go="report"], [data-step="report"]')) {
      setTimeout(resetValidation, 0);
    }
  }, true);

  document.addEventListener('input', (event) => {
    if (!event.target.matches?.('.report-section-input')) return;
    invalidateValidation();
    syncEditingState();
  }, true);

  document.addEventListener('change', handleValidationChange, true);
  document.addEventListener('click', handleCopy, true);

  window.addEventListener('pageshow', resetValidation);
  resetValidation();
})();