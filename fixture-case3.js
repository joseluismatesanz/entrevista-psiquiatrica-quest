(() => {
  const CASE3_THREE_SOURCES = `PSIQUIATRA: Paula, 17 años, acude acompañada por su madre. ¿Qué os preocupa hoy?
PACIENTE: Llevo unos diez días muy nerviosa y duermo unas cuatro horas. Desde hace una semana pienso que mi madre no es realmente mi madre. Se parece, pero noto cosas distintas y creo que puede haber sido sustituida.
MADRE: Soy su madre biológica. No ha habido adopción ni ningún cambio de cuidador. Esto empezó hace una semana y antes nunca había dicho algo así.
PSIQUIATRA: ¿Con quién vives actualmente?
PACIENTE: Vivo con mi madre y mi hermano pequeño. Normalmente me llevo bien con los dos. Mi padre vive en otra ciudad y lo veo algunos fines de semana.
MADRE: Eso es correcto. Vivimos los tres en casa y mantiene contacto con su padre.
PSIQUIATRA: ¿Oyes voces o ves cosas que los demás no ven?
PACIENTE: No oigo voces ni veo cosas. Solo tengo esa sensación con mi madre y me cuesta quitármela de la cabeza.
PSIQUIATRA: ¿Has pensado en hacerte daño, morir o hacer daño a alguien?
PACIENTE: No. No quiero hacerme daño ni hacer daño a nadie.
MADRE: No he visto autolesiones ni amenazas, pero está más aislada y ha faltado dos días al instituto.
PSIQUIATRA: ¿Consumo de alcohol, cannabis u otras sustancias?
PACIENTE: No consumo cannabis ni otras drogas. Alcohol muy ocasional, quizá una copa en alguna celebración.
PSIQUIATRA: ¿Tomas medicación habitual?
PACIENTE: No tomo ninguna medicación.
PSIQUIATRA: ¿Antecedentes médicos o psiquiátricos?
PACIENTE: No tengo enfermedades importantes y nunca he ido a Salud Mental ni he ingresado.
PSIQUIATRA: ¿Antecedentes psiquiátricos en tu familia?
PACIENTE: Mi abuelo materno tuvo depresión.
MADRE: Una tía de su padre tuvo trastorno bipolar.
PSIQUIATRA: Durante la entrevista estás consciente, orientada, colaboradora y con discurso organizado. Mantienes la convicción de que tu madre podría haber sido sustituida, aunque reconoces que no tienes pruebas y que podría estar equivocada. No se objetivan alteraciones del lenguaje ni agitación. Niega fenómenos alucinatorios e ideación autolítica o heteroagresiva.
PSIQUIATRA: Con esta entrevista breve no voy a cerrar un diagnóstico. Necesitamos ampliar cronología, impacto funcional, sueño, posibles causas médicas y evolución del contenido ideativo. Propongo valoración preferente por Salud Mental Infanto-Juvenil en 24-48 horas y vigilancia familiar mientras tanto.
PACIENTE: De acuerdo, acepto la valoración.
MADRE: Yo también estoy de acuerdo.`;

  const button = document.getElementById('loadCase3');
  if (!button) return;

  button.addEventListener('click', () => {
    document.getElementById('speakerMappingCard')?.classList.add('hidden');
    const area = document.getElementById('caseText');
    if (area) area.value = CASE3_THREE_SOURCES;
    const message = document.getElementById('sessionMessage');
    if (message) message.textContent = 'Caso 3 cargado: tres fuentes ficticias (Psiquiatra, Paciente y Madre).';
  });
})();
