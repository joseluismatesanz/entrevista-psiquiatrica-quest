const cases = {
  selfharm: {
    text: `Paciente mujer de 15 años que acude a Urgencias acompañada por su madre. La madre refiere que durante los últimos dos meses la nota más aislada, con descenso del rendimiento académico y abandono de actividades que anteriormente disfrutaba. Esta mañana, tras una discusión en domicilio, la paciente se realizó varios cortes superficiales en antebrazo izquierdo con una cuchilla.\n\nLa paciente refiere que se encontraba “muy agobiada” y que los cortes fueron para tranquilizarse. Niega que quisiera morir y niega en el momento de la entrevista intención suicida. Reconoce pensamientos ocasionales del tipo “ojalá pudiera desaparecer”, sin planificación según refiere.\n\nLa madre señala que dos días antes la paciente dijo: “algún día me voy a matar y os vais a arrepentir”, dato que la paciente minimiza y dice haber pronunciado enfadada.\n\nLa paciente refiere sueño irregular, con dificultad de conciliación y despertares. Refiere menor apetito durante las últimas semanas. Niega consumo habitual de alcohol y cannabis, aunque reconoce consumo ocasional de alcohol con amigos.\n\nDurante la entrevista permanece consciente y orientada, inicialmente poco colaboradora, aumentando progresivamente el contacto. Discurso espontáneo, coherente y organizado. Ánimo subjetivamente bajo. Se muestra llorosa al hablar del conflicto familiar. No se han explorado específicamente fenómenos alucinatorios. No se dispone de información sobre antecedentes familiares psiquiátricos.`,
    sources: ['Paciente', 'Madre', 'Observación clínica'],
    missing: ['Fenómenos alucinatorios: no explorados específicamente', 'Antecedentes familiares psiquiátricos: no consta información'],
    conflicts: ['La paciente niega intención suicida actual; la madre refiere una verbalización suicida dos días antes. Deben mantenerse ambas versiones.'],
    alerts: ['Autolesión reciente', 'Pensamientos ocasionales de desaparición/muerte', 'Necesidad de valorar de forma completa riesgo suicida actual y factores protectores'],
    report: `MOTIVO DE LA CONSULTA\nValoración en Urgencias tras episodio autolesivo reciente.\n\nPSQ GUARDIA\nPaciente adolescente que acude acompañada por su madre.\n\nALERGIAS / RAM\nNo consta información en el material aportado.\n\nANTECEDENTES PERSONALES SOMÁTICOS\nNo consta información en el material aportado.\n\nANTECEDENTES PERSONALES EN SALUD MENTAL\nNo consta información suficiente sobre seguimientos previos, diagnósticos o tratamientos psiquiátricos.\n\nANTECEDENTES FAMILIARES PSIQUIÁTRICOS\nNo consta información.\n\nSITUACIÓN SOCIOFAMILIAR\nLa madre refiere aislamiento progresivo, descenso del rendimiento académico y abandono de actividades previamente gratificantes durante los últimos dos meses. Se describe conflicto familiar previo al episodio autolesivo.\n\nHÁBITOS TÓXICOS\nLa paciente niega consumo habitual de alcohol y cannabis y reconoce consumo ocasional de alcohol con amigos.\n\nTRATAMIENTO HABITUAL\nNo consta información.\n\nENFERMEDAD ACTUAL\nTras una discusión en domicilio, la paciente se realizó cortes superficiales en antebrazo izquierdo con una cuchilla. Refiere que la conducta tuvo finalidad de alivio del malestar y niega intención de morir. En el momento de la entrevista niega intención suicida y reconoce pensamientos ocasionales de desaparición sin planificación. La madre refiere una verbalización suicida dos días antes, que la paciente contextualiza como emitida durante un episodio de enfado. Refiere además sueño irregular y menor apetito durante las últimas semanas.\n\nINTERVENCIÓN\nPendiente de completar valoración clínica y de riesgo.\n\nEXPLORACIÓN PSICOPATOLÓGICA\nConsciente y orientada. Inicialmente poco colaboradora, con mejoría progresiva del contacto. Discurso espontáneo, coherente y organizado. Refiere ánimo bajo y se muestra llorosa al abordar el conflicto familiar. Los fenómenos alucinatorios no han sido explorados específicamente.\n\nORIENTACIÓN DIAGNÓSTICA\nPendiente de integración clínica tras completar anamnesis, exploración y valoración de riesgo.\n\nPLAN TERAPÉUTICO\nA determinar por el profesional responsable tras completar la valoración.\n\nTRATAMIENTO ACTUAL\nNo consta información.`
  },
  autism: {
    text: `Niño de 8 años con diagnóstico previo de trastorno del espectro autista que acude acompañado de ambos progenitores por incremento de episodios de desregulación conductual.\n\nLos padres refieren que durante los últimos tres meses presenta rabietas más intensas cuando se modifican sus rutinas. En algunas ocasiones golpea a sus padres, arroja objetos y se golpea la cabeza con las manos. Señalan que los episodios duran aproximadamente 15-30 minutos y posteriormente vuelve progresivamente a su estado habitual.\n\nEl padre considera que los episodios han aumentado claramente; la madre refiere que la frecuencia es similar pero actualmente resultan más difíciles de contener físicamente.\n\nLos progenitores describen lenguaje funcional limitado, utilizando frases sencillas para solicitar necesidades. Refieren dificultades de sueño, principalmente despertares nocturnos. No aportan información sobre posibles síntomas gastrointestinales, dolor u otras causas médicas recientes.\n\nDurante la consulta el niño permanece la mayor parte del tiempo manipulando un objeto, establece contacto ocular breve e intermitente y responde a algunas preguntas sencillas. Presenta aumento de inquietud cuando los padres hablan de los episodios y solicita salir de la consulta repetidamente. No se observan conductas heteroagresivas durante la entrevista.\n\nTratamiento farmacológico actual no aportado.`,
    sources: ['Madre', 'Padre', 'Observación clínica'],
    missing: ['Tratamiento farmacológico actual: no aportado', 'Dolor, síntomas gastrointestinales u otras causas médicas recientes: no consta evaluación suficiente'],
    conflicts: ['El padre percibe aumento claro de frecuencia; la madre considera frecuencia similar con mayor dificultad de contención.'],
    alerts: ['Conductas heteroagresivas referidas en domicilio', 'Autoagresiones referidas', 'Necesidad de descartar precipitantes médicos, ambientales y comunicativos'],
    report: `MOTIVO DE LA CONSULTA\nIncremento de episodios de desregulación conductual en paciente con diagnóstico previo de TEA.\n\nPSQ GUARDIA\nPaciente de 8 años acompañado por ambos progenitores.\n\nALERGIAS / RAM\nNo consta información.\n\nANTECEDENTES PERSONALES SOMÁTICOS\nNo consta información suficiente.\n\nANTECEDENTES PERSONALES EN SALUD MENTAL\nDiagnóstico previo de trastorno del espectro autista. No consta información adicional sobre seguimientos o intervenciones previas.\n\nANTECEDENTES FAMILIARES PSIQUIÁTRICOS\nNo consta información.\n\nSITUACIÓN SOCIOFAMILIAR\nAcude acompañado por ambos progenitores, quienes aportan información sobre la conducta en domicilio.\n\nHÁBITOS TÓXICOS\nNo procede / no explorado en el material aportado.\n\nTRATAMIENTO HABITUAL\nNo aportado.\n\nENFERMEDAD ACTUAL\nLos progenitores refieren episodios de desregulación asociados a cambios de rutina, con lanzamiento de objetos, golpes a familiares y autoagresiones mediante golpes en la cabeza. Refieren una duración aproximada de 15-30 minutos y recuperación posterior. Existe discrepancia entre ambos progenitores respecto a si ha aumentado la frecuencia o principalmente la dificultad de contención. Refieren despertares nocturnos. No consta valoración suficiente de dolor, síntomas gastrointestinales u otros posibles precipitantes médicos recientes.\n\nINTERVENCIÓN\nPendiente de completar análisis funcional y despistaje de factores precipitantes.\n\nEXPLORACIÓN PSICOPATOLÓGICA\nDurante la consulta permanece gran parte del tiempo manipulando un objeto. Contacto ocular breve e intermitente. Responde a algunas preguntas sencillas. Aumenta la inquietud cuando se abordan los episodios y solicita salir repetidamente. No se observan conductas heteroagresivas durante la entrevista. No se infieren otros dominios psicopatológicos no evaluables o no explorados.\n\nORIENTACIÓN DIAGNÓSTICA\nTEA conocido. Desregulación conductual de etiología pendiente de caracterización clínica y funcional.\n\nPLAN TERAPÉUTICO\nA determinar tras completar valoración clínica, médica y contextual.\n\nTRATAMIENTO ACTUAL\nNo aportado.`
  },
  psychosis: {
    text: `Varón de 17 años traído a Urgencias por sus padres. Durante aproximadamente tres semanas la familia refiere aislamiento progresivo, abandono de los estudios y comportamiento extraño. En los últimos días permanece por la noche despierto y afirma que algunos compañeros están difundiendo información sobre él por redes sociales.\n\nEl paciente refiere que sus compañeros “saben cosas que no deberían saber” y que cree que determinados vídeos de internet contienen mensajes relacionados con él. Cuando se le pregunta si escucha voces, contesta inicialmente que no, pero posteriormente refiere que en ocasiones escucha murmullos cuando está solo y no puede asegurar si proceden de la calle o de dentro de casa.\n\nReconoce consumo de cannabis prácticamente diario durante los últimos seis meses, aumentando el consumo durante el último mes. Niega otros tóxicos.\n\nLa madre refiere que un tío materno estuvo ingresado en Psiquiatría en varias ocasiones, sin conocer el diagnóstico.\n\nDurante la entrevista está consciente y orientado globalmente. Presenta actitud suspicaz y realiza frecuentes comprobaciones hacia la puerta. Discurso comprensible, con respuestas ocasionalmente vagas. Se objetiva ideación de contenido autorreferencial y persecutorio durante la entrevista. No manifiesta ideación suicida al preguntarle directamente. No se ha explorado de forma suficiente riesgo heteroagresivo.\n\nNo consta tratamiento psiquiátrico previo.`,
    sources: ['Paciente', 'Madre/familia', 'Observación clínica'],
    missing: ['Riesgo heteroagresivo: exploración insuficiente', 'Diagnóstico del antecedente psiquiátrico familiar: desconocido'],
    conflicts: ['Ante la pregunta sobre voces, inicialmente las niega y posteriormente refiere murmullos de localización incierta.'],
    alerts: ['Sintomatología psicótica posible', 'Consumo prácticamente diario de cannabis', 'Cambio funcional subagudo', 'Riesgo heteroagresivo no suficientemente explorado'],
    report: `MOTIVO DE LA CONSULTA\nValoración urgente por cambio conductual subagudo y sintomatología de posible naturaleza psicótica.\n\nPSQ GUARDIA\nPaciente de 17 años traído por sus padres.\n\nALERGIAS / RAM\nNo consta información.\n\nANTECEDENTES PERSONALES SOMÁTICOS\nNo consta información.\n\nANTECEDENTES PERSONALES EN SALUD MENTAL\nNo consta tratamiento psiquiátrico previo. No se aporta información suficiente sobre otros antecedentes.\n\nANTECEDENTES FAMILIARES PSIQUIÁTRICOS\nLa madre refiere ingresos psiquiátricos previos de un tío materno, sin conocer diagnóstico.\n\nSITUACIÓN SOCIOFAMILIAR\nLa familia refiere aislamiento progresivo, abandono de los estudios y cambio conductual durante aproximadamente tres semanas.\n\nHÁBITOS TÓXICOS\nEl paciente refiere consumo de cannabis prácticamente diario durante los últimos seis meses, con incremento durante el último mes. Niega otros tóxicos.\n\nTRATAMIENTO HABITUAL\nNo consta tratamiento psiquiátrico previo.\n\nENFERMEDAD ACTUAL\nCambio funcional subagudo con aislamiento, abandono académico, alteración del sueño y contenido autorreferencial/persecutorio. El paciente refiere que sus compañeros conocen información sobre él y que algunos vídeos contienen mensajes relacionados con su persona. Inicialmente niega escuchar voces y posteriormente refiere murmullos ocasionales de procedencia incierta.\n\nINTERVENCIÓN\nPendiente de completar valoración clínica, toxicológica y de riesgos.\n\nEXPLORACIÓN PSICOPATOLÓGICA\nConsciente y orientado globalmente. Actitud suspicaz, con comprobaciones frecuentes hacia la puerta. Discurso comprensible, con respuestas ocasionalmente vagas. Se objetiva ideación de contenido autorreferencial y persecutorio. No manifiesta ideación suicida al ser preguntado directamente. Riesgo heteroagresivo no suficientemente explorado.\n\nORIENTACIÓN DIAGNÓSTICA\nCuadro psicótico a filiar, con necesidad de valorar relación temporal con consumo de cannabis y otras etiologías.\n\nPLAN TERAPÉUTICO\nA determinar por el profesional responsable tras completar la valoración.\n\nTRATAMIENTO ACTUAL\nNo consta.`
  }
};

