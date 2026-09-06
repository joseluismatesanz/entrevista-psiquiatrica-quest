(() => {
  const backendMode = Boolean(String(window.CLINICAL_API_URL || '').trim());
  const script = document.createElement('script');
  script.src = backendMode ? 'backend-client.js' : 'app.js';
  script.async = false;
  script.dataset.engine = backendMode ? 'structured' : 'local';
  document.body.appendChild(script);
})();
