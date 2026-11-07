# Entrevista Psiquiátrica Quest

Prototipo mobile-first para transformar entrevistas psiquiátricas en un borrador clínico estructurado con revisión profesional obligatoria.

## Estado actual — V0.4

La rama de trabajo incorpora dos capas:

1. **Frontend local determinista**, usado para validar organización, estilo clínico y UX.
2. **Backend V0.4 text-only** con OpenAI Responses API + Structured Outputs, todavía sin despliegue productivo.

No hay grabación real en esta fase.

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

La regla de redacción y routing vinculante está en `docs/CLINICAL_ROUTING_V0.4.md`.

## Backend V0.4

Flujo:

`texto -> Structured Outputs -> invariantes deterministas -> renderer por secciones -> borrador -> validación médica`

Desarrollo local:

```bash
cp .env.example .env
npm install
npm test
npm run start:api
```

Endpoint: `POST /api/analyze`.

La API key nunca debe ir al navegador ni al repositorio. Ver `docs/OPENAI_BACKEND_V0.4.md`.

## Privacidad

- repositorio público: solo fixtures ficticios;
- sin API keys;
- sin persistencia deliberada de entrevistas;
- `store:false` en Responses API;
- sin audio real;
- sin localStorage/IndexedDB para contenido clínico;
- borrador siempre sujeto a validación médica.

`store:false` no equivale por sí solo a Zero Data Retention. El uso con información identificable requiere controles institucionales de privacidad, seguridad y retención.

**No usar con datos identificables de pacientes en esta fase.**
