(() => {
  const backendMode = Boolean(String(window.CLINICAL_API_URL || '').trim());

  if (backendMode) {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (...args) => {
      const target = args[0];
      const url = typeof target === 'string' ? target : String(target?.url || '');
      if (window.__CLINICAL_SESSION_DESTROYING && /\/api\/(?:transcribe|analyze)(?:$|[/?#])/i.test(url)) {
        return Promise.reject(new DOMException('Sesión destruida: solicitud cancelada.', 'AbortError'));
      }
      return nativeFetch(...args);
    };

    document.addEventListener('click', (event) => {
      const element = event.target instanceof Element ? event.target.closest('#destroyInput, #destroySession') : null;
      if (!element) return;

      window.__CLINICAL_SESSION_DESTROYING = true;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.reload();
    }, true);
  }

  const script = document.createElement('script');
  script.src = backendMode ? 'backend-client.js' : 'app.js';
  script.async = false;
  script.dataset.engine = backendMode ? 'structured' : 'local';
  document.body.appendChild(script);
})();
