# PSQ Interview

Aplicación web móvil para capturar una entrevista psiquiátrica, desidentificarla, separar las fuentes de información y preparar un borrador clínico sujeto a revisión profesional.

Este repositorio es independiente del proyecto cerrado **Salud Mental**.

## Flujo clínico

1. **Entrevista:** grabación de hasta 30 minutos o pegado manual de texto.
2. **Revisión:** categorización, fuentes, datos no explorados, discrepancias y alertas.
3. **Informe:** edición por apartados, validación profesional, copia y borrado local confirmado.

La aplicación nunca debe convertir una ausencia de información en un hallazgo negativo ni atribuir a la paciente información aportada por un familiar.

## Privacidad y seguridad

- El audio se procesa por bloques y no se persiste como grabación en el navegador.
- El texto se desidentifica antes del análisis clínico y conserva pruebas firmadas de privacidad.
- Las rutas de privacidad fallan de forma cerrada si no pueden verificar la desidentificación.
- No se usa `localStorage`, `sessionStorage` ni IndexedDB para contenido clínico.
- El informe no se envía desde la aplicación ni contiene un destinatario incrustado.
- Para finalizar, el profesional debe validar, copiar el informe y confirmar dos veces el borrado local.
- Durante el piloto solo deben utilizarse casos ficticios o expresamente autorizados.

El despliegue institucional debe añadir control de acceso, política de retención, evaluación de impacto y acuerdos de tratamiento aplicables antes de usar datos identificables reales.

## Uso móvil

PSQ Interview es instalable como PWA en Android y iPhone. La grabación:

- empieza al pulsar el botón una vez concedido el permiso del navegador;
- mantiene la pantalla activa cuando el dispositivo lo permite;
- procesa bloques de 45 segundos con reintentos y tiempo máximo por petición;
- avisa si se pierde la conexión y evita iniciar una entrevista sin red;
- descarta el audio al finalizar.

El permiso del micrófono lo controla el sistema operativo y no puede omitirse la primera vez. Después de elegir **Permitir**, el navegador normalmente recuerda la decisión para ese sitio.

## Desarrollo

Requisitos: Node.js 22 o posterior y Python 3.

```bash
cp .env.example .env
npm install
npm test
npm run check
npm run start:api
```

La clave de OpenAI, el secreto de las pruebas de privacidad y cualquier credencial permanecen siempre en variables de entorno del servidor.

## Publicación

PSQ Interview debe publicarse como un proyecto y dominio independientes. Antes de promoverlo a producción:

1. ejecutar `npm test` y `npm run check`;
2. verificar el flujo completo en Preview desde Android e iPhone;
3. revisar permisos, variables y protección de acceso;
4. realizar la promoción explícita del despliegue verificado.

No es un producto sanitario autónomo: el resultado es siempre un borrador y requiere revisión clínica profesional.
