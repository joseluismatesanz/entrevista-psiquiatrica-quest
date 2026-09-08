(() => {
  function resetReportValidation() {
    const checkbox = document.getElementById('validateCheck');
    const copyButton = document.getElementById('copyReport');
    if (checkbox) checkbox.checked = false;
    if (copyButton) copyButton.disabled = true;
  }

  document.addEventListener('click', (event) => {
    const navigation = event.target.closest('[data-go="report"], [data-step="report"]');
    if (!navigation) return;
    setTimeout(resetReportValidation, 0);
  });

  window.addEventListener('pageshow', resetReportValidation);
  document.addEventListener('DOMContentLoaded', resetReportValidation);
  resetReportValidation();
})();
