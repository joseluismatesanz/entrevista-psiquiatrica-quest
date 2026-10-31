(() => {
  const CASE1_FULL = `PSIQUIATRA: Lucía, 16 años, acude acompañada por su madre. ¿Por qué venís hoy?
PACIENTE: Ayer, sobre las once de la noche, después de discutir con mi madre, me hice varios cortes superficiales en el antebrazo izquierdo. No quería morirme; quería dejar de sentirme tan agobiada.
MADRE: Yo la vi después. Creo que fue sobre las once y cuarto. Antes había dicho que no quería seguir viviendo.
PACIENTE: Yo diría que fue más cerca de las once y media. A veces digo cosas así cuando estoy muy saturada, pero ayer no quería matarme.
PSIQUIATRA: ¿Habías hecho algo parecido antes?
PACIENTE: Sí, cuatro o cinco veces en total. Casi siempre cortes superficiales. Mi madre sabía de menos. También me he hecho alguno en el muslo. Nunca he hecho un intento de suicidio como tal.
PSIQUIATRA: ¿Has hecho algo recientemente pensando en morir?
PACIENTE: El domingo abrí el cajón donde están los medicamentos y miré las pastillas. No tomé ninguna. Pensé en mi hermano y me dio miedo. Ahora no quiero morir, no tengo intención ni plan.
MADRE: A mí me preocupa porque algunas veces dice que sería mejor no estar.
PSIQUIATRA: ¿Qué cosas te frenan o te ayudan?
PACIENTE: Mi hermano Diego, mi madre, mi amiga Irene, mi perro y que quiero estudiar diseño o Bellas Artes.
PSIQUIATRA: ¿Cómo has estado estas últimas semanas?
PACIENTE: Unas seis semanas bastante triste casi todos los días. Me cuesta disfrutar de cosas que antes sí, estoy cansada y me cuesta concentrarme. Estoy durmiendo mal, unas tres o cuatro horas algunas noches. También como algo menos. Me siento culpable por discutir tanto en casa y he faltado bastante a clase.
MADRE: Está más aislada, con menos iniciativa y el rendimiento escolar ha bajado.
PSIQUIATRA: ¿Has tenido épocas de varios días con ánimo eufórico, mucha energía sin necesitar dormir, grandiosidad o proyectos fuera de lo habitual?
PACIENTE: No.
PSIQUIATRA: ¿Oyes voces o ves cosas que otros no ven?
PACIENTE: No.
PSIQUIATRA: ¿Ideas de que la gente te observa o habla de ti?
PACIENTE: Solo alguna vez cuando consumo cannabis me rayo pensando que me miran, pero luego sé que probablemente no es verdad.
PSIQUIATRA: ¿Antecedentes médicos?
PACIENTE: Migrañas. Reglas abundantes; el año pasado me dijeron que tenía el hierro bajo y he tomado hierro de forma intermitente. De pequeña tuve bronquitis varias veces, pero nunca me diagnosticaron asma. Me operaron de apendicitis sobre los once o doce años, no recuerdo exacto. No he tenido convulsiones, traumatismos craneales ni enfermedades neurológicas.
PSIQUIATRA: ¿Alergias o reacciones a medicamentos?
PACIENTE: Al polen en primavera. Con amoxicilina tuve urticaria por todo el cuerpo cuando tenía unos seis años. Con aripiprazol tuve mucha inquietud, no podía parar quieta.
PSIQUIATRA: ¿Antecedentes en salud mental?
PACIENTE: Fui a psicología sobre los trece años por bullying y problemas con el instituto. Desde 2024 me ve Salud Mental Infanto-Juvenil por ansiedad, ataques de pánico y rechazo escolar. Nunca he ingresado en psiquiatría. En enero fui a Urgencias por autolesiones. Me pautaron sertralina en enero de 2026 y sigo con psicoterapia.
PSIQUIATRA: ¿Antecedentes psiquiátricos en tu familia?
PACIENTE: Mi abuela materna tuvo depresión y un tío paterno tiene trastorno bipolar.
MADRE: También conozco a una vecina cuya hija tiene anorexia.
PSIQUIATRA: ¿Con quién vives y cómo es la situación en casa?
PACIENTE: Vivo con mi madre y mi hermano Diego. Con mi hermano me llevo muy bien y es una persona de apoyo. Con mi madre tenemos discusiones, pero también puedo acudir a ella cuando estoy mal. Mi amiga Irene también me ayuda. Estoy escolarizada, aunque últimamente he faltado bastante.
PSIQUIATRA: ¿Consumo de sustancias?
PACIENTE: Vapeo nicotina todos los días. Alcohol una o dos veces al mes. Cannabis últimamente cuatro o cinco días por semana, a veces todos los días, uno o dos porros. No consumo cocaína, anfetaminas, MDMA, ketamina ni benzodiacepinas sin receta. Algunos días tomo hasta dos bebidas energéticas.
MADRE: Yo creo que bebe algo más de lo que dice.
PSIQUIATRA: ¿Qué tratamiento tomas y cómo lo tomas?
PACIENTE: Sertralina 50 mg por la mañana, pero últimamente la tomo unos cuatro días de siete. Melatonina, dos comprimidos de 1,9 mg por la noche, aunque también de forma irregular.
PSIQUIATRA: Ahora mismo estás consciente, sabes que estás en Urgencias y qué día aproximado es. Sigues la entrevista y entiendes el motivo de consulta. El discurso es coherente. Refieres cansancio y has dormido unas tres horas. Niega ideación autolítica actual, intención y plan. Niega alucinaciones. No se objetivan datos de síndrome maniforme en la entrevista.
PSIQUIATRA: Mi juicio clínico de trabajo es un episodio depresivo moderado, que deberá revisarse en seguimiento. No voy a subir ahora la sertralina. Mantendremos sertralina 50 mg por la mañana y melatonina por la noche. Es importante mejorar la adherencia, restringir acceso a medicación y objetos cortantes, evitar aislamiento prolongado, mantener supervisión familiar, reducir y suspender cannabis, continuar psicoterapia, coordinar con el centro escolar y revisar por Psiquiatría en una semana. Si reaparece intención suicida, plan, imposibilidad de supervisión o empeoramiento importante, volver a Urgencias.`;

  const CASE2_FULL = `PSIQUIATRA: Varón adulto traído a Urgencias bajo custodia de dos agentes por alteración conductual grave en vía pública. Según la información disponible, entraba en la calzada, gritaba, dañó una papelera porque creía que había un dispositivo dentro e intentó entrar en un comercio cerrado. También se informa de que empujó o retiró el teléfono a una persona que le grababa. No constan lesiones a terceros. La policía permanece en función de custodia, sin intervención clínica.
PSIQUIATRA: ¿Qué está pasando?
PACIENTE: Desde hace tres o cuatro días un coche negro me sigue. La compañía de teléfonos y el ayuntamiento están metidos. Hay cámaras conectadas y la gente de arriba me vigila. Los vídeos de internet cambian para mandarme mensajes. Hasta la radio de la policía confirma cosas.
PSIQUIATRA: ¿Oyes voces?
PACIENTE: Sí. Me dicen “no confíes en nadie” y “no dejes que te cojan”. No me dicen que mate a nadie.
PSIQUIATRA: ¿Cuánto has dormido?
PACIENTE: Dos o tres horas por noche. Una noche no dormí nada.
PSIQUIATRA: ¿Te sentías eufórico, con energía extraordinaria, sin necesidad de dormir, con grandiosidad o muchos proyectos?
PACIENTE: No. Estoy cansado, no es que no necesite dormir.
PSIQUIATRA: ¿Apetito?
PACIENTE: Menos desde hace unos tres días.
PSIQUIATRA: ¿Ha pasado algo recientemente?
PACIENTE: Perdí el trabajo hace una semana. Mi supervisor también está metido en esto.
PSIQUIATRA: ¿Ideas de hacerte daño o morir?
PACIENTE: No. Nunca he intentado suicidarme ni me he hecho daño a propósito.
PSIQUIATRA: ¿Consumo de sustancias?
PACIENTE: No consumo drogas.
ENFERMERA: Cribado de orina positivo para cannabis y anfetaminas. Alcoholemia negativa.
PACIENTE: Vale. Tomé speed ayer y el día anterior. Fumo cannabis, uno o dos porros por la noche, casi todos los días. Fumo unos diez cigarrillos al día y bebo alcohol los fines de semana. No consumo cocaína, MDMA, ketamina ni otras drogas ni medicación sin receta. Sé que el speed puede ponerme más paranoico.
PSIQUIATRA: ¿Antecedentes médicos?
PACIENTE: Asma leve intermitente desde pequeño y apendicectomía a los catorce años. Uso salbutamol 100 microgramos por inhalación, dos inhalaciones si lo necesito. No tengo otras enfermedades importantes conocidas.
PSIQUIATRA: ¿Alergias o reacciones a medicamentos?
PACIENTE: No tengo alergias medicamentosas conocidas. Una vez con haloperidol se me torció el cuello y me dijeron que era una distonía.
PSIQUIATRA: ¿Antecedentes psiquiátricos?
PACIENTE: Un ingreso hace tiempo por algo parecido. Después tuve seguimiento, pero lo dejé. No he ido a psicólogos.
ENFERMERA: En la historia clínica pública consta ingreso en Unidad de Agudos en noviembre de 2024 por episodio psicótico en contexto de cannabis y privación de sueño, con seguimiento posterior durante aproximadamente seis meses. Consta tratamiento previo con risperidona 2 mg por la noche, que abandonó después de unos dos o tres meses; previamente la adherencia se había hecho irregular.
PSIQUIATRA: ¿Tomas ahora algún psicofármaco habitual?
PACIENTE: No. Solo el salbutamol cuando lo necesito.
PSIQUIATRA: ¿Antecedentes psiquiátricos en tu familia biológica?
PACIENTE: Mi madre tuvo depresión. Un hermano de mi padre tiene esquizofrenia. Mi padre bebía muchísimo; no sé si tenía un diagnóstico. No conozco suicidios en la familia.
PSIQUIATRA: ¿Con quién vives y qué apoyos tienes?
PACIENTE: Estoy soltero, nunca me he casado y no tengo pareja ahora. He tenido dos relaciones estables; la última duró unos ocho meses. No tengo hijos. Vivo solo con mi compañero Marcos desde hace más de un año. Mi madre vive a unos veinte minutos, la veo casi a diario y es mi principal apoyo. Tengo una hermana en Valencia y me llevo bien con ella; podría ayudar. Marcos es más compañero de piso que apoyo cercano.
PSIQUIATRA: ¿Trabajo?
PACIENTE: Me quedé sin trabajo hace una semana. Repartía desde hacía unos ocho meses. Antes estuve unos dos años en un almacén y antes hice hostelería de forma ocasional.
PSIQUIATRA: Durante la valoración estás consciente, identificas que estás en un hospital y la ciudad, aunque al principio dudas parcialmente de la fecha. Estás hipervigilante, suspicaz y defensivo, con ideación delirante persecutoria y referencial y fenómenos auditivos. El insight es inicialmente muy escaso. No se objetiva un síndrome maniforme claro.
PSIQUIATRA: Vamos a bajar estímulos, hablar más despacio y pedir a los agentes que se mantengan a distancia. Te propongo medicación oral para disminuir la agitación.
PACIENTE: No voy a tomar nada.
PSIQUIATRA: Te propongo ingreso en Unidad de Agudos.
PACIENTE: No quiero ingresar.
PSIQUIATRA: Aumenta progresivamente el volumen de voz y la hipervigilancia, especialmente al oír la radio policial. Pese a desescalada verbal, reducción de estímulos y oferta de medicación oral, se levanta e intenta salir, empuja una silla, golpea la pared con la mano abierta, intenta abrir la puerta y posteriormente lanza una silla lateralmente sin alcanzar a nadie. Ante riesgo inmediato de agresión y fuga se activa protocolo de contención mecánica. Participan dos auxiliares y dos miembros de seguridad; la policía continúa únicamente en custodia. Enfermería monitoriza estado general y perfusión, sin complicaciones. Se administra olanzapina 10 mg intramuscular. Constantes iniciales: frecuencia cardiaca 118 lpm, presión arterial 151/92 mmHg y saturación de oxígeno 98%.
PSIQUIATRA: Evoluciona con mejoría gradual, solicita agua y posteriormente acepta permanecer en la unidad. Refiere que no quería golpear a nadie. Tras reevaluación médica se retira progresivamente la contención. La policía mantiene la custodia.
PACIENTE: Ahora sigo algo desconfiado, pero las voces son como un murmullo y estoy menos convencido de que todo sea verdad. No quiero morir ni hacer daño a nadie.
PSIQUIATRA: Tras estabilización persiste cierta hipervigilancia, pero niega ideación autolítica y heteroagresiva activa y muestra insight parcial.
PSIQUIATRA: Juicio clínico de trabajo: psicosis no especificada. Debe considerarse en el diferencial una psicosis inducida o agravada por anfetaminas y cannabis frente a recaída de un trastorno psicótico primario. Plan: ingreso en Unidad de Agudos, abstinencia de sustancias y restauración del sueño; hemograma, electrolitos, función renal y hepática, CK, confirmación toxicológica y ECG; olanzapina 10 mg por la noche y mantenimiento de salbutamol a demanda. Reevaluación psiquiátrica en la Unidad de Agudos. Con autorización del paciente se informa a la madre. La situación de custodia/legal se mantiene separada de la asistencia sanitaria.`;

  function load(id, text, label) {
    const button = document.getElementById(id);
    if (!button) return;
    button.addEventListener('click', () => {
      const area = document.getElementById('caseText');
      if (area) area.value = text;
      const message = document.getElementById('sessionMessage');
      if (message) message.textContent = `${label} cargado. Caso ficticio de regresión.`;
    });
  }

  load('loadCase1', CASE1_FULL, 'Caso 1 completo');
  load('loadCase2', CASE2_FULL, 'Caso 2 completo');
})();
