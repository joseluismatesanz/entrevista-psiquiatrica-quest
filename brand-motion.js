(() => {
  const button = document.getElementById('brandMotion');
  if (!button) return;
  const setPaused = (paused) => {
    button.classList.toggle('motion-paused', paused);
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', `${paused ? 'Reanudar' : 'Pausar'} animación del logotipo FOCVS`);
  };
  // The requested logo starts rotating on mobile too; its button always allows pausing.
  setPaused(false);
  button.addEventListener('click', () => setPaused(!button.classList.contains('motion-paused')));
})();
