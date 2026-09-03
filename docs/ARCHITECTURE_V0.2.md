# Arquitectura V0.2

## Objetivo

Validar la experiencia clínica y la estructura del informe sin utilizar datos reales, audio real ni servicios externos.

## Flujo actual

```text
Caso ficticio
   ↓
Análisis determinista local
   ↓
Fuentes + pendientes + discrepancias + alertas
   ↓
Borrador estructurado
   ↓
Edición médica
   ↓
Validación explícita
   ↓
Copiar informe
   ↓
Destruir sesión
```

Todo el flujo V0.2 ocurre en memoria del navegador. No existe backend.

## Flujo objetivo para producción

```text
Micrófono móvil
   ↓
Captura efímera en memoria
   ↓
Transcripción local / infraestructura sanitaria controlada
   ↓
Anonimización y sustitución de identificadores
   ↓
Texto clínico desidentificado
   ↓
Extracción estructurada conforme a JSON Schema
   ↓
Comprobaciones deterministas
   ├─ datos no explorados
   ├─ atribución de fuentes
   ├─ contradicciones
   └─ seguridad clínica para revisión
   ↓
Generación de borrador
   ↓
Revisión y edición del psiquiatra
   ↓
Validación explícita
   ↓
Exportación al sistema clínico autorizado
   ↓
Destrucción de transcripción, estructuras intermedias y borrador temporal
```

## Separación de responsabilidades

### 1. Captura

Responsable exclusivamente de obtener el audio de forma efímera. No debe conocer la lógica clínica ni guardar archivos permanentes.

### 2. Transcripción

Convierte audio en texto. Debe ejecutarse antes de cualquier persistencia y con el mínimo dato necesario.

### 3. Anonimización

Elimina o sustituye identificadores directos y reduce identificadores indirectos antes de enviar contenido a un modelo externo.

### 4. Extracción clínica

Produce un objeto estructurado conforme a `schemas/clinical-assessment.schema.json`.

Reglas obligatorias:
- no inventar;
- no transformar ausencia de información en negación de síntomas;
- atribuir cada afirmación a su fuente;
- conservar discrepancias;
- distinguir historia previa de estado actual;
- no convertir alertas en decisiones clínicas automáticas.

### 5. Generación del borrador

Redacta la plantilla clínica acordada utilizando exclusivamente información estructurada y trazable.

### 6. Validación humana

Ningún borrador se considera informe final sin una acción explícita del profesional.

## Persistencia

La aplicación no debe ofrecer listado de pacientes, historial de entrevistas ni recuperación de sesiones anteriores.

Persistencia permitida:
- código y configuración no sensible;
- métricas técnicas agregadas que no contengan contenido clínico;
- informe final únicamente dentro del sistema clínico autorizado cuando el profesional lo exporte expresamente.

Persistencia prohibida en la aplicación:
- audio;
- transcripción;
- mapas de identificadores;
- prompts clínicos;
- respuestas del modelo;
- borradores;
- casos reales de pacientes.

## Requisitos antes de habilitar el micrófono

- revisión de protección de datos;
- definición del lugar exacto donde se ejecuta la transcripción;
- prueba de que no se crean archivos persistentes por la aplicación;
- política de errores y cierre inesperado;
- anonimización validada con pruebas específicas;
- configuración de logs sin contenido clínico;
- revisión de retención del proveedor de IA;
- pruebas de seguridad del flujo completo;
- consentimiento/información al paciente según normativa y política institucional aplicable.

## V0.2 no es un producto asistencial

La rama V0.2 es un prototipo de validación y solo debe utilizar casos ficticios. El objetivo es comprobar diseño, flujo, estructura y reglas antes de introducir procesamiento clínico real.