const state = { selectedCase: 'selfharm', analyzed: false };
const $ = (id) => document.getElementById(id);
const caseText = $('caseText');
const caseSelect = $('caseSelect');
const validateCheck = $('validateCheck');
const copyReport = $('copyReport');

function wipeTransientState() {
  caseText.value = '';
  $('sourcesList').innerHTML = '';
  $('missingList').innerHTML = '';
  $('conflictList').innerHTML = '';
  $('alertList').innerHTML = '';
  $('reportEditor').textContent = '';
  validateCheck.checked = false;
  copyReport.disabled = true;
  state.analyzed = false;
}

function loadSelectedCase() {
  state.selectedCase = caseSelect.value;
  caseText.value = cases[state.selectedCase].text;
  $('sessionMessage').textContent = '';
}

function renderList(id, values) {
  $(id).innerHTML = values.map(value => `<li>${escapeHtml(value)}</li>`).join('');
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));
}

function renderAnalysis() {
  const data = cases[state.selectedCase];
  $('sourcesList').innerHTML = data.sources.map(source => `<span class="tag">${escapeHtml(source)}</span>`).join('');
  renderList('missingList', data.missing);
  renderList('conflictList', data.conflicts);
  renderList('alertList', data.alerts);
  $('reportEditor').textContent = data.report;
  state.analyzed = true;
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.step').forEach(el => el.classList.toggle('active', el.dataset.step === name));
  $(`screen-${name}`).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

caseSelect.addEventListener('change', loadSelectedCase);
$('loadCase').addEventListener('click', loadSelectedCase);
$('analyzeCase').addEventListener('click', () => {
  // V0.2 deliberately uses deterministic fictional fixtures. No network request is performed.
  renderAnalysis();
  showScreen('review');
});

document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => {
  const target = button.dataset.go;
  if (target === 'report' && !state.analyzed) renderAnalysis();
  showScreen(target);
}));

