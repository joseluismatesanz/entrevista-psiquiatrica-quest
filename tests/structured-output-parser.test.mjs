import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTranscript } from "../server/analyze.mjs";

const sec = (text = "", evidence_status = "not_provided", source_ids = []) => ({
  text,
  evidence_status,
  source_ids,
});

function validAssessment() {
  const sections = {
    motivo_consulta: sec("Autolesiones mediante cortes superficiales en miembro superior.", "supported", ["pat"]),
    psq_guardia: sec("MIR MAtesanz", "supported", []),
    alergias_ram: sec(),
    antecedentes_somaticos: sec(),
    antecedentes_salud_mental: sec(),
    antecedentes_familiares_psiquiatricos: sec(),
    situacion_sociofamiliar: sec(),
    habitos_toxicos: sec(),
    tratamiento_habitual: sec(),
    enfermedad_actual: sec("Autolesiones superficiales en contexto de malestar emocional.", "supported", ["pat"]),
    intervencion: sec(),
    exploracion_psicopatologica: sec("Niega intención autolítica actual.", "supported", ["pat"]),
    orientacion_diagnostica: sec(),
    plan_terapeutico: sec(),
    tratamiento_actual: sec(),
  };

  return {
    sources: [
      { id: "pat", label: "Paciente", kind: "patient" },
      { id: "psy", label: "Psiquiatra", kind: "psychiatrist" },
    ],
    sections,
    medications: { habitual: [], current: [] },
    diagnostic_judgment: {
      primary_diagnosis: "Episodio depresivo moderado",
      cie10_code: "F32.1",
      dsm5_code: "296.22",
      provisional: true,
      differential: [],
      basis_summary: "Juicio de trabajo sujeto a validación clínica.",
      requires_clinician_validation: true,
    },
    missing_or_not_explored: [],
    conflicts: [],
    safety_review: [],
    validation: { is_draft: true, clinician_validation_required: true },
  };
}

test("Producción usa responses.parse + Zod en lugar de JSON.parse manual", async () => {
  const assessment = validAssessment();
  let captured;
  const client = {
    responses: {
      async parse(params) {
        captured = params;
        return {
          status: "completed",
          output: [],
          output_parsed: assessment,
          _request_id: "req_test_parse",
        };
      },
    },
  };

  const result = await analyzeTranscript(
    "PSIQUIATRA: ¿Qué ha ocurrido? PACIENTE: Me he hecho cortes superficiales en el antebrazo.",
    { client, model: "gpt-5.6" }
  );

  assert.equal(captured.store, false);
  assert.equal(captured.background, false);
  assert.equal(captured.text.format.type, "json_schema");
  assert.equal(captured.text.format.strict, true);
  assert.equal(result.meta.structured_output_parser, "responses.parse+zod");
  assert.equal(result.meta.structured_output_attempts, 1);
  assert.doesNotMatch(result.report, /MIR MAtesanz/);
  assert.match(result.report, /PSQ GUARDIA\nNo consta\./);
  assert.ok(result.meta.warnings.includes("psq_guardia_unsupported_identity_removed"));
});

test("JSON estructurado malformado provoca un único reintento y no genera informe parcial", async () => {
  const assessment = validAssessment();
  let calls = 0;
  const client = {
    responses: {
      async parse() {
        calls += 1;
        if (calls === 1) {
          throw new SyntaxError("Expected ',' or '}' after property value in JSON");
        }
        return {
          status: "completed",
          output: [],
          output_parsed: assessment,
          _request_id: "req_test_retry",
        };

      },
    },
  };

  const result = await analyzeTranscript(
    "PSIQUIATRA: ¿Qué ha ocurrido? PACIENTE: Me he hecho cortes superficiales en el antebrazo.",
    { client, model: "gpt-5.6" }
  );

  assert.equal(calls, 2);
  assert.equal(result.meta.structured_output_attempts, 2);
  assert.equal(result.meta.structured_output_parser, "responses.parse+zod");
  assert.match(result.report, /CIE-10: F32\.1/);
});
