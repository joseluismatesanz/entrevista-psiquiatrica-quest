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

## Próximo paso

Conectar la interfaz móvil al endpoint mediante un modo `backend` explícito, conservando un modo local/ficticio para regresión. No activar grabación todavía.
