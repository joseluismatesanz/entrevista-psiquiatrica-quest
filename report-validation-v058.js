(() => {
  const EMAIL_RECIPIENT = 'joseluis.matesanz@salud-juntaex.es';

  const emailButton = () => document.getElementById('prepareReportEmail');
  const transcriptField = () => document.getElementById('caseText');
  const reportEditor = () => document.getElementById('reportEditor');
  let automaticSendPending = false;
  let automaticSendTimer = null;
  let automaticSendStartedAt = 0;

  function updateSendTimer(finalLabel = '') {
    const timer = document.getElementById('prepareReportEmailTimer');
    if (!timer || !automaticSendStartedAt) return;
    const seconds = Math.max(0, Math.floor((Date.now() - automaticSendStartedAt) / 1000));
    timer.textContent = `${finalLabel || 'Generando informe y preparando correo'} · ${seconds} s`;
  }

  function startSendTimer() {
    if (automaticSendTimer) clearInterval(automaticSendTimer);
    automaticSendStartedAt = Date.now();
    updateSendTimer();
    automaticSendTimer = setInterval(() => updateSendTimer(), 1_000);
  }

  function finishSendTimer(label) {
    if (automaticSendTimer) clearInterval(automaticSendTimer);
    automaticSendTimer = null;
    updateSendTimer(label);
  }

  function reportText() {
    if (!window.__CLINICAL_REPORT_AVAILABLE) return '';
    if (typeof window.getClinicalReportText === 'function') {
      return window.getClinicalReportText().trim();
    }
    return (reportEditor()?.innerText || reportEditor()?.textContent || '').trim();
  }

  function syncSendAction() {
    const button = emailButton();
    if (!button) return;
    button.textContent = 'Envío / Borrar';
    button.setAttribute('aria-label', 'Generar y enviar por correo el informe clínico y borrar la sesión');
    button.setAttribute('title', 'Envío / Borrar');
    button.disabled = false;
  }

  function waitForAutomaticReport() {
    const transcript = transcriptField()?.value.trim() || '';
    if (!transcript) return Promise.reject(new Error('No hay una transcripción disponible para generar el informe.'));
    const analyzeButton = document.getElementById('analyzeCase');
    if (!analyzeButton) return Promise.reject(new Error('No se encuentra la acción de información clínica.'));

    if (typeof window.runClinicalReportGeneration === 'function') {
      return window.runClinicalReportGeneration().then((result) => {
        if (!result || !reportText()) throw new Error('No se pudo generar el informe clínico.');
      });
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('La generación automática del informe ha superado el tiempo permitido.')), 230_000);
      const onReady = () => finish();
      const onError = (event) => finish(new Error(event.detail?.message || 'No se pudo generar el informe clínico.'));
      function finish(error) {
        clearTimeout(timeout);
        window.removeEventListener('clinical-report-ready', onReady);
        window.removeEventListener('clinical-report-error', onError);
        if (error) reject(error);
        else resolve();
      }
      window.addEventListener('clinical-report-ready', onReady, { once: true });
      window.addEventListener('clinical-report-error', onError, { once: true });
      analyzeButton.click();
    });
  }

  function markAutomaticallyValidated() {
    window.__CLINICAL_REPORT_AUTO_VALIDATED = true;
    reportEditor()?.classList.add('report-locked');
    document.querySelectorAll('.report-edit-button').forEach((button) => {
      button.disabled = true;
      button.classList.add('hidden');
    });
    const badge = document.querySelector('#screen-report .draft-badge');
    const eyebrow = document.querySelector('#screen-report .report-heading .section-label');
    if (badge) badge.textContent = 'Informe validado automáticamente';
    if (eyebrow) eyebrow.textContent = 'DOCUMENTO CLÍNICO VALIDADO AUTOMÁTICAMENTE';
  }

  function destroyEphemeralSession() {
    window.__CLINICAL_SESSION_DESTROYING = true;
    window.__CLINICAL_REPORT_AVAILABLE = false;
    document.querySelectorAll('textarea').forEach((field) => { field.value = ''; });
    document.querySelectorAll('input[type="text"], input[type="search"]').forEach((field) => { field.value = ''; });
    reportEditor()?.replaceChildren();
    ['routingGrid', 'sourcesList', 'missingList', 'conflictList', 'alertList', 'reportPendingBanner'].forEach((id) => {
      document.getElementById(id)?.replaceChildren();
    });
    if (emailButton()) emailButton().disabled = true;
    setTimeout(() => {
      const cleanUrl = `${window.location.pathname}${window.location.search}`;
      window.location.replace(cleanUrl);
    }, 900);
  }

  function openReportEmailAndDestroy() {
    const text = reportText();
    if (!text) throw new Error('El informe clínico generado está vacío.');
    markAutomaticallyValidated();
    const subject = 'Informe clínico validado';
    const body = `Informe clínico validado\n\n${text}`;
    const mailto = `mailto:${EMAIL_RECIPIENT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const button = emailButton();
    if (button) {
      button.disabled = true;
      button.textContent = 'Abriendo correo…';
    }
    const link = document.createElement('a');
    link.href = mailto;
    link.style.display = 'none';
    link.setAttribute('aria-hidden', 'true');
    document.body.append(link);
    link.click();
    link.remove();
    destroyEphemeralSession();
  }

  async function generateSendAndDestroy() {
    if (automaticSendPending) return;
    automaticSendPending = true;
    startSendTimer();
    const button = emailButton();
    try {
      if (!reportText()) {
        if (button) {
          button.disabled = true;
          button.textContent = 'Creando informe…';
        }
        await waitForAutomaticReport();
      }
      openReportEmailAndDestroy();
      finishSendTimer('Correo preparado');
    } catch (error) {
      automaticSendPending = false;
      finishSendTimer('Proceso interrumpido');
      syncSendAction();
      const message = document.getElementById('sessionMessage');
      if (message) message.textContent = `No se pudo preparar el envío: ${error.message}`;
    }
  }

  transcriptField()?.addEventListener('input', syncSendAction);
  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('#prepareReportEmail')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void generateSendAndDestroy();
  }, true);
  window.addEventListener('pageshow', syncSendAction);
  window.addEventListener('clinical-transcription-ready', syncSendAction);
  window.addEventListener('clinical-report-ready', syncSendAction);
  window.sendValidatedClinicalReport = generateSendAndDestroy;
  syncSendAction();
})();