document.querySelectorAll('.step').forEach(button => button.addEventListener('click', () => {
  const target = button.dataset.step;
  if (target !== 'input' && !state.analyzed) return;
  showScreen(target);
}));

$('recordButton').addEventListener('click', () => {
  alert('Micrófono real bloqueado en V0.2. Antes de activarlo se validará captura efímera, anonimización previa y destrucción de buffers.');
});

validateCheck.addEventListener('change', () => { copyReport.disabled = !validateCheck.checked; });
copyReport.addEventListener('click', async () => {
  if (!validateCheck.checked) return;
  const text = $('reportEditor').innerText;
  try {
    await navigator.clipboard.writeText(text);
    $('sessionMessage').textContent = 'Informe copiado. La aplicación no crea un historial clínico.';
  } catch {
    $('sessionMessage').textContent = 'No se pudo acceder al portapapeles. Selecciona el texto manualmente.';
  }
});

$('destroySession').addEventListener('click', () => {
  wipeTransientState();
  showScreen('input');
  $('sessionMessage').textContent = '';
});

window.addEventListener('pagehide', wipeTransientState);
window.addEventListener('beforeunload', wipeTransientState);

// Privacy guardrails for V0.2: no localStorage, sessionStorage, IndexedDB, cookies or network calls.
loadSelectedCase();
