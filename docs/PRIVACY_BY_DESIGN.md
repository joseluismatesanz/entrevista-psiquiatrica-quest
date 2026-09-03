# Privacy by Design — Entrevista Psiquiátrica Quest

## Principio rector

La aplicación se diseña para uso prioritario desde móvil y para minimizar al máximo la persistencia de información clínica. El teléfono actúa como terminal de captura efímera, no como grabadora ni repositorio.

## Flujo de captura móvil

1. La pantalla principal ofrece un botón rojo de grabación de gran tamaño.
2. Al pulsarlo comienza la captura continua de la entrevista.
3. El audio se procesa en memoria y por fragmentos. No se crea deliberadamente un archivo permanente de audio en el dispositivo.
4. La aplicación no debe guardar audio en carrete, descargas, caché persistente, almacenamiento local, copias de seguridad ni bases de datos.
5. Si la app pasa a segundo plano, se bloquea o falla la sesión, cualquier buffer temporal debe descartarse.
6. Al finalizar, se destruyen los buffers de audio y cualquier mapa temporal de identificadores.

## Anonimización previa

Siempre que sea técnicamente posible, la anonimización debe realizarse antes de que el contenido clínico salga del entorno controlado del dispositivo o del hospital.

La capa de anonimización debe detectar y sustituir, como mínimo:
- nombre y apellidos;
- DNI/NIE/pasaporte;
- número de historia clínica;
- teléfono y correo electrónico;
- dirección postal;
- centros educativos, lugares de trabajo u otros lugares altamente identificativos;
- nombres de familiares y terceros;
- fechas exactas cuando no sean clínicamente necesarias;
- otros identificadores directos o combinaciones que puedan reidentificar al paciente.

Los reemplazos deben usar etiquetas neutras, por ejemplo: [PACIENTE], [MADRE], [PADRE], [HERMANO], [CENTRO_EDUCATIVO], [FECHA].

El mapa entre el dato original y la etiqueta nunca debe persistir fuera de memoria volátil de la sesión.

## OpenAI y procesamiento externo

No debe enviarse audio identificable a OpenAI salvo que exista una configuración institucional expresamente aprobada para ello.

Arquitectura preferida:
1. captura efímera;
2. transcripción local o en infraestructura controlada;
3. anonimización local;
4. envío únicamente de texto anonimizado al modelo generador;
5. uso de un proyecto/API con Zero Data Retention cuando sea elegible;
6. `store=false` para Responses API;
7. no usar Conversations, Threads, Assistants, Vector Stores ni otras funciones que impliquen persistencia de estado clínico;
8. no usar modo background para solicitudes clínicas cuando sea incompatible con ZDR.

La aplicación no debe afirmar que "nada pasa por la nube" si se utiliza una API remota. Debe distinguir entre procesamiento remoto transitorio y almacenamiento persistente.

## Resultado clínico

El informe generado se considera un borrador temporal hasta que el profesional lo revise.

La app no debe mantener historial de entrevistas ni informes clínicos. El resultado final solo debe persistir en el sistema clínico autorizado (por ejemplo, la historia clínica electrónica) mediante una acción explícita del profesional.

Tras copiar/exportar el informe o cerrar la sesión:
- destruir transcripción;
- destruir JSON clínico intermedio;
- destruir informe temporal;
- destruir identificadores y mapas de sustitución;
- limpiar buffers y memoria temporal gestionable por la aplicación.

## Telemetría y logs

Nunca registrar en logs:
- audio;
- transcripciones;
- fragmentos del informe;
- prompts con contenido clínico;
- identificadores del paciente;
- respuestas completas del modelo.

La telemetría, si existe, debe limitarse a métricas técnicas agregadas y no clínicas (p. ej. latencia, versión de la app, códigos de error no sensibles).

## Interfaz de usuario

La pantalla de grabación debe mostrar claramente:
- botón rojo grande para iniciar/detener;
- indicador visible de que la sesión está activa;
- aviso breve: "El audio no se guarda como grabación";
- estado de anonimización/procesamiento;
- botón de cancelar que destruya inmediatamente la sesión;
- confirmación final antes de exportar el informe a la historia clínica.

## Restricción de seguridad

Hasta que se valide formalmente la arquitectura de protección de datos, el prototipo solo debe utilizar casos ficticios o completamente anonimizados.
