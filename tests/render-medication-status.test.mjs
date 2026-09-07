import test from "node:test";
import assert from "node:assert/strict";
import { renderClinicalReport } from "../server/render-report.mjs";

function section(text = "", evidence_status = "not_provided") {
  return { text, evidence_status, source_ids: [] };
}

function medication(name, status, overrides = {}) {
  return {
    raw_name: name,
    display_name: name,
    active_ingredient_known: true,
    role: "psychiatric",
    dose: "",
    schedule: "",
    route: "oral",
    prn: false,
    adherence_status: "not_applicable",
    adherence_text: "",
    status,
    source_ids: [],
    ...overrides,
  };
}

function assessment() {
  return {
    sections: {
      motivo_consulta: section("Prueba de regresión.", "supported"),
      psq_guardia: section("MIR MAtesanz", "supported"),
      alergias_ram: section(),
      antecedentes_somaticos: section(),
      antecedentes_salud_mental: section(),
      antecedentes_familiares_psiquiatricos: section(),
      situacion_sociofamiliar: section(),
      habitos_toxicos: section(),
      tratamiento_habitual: section("texto fallback que no debe imponerse", "supported"),
      enfermedad_actual: section(),
      intervencion: section(),
      exploracion_psicopatologica: section(),
      orientacion_diagnostica: section(),
      plan_terapeutico: section(),
      tratamiento_actual: section("texto fallback que no debe imponerse", "supported"),
    },
    medications: {
      habitual: [
        medication("Sertralina", "active", { dose: "50 mg", schedule: "1 - 0 - 0" }),
        medication("Hierro", "historical", { dose: "80 mg", schedule: "1 - 0 - 0" }),
      ],
      current: [
        medication("Olanzapina", "active", { dose: "10 mg", schedule: "0 - 0 - 1" }),
        medication("Olanzapina", "administered_once", { dose: "10 mg", route: "intramuscular", adherence_status: "not_applicable" }),
        medication("Risperidona", "historical", { dose: "2 mg", schedule: "0 - 0 - 1" }),
      ],
    },
  };
}

test("renderer: habitual solo activo; actual activo + dosis puntual; históricos excluidos", () => {
  const report = renderClinicalReport(assessment());

  const habitual = report.split("TRATAMIENTO HABITUAL\n")[1].split("\n\nENFERMEDAD ACTUAL")[0];
  assert.match(habitual, /Sertralina 50 mg: 1 - 0 - 0/);
  assert.doesNotMatch(habitual, /Hierro/);

  const current = report.split("TRATAMIENTO ACTUAL\n")[1];
  assert.match(current, /Olanzapina 10 mg: 0 - 0 - 1/);
  assert.match(current, /Olanzapina 10 mg \(intramuscular\)/);
  assert.doesNotMatch(current, /Risperidona/);
});
