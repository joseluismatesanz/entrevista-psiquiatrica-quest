# Criterios de discernimiento clínico V0.4

## Principio central

La transcripción **no es el informe**. La aplicación extrae hechos, conserva fuentes y discrepancias, aplica reglas clínicas deterministas y genera un **borrador** que requiere validación del psiquiatra.

## Estilo vinculante

Todos los apartados salvo **ENFERMEDAD ACTUAL** se redactan de forma breve, factual y clínica. No se reconstruye el diálogo ni se atribuye rutinariamente cada frase a su informante.

**ENFERMEDAD ACTUAL** es la excepción narrativa: integra qué está pasando ahora, la evolución reciente, los síntomas, el contexto/precipitantes, las versiones actuales de paciente/familia y los acontecimientos clínicamente centrales producidos durante la valoración.

**MOTIVO DE LA CONSULTA** es una formulación directa, por ejemplo: `Autolesiones mediante cortes en miembro superior e ideación autolítica.`

## Reglas cerradas

- `PSQ GUARDIA` contiene exclusivamente `MIR MAtesanz`.
- Somáticos: se recogen todos los antecedentes médicos realmente obtenidos y se revisa su implicación sobre medicación orgánica.
- Salud Mental: se prioriza la información obtenida directamente del paciente y, cuando existe, se diferencia la verificación en historia clínica pública.
- Familiares psiquiátricos: **solo** información aportada por el paciente sobre familiares. Se excluyen vecinos, amigos, conocidos y datos aportados únicamente por terceros.
- Situación sociofamiliar: convivencia exacta, hogar, relaciones, red de apoyo, estado civil/parejas/hijos cuando proceda y trayectoria laboral/escolar relevante.
- Tratamiento habitual: psicofármacos + medicación orgánica + adherencia; un fármaco por línea/entidad.
- INTERVENCIÓN: solo propuesta explícita del psiquiatra + aceptación/rechazo del paciente. La contención mecánica no se usa como registro genérico en esta sección.
- Exploración psicopatológica: solo estado actual observado o explorado. **Ausencia de dato ≠ normalidad**.
- Orientación diagnóstica: juicio clínico principal con CIE-10 y DSM-5 cuando la evidencia lo permite, con carácter provisional/diferencial si procede.
- Plan: ingreso/no ingreso, unidad, cambios terapéuticos, pruebas, seguimiento exacto y medidas de seguridad/no farmacológicas.
- Tratamiento actual: régimen final tras la valoración; si no cambia, conserva el habitual.
- Autolesión no suicida no se transforma automáticamente en intento de suicidio.
- Contradicciones de riesgo, cronología, consumo o adherencia se conservan.

## Contención mecánica

Cuando forma parte del episodio agudo, se narra en ENFERMEDAD ACTUAL: indicación clínica, fracaso de medidas menos restrictivas, roles profesionales, monitorización/revaloración, medicación y retirada/resultado. No se describen maniobras tácticas.

## Fuentes

La capa estructurada distingue paciente, psiquiatra, familiares, observación clínica, enfermería, EHR/historia clínica, policía/custodia, seguridad y otras fuentes. La procedencia se muestra en la capa de revisión, no ensucia la prosa factual del informe final.

## Medicación

Cada entidad estructurada conserva: nombre bruto, nombre a mostrar, si el principio activo es conocido, rol psiquiátrico/orgánico, dosis, pauta, vía, PRN, adherencia, estado (activo/histórico/dosis única) y fuentes. Nunca se inventa un principio activo a partir de una marca dudosa.

## Human in the loop

El resultado permanece `is_draft=true` y `clinician_validation_required=true`. No existe exportación automática a historia clínica en esta fase.
