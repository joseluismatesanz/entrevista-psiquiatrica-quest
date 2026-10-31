(() => {
  const EMAIL_RECIPIENT = 'joseluis.matesanz@salud-juntaex.es';

  const emailButton = () => document.getElementById('prepareReportEmail');
  const transcriptField = () => document.getElementById('caseText');
  const reportEditor = () => document.getElementById('reportEditor');

  function reportText() {
    if (!window.__CLINICAL_REPORT_AVAILABLE) return '';
    if (typeof window.getClinicalReportText === 'function') {
      return window.getClinicalReportText().trim();
    }
    return (reportEditor()?.innerText || reportEditor()?.textContent || '').trim();
  }

  function availableText() {
    const report = reportText();
    if (report) return { text: report, kind: 'Informe clínico' };
    const transcript = transcriptField()?.value.trim() || '';
    if (transcript) return { text: transcript, kind: 'Transcripción clínica' };
    return { text: '', kind: 'Documento clínico' };
  }

  function syncSendAction() {
    const button = emailButton();
    if (!button) return;
    button.textContent = 'Envío / Borrar';
    button.setAttribute('aria-label', 'Enviar por correo el contenido disponible y borrar la sesión');
    button.setAttribute('title', 'Envío / Borrar');
    button.disabled = !availableText().text;
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

  function sendAndDestroy() {
    const content = availableText();
    if (!content.text) {
      syncSendAction();
      return;
    }
    const subject = content.kind;
    const body = `${content.kind}\n\n${content.text}`;
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

  transcriptField()?.addEventListener('input', syncSendAction);
  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('#prepareReportEmail')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    sendAndDestroy();
  }, true);
  window.addEventListener('pageshow', syncSendAction);
  window.addEventListener('clinical-transcription-ready', syncSendAction);
  window.addEventListener('clinical-report-ready', syncSendAction);
  window.sendValidatedClinicalReport = sendAndDestroy;
  syncSendAction();
})();
