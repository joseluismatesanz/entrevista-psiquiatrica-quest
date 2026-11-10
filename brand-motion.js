(() => {
  const button = document.getElementById('brandMotion');
  if (!button) return;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const setPaused = (paused) => {
    button.classList.toggle('motion-paused', paused);
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', `${paused ? 'Reanudar' : 'Pausar'} animación del logotipo FOCVS`);
  };
  setPaused(preference.matches);
  preference.addEventListener('change', (event) => setPaused(event.matches));
  button.addEventListener('click', () => setPaused(!button.classList.contains('motion-paused')));
})();
