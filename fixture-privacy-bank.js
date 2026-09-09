(() => {
  const PRIVACY_TEST_CASES = {
    A: {
      label: 'Caso A · Nombres',
      text: `PSIQUIATRA: Buenos días. Soy la doctora María García López. ¿Cómo te llamas?\nPACIENTE: Me llamo Carlos Pérez Martín. He venido con mi madre, Ana Ruiz Sánchez.\nMADRE: Sí, soy Ana Ruiz Sánchez. Mi marido se llama José Antonio Pérez Gómez.\nPSIQUIATRA: Gracias, Carlos. ¿Quién es tu médico de cabecera?\nPACIENTE: El doctor Javier de la Fuente me ve normalmente. Llevo una semana nervioso y duermo peor.`,
      mustMask: ['María García López', 'Carlos Pérez Martín', 'Ana Ruiz Sánchez', 'José Antonio Pérez Gómez', 'Carlos', 'Javier de la Fuente'],
      mustKeep: ['doctor', 'madre', 'una semana nervioso', 'duermo peor'],
    },
    B: {
      label: 'Caso B · Ambiguos',
      text: `PSIQUIATRA: Soy la doctora Mercedes Romero. ¿Cómo te llamas?\nPACIENTE: Ángel Martín. Mi hermana Paz Martín vino conmigo. Últimamente tengo poca paz y me cuesta dormir.\nPSIQUIATRA: ¿Cómo habéis venido?\nPACIENTE: Mi padre nos trajo en su Mercedes y luego se fue.\nPSIQUIATRA: Gracias, Ángel.`,
      mustMask: ['Mercedes Romero', 'Ángel Martín', 'Paz Martín', 'Ángel'],
      mustKeep: ['poca paz', 'su Mercedes', 'me cuesta dormir'],
    },
    C: {
      label: 'Caso C · Entidades',
      text: `PSIQUIATRA: ¿Dónde te atienden?\nPACIENTE: Vivo en Madrid y me atiende la doctora Elena Martín en el Hospital Universitario La Paz. Tomo sertralina 50 miligramos por la mañana.\nPSIQUIATRA: ¿Antecedentes familiares?\nPACIENTE: Mi tía Clara tiene trastorno bipolar y vive en Portugal.`,
      mustMask: ['Elena Martín', 'Clara'],
      mustKeep: ['Madrid', 'Hospital Universitario La Paz', 'sertralina 50 miligramos', 'trastorno bipolar', 'Portugal'],
    },
  };

  function ensureControls() {
    const host = document.querySelector('.fixture-buttons');
    if (!host || document.getElementById('privacyTestBank')) return;

    const wrapper = document.createElement('span');
    wrapper.className = 'privacy-test-bank';
    wrapper.setAttribute('aria-label', 'Banco de pruebas de privacidad');

    const selector = document.createElement('select');
    selector.id = 'privacyTestBank';
    selector.setAttribute('aria-label', 'Seleccionar caso de privacidad');
    selector.innerHTML = `
      <option value="A">A · Nombres</option>
      <option value="B">B · Ambiguos</option>
      <option value="C">C · Entidades</option>
    `;

    const loadButton = document.createElement('button');
    loadButton.id = 'loadPrivacyTest';
    loadButton.type = 'button';
    loadButton.className = 'secondary';
    loadButton.textContent = 'Cargar';

    wrapper.append(selector, loadButton);
    host.append(wrapper);

    if (!document.getElementById('privacyTestBankStyle')) {
      const style = document.createElement('style');
      style.id = 'privacyTestBankStyle';
      style.textContent = `
        .privacy-test-bank{display:inline-flex;gap:6px;align-items:center;padding-left:6px;border-left:1px solid #d6e3e6}
        .privacy-test-bank select{border:1px solid #c8d9de;border-radius:11px;background:#fff;color:#294d61;padding:10px 11px;font-weight:750;max-width:170px}
        .privacy-test-bank button{padding:10px 12px}
        @media(max-width:720px){.privacy-test-bank{display:grid;grid-template-columns:minmax(0,1fr) auto;padding:8px 0 0;border-left:0;border-top:1px solid #d6e3e6;margin-top:6px}.privacy-test-bank select{max-width:none;width:100%}}
      `;
      document.head.append(style);
    }
  }

  function resetSpeakerMappingUi() {
    document.getElementById('speakerMappingCard')?.classList.add('hidden');
    const fields = document.getElementById('speakerMappingFields');
    if (fields) fields.replaceChildren();
    const message = document.getElementById('speakerMappingMessage');
    if (message) message.textContent = '';
  }

  function renderCriteria(testCase) {
    const message = document.getElementById('sessionMessage');
    if (!message) return;
    message.textContent = `${testCase.label} cargado. Deben anonimizarse: ${testCase.mustMask.join(', ')}. Deben conservarse: ${testCase.mustKeep.join(', ')}.`;
  }

  function loadSelectedPrivacyCase() {
    const selector = document.getElementById('privacyTestBank');
    const key = selector?.value;
    const testCase = PRIVACY_TEST_CASES[key];
    if (!testCase) return;

    resetSpeakerMappingUi();
    const area = document.getElementById('caseText');
    if (area) area.value = testCase.text;
    renderCriteria(testCase);
  }

  ensureControls();
  document.getElementById('loadPrivacyTest')?.addEventListener('click', loadSelectedPrivacyCase);
  window.PRIVACY_TEST_CASES = PRIVACY_TEST_CASES;
})();