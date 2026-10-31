(() => {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {
      console.warn('No se pudo activar la instalación de la aplicación.');
    });
  }, { once: true });
})();
