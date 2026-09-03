# Entrevista Psiquiátrica Quest

Prototipo mobile-first para convertir una entrevista psiquiátrica en un borrador clínico estructurado que siempre requiere revisión y validación médica.

## Estado actual — V0.2

Esta rama contiene un prototipo seguro de interfaz con:

- entrada de caso desde móvil;
- botón de entrevista visible, con micrófono real deliberadamente bloqueado;
- tres casos completamente ficticios;
- identificación de fuentes de información;
- datos no explorados;
- discrepancias entre informantes;
- alertas para revisión clínica;
- borrador estructurado con la plantilla clínica acordada;
- edición manual;
- validación médica obligatoria antes de copiar;
- acción de cancelar y destruir la sesión.

## Privacidad

En V0.2 no existe conexión con OpenAI ni con otros servicios externos. El prototipo no realiza solicitudes de red desde `app.js` y no utiliza `localStorage`, `sessionStorage`, IndexedDB ni cookies para guardar información clínica.

El micrófono real permanece bloqueado hasta validar una arquitectura de captura efímera, transcripción controlada y anonimización previa.

Ver `docs/PRIVACY_BY_DESIGN.md`.

## Plantilla clínica

1. MOTIVO DE LA CONSULTA
2. PSQ GUARDIA
3. ALERGIAS / RAM
4. ANTECEDENTES PERSONALES SOMÁTICOS
5. ANTECEDENTES PERSONALES EN SALUD MENTAL
6. ANTECEDENTES FAMILIARES PSIQUIÁTRICOS
7. SITUACIÓN SOCIOFAMILIAR
8. HÁBITOS TÓXICOS
9. TRATAMIENTO HABITUAL
10. ENFERMEDAD ACTUAL
11. INTERVENCIÓN
12. EXPLORACIÓN PSICOPATOLÓGICA
13. ORIENTACIÓN DIAGNÓSTICA
14. PLAN TERAPÉUTICO
15. TRATAMIENTO ACTUAL

## Regla clínica central

La ausencia de información nunca se convierte en un hallazgo negativo. Si un dominio no fue preguntado, observado o aportado, debe figurar como `No explorado`, `No consta` o permanecer explícitamente pendiente.

Las versiones contradictorias de paciente, familiares y observación clínica deben conservarse por separado; el sistema no debe resolverlas inventando una única versión.

## Ejecutar el prototipo

Es una aplicación web estática. Se puede abrir `index.html` directamente en un navegador o servir la carpeta con cualquier servidor HTTP estático.

## Próxima fase

1. Validar clínicamente V0.2 con los tres casos ficticios.
2. Convertir la extracción clínica a un esquema JSON estricto.
3. Incorporar un backend sin secretos en frontend.
4. Conectar generación estructurada con OpenAI usando únicamente contenido desidentificado y configuración de retención aprobada.
5. Diseñar y validar la capa de transcripción/anonimización antes de habilitar el micrófono real.

Nunca introducir datos reales de pacientes en este repositorio ni en el prototipo mientras no exista una validación formal de seguridad y protección de datos.
