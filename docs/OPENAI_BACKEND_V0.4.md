# Backend OpenAI V0.4 — texto primero

## Objetivo

Primera integración real con OpenAI para sustituir progresivamente el extractor local basado en reglas por:

`texto de entrevista -> Structured Outputs -> validadores deterministas -> renderer por secciones -> borrador -> revisión del psiquiatra`

No incluye audio, grabación, EHR ni datos reales.

## API

`POST /api/analyze`

```json
{
  "transcript": "PSIQUIATRA: ...\nPACIENTE: ..."
}
```

La respuesta contiene:
- `assessment`: JSON estructurado;
- `report`: informe renderizado de forma determinista;
- `meta`: modelo, `store:false`, avisos de invariantes y violaciones detectadas.

## OpenAI

- Responses API.
- Structured Outputs con `text.format.type = "json_schema"` y `strict: true`.
- modelo configurable por `OPENAI_MODEL`; por defecto `gpt-5.6` (alias de GPT-5.6 Sol).
- `store:false` explícito.
- sin `background`.
- sin conversaciones persistentes, Threads, Assistants ni vector stores.

## Adaptador de interfaz

La UI V0.4 ya carga, en este orden:

1. `config.js`
2. `app.js`
3. `backend-client.js`

`config.js` contiene:

```js
window.CLINICAL_API_URL = "";
```

- URL vacía: mantiene el motor local de pruebas y no realiza solicitudes clínicas externas.
- URL HTTPS del backend: `backend-client.js` intercepta el análisis, envía exclusivamente la transcripción al `POST /api/analyze` y renderiza `assessment` + `report`.

Este diseño permite probar y desplegar el backend sin volver a reescribir la UI ni romper el modo local. El backend no está publicado todavía y no existe ninguna API key en el navegador o repositorio.

## Privacidad de esta fase

Este repositorio es público: nunca introducir pacientes, credenciales ni API keys.

`store:false` evita que la respuesta se almacene para recuperación posterior mediante API, pero **no debe presentarse como equivalente automático a Zero Data Retention**. El uso con datos identificables requiere arquitectura institucional, revisión de privacidad/seguridad y controles de retención adecuados. Hasta entonces: solo datos ficticios o completamente anonimizados.

## Desarrollo local

```bash
cp .env.example .env
npm install
npm test
npm run start:api
```

La clave se mantiene exclusivamente en el servidor.

Para probar la UI contra el backend local, sirve el frontend desde el origen configurado en `ALLOWED_ORIGIN` y establece temporalmente en `config.js` la URL del servidor. No subir claves al repositorio.

## Próximo paso

1. desplegar el servidor en un entorno HTTPS con secreto `OPENAI_API_KEY` exclusivamente server-side;
2. activar `CLINICAL_API_URL` en un entorno de prueba;
3. ejecutar ambos fixtures ficticios contra la API real;
4. comparar Structured Outputs con las regresiones clínicas antes de cualquier merge.

No activar grabación todavía.
