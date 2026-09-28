(() => {
  const installButton = document.getElementById('installApp');
  const installHint = document.getElementById('installHint');
  const connectionDot = document.getElementById('connectionDot');
  const connectionLabel = document.getElementById('connectionLabel');
  let deferredInstallPrompt = null;

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function updateConnectionStatus() {
    const online = navigator.onLine;
    connectionDot?.classList.toggle('offline', !online);
    if (connectionLabel) connectionLabel.textContent = online ? 'Conexión disponible' : 'Sin conexión · no inicies una entrevista';
  }

  function showIosInstructions() {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos && !isStandalone() && installHint) {
      installHint.textContent = 'En iPhone: Compartir → Añadir a pantalla de inicio.';
    }
  }

  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
  updateConnectionStatus();
  showIosInstructions();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton?.classList.remove('hidden');
    if (installHint) installHint.textContent = 'Puedes instalar PSQ Interview como una app en este dispositivo.';
  });

  installButton?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    installButton.disabled = true;
    await deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    deferredInstallPrompt = null;
    installButton.classList.add('hidden');
    installButton.disabled = false;
    if (installHint) installHint.textContent = choice.outcome === 'accepted'
      ? 'PSQ Interview se ha añadido al dispositivo.'
      : 'La instalación se ha cancelado; puedes volver a intentarlo desde el menú del navegador.';
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installButton?.classList.add('hidden');
    if (installHint) installHint.textContent = 'PSQ Interview está instalada en este dispositivo.';
  });

  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {
      console.warn('No se pudo activar la instalación de PSQ Interview.');
    });
  }, { once: true });
})();
