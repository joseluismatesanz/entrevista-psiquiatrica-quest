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

test("renderer: no muestra marcadores internos de adherencia desconocida", () => {
  const input = assessment();
  input.medications.current = [
    medication("Sertralina", "active", {
      dose: "50 mg",
      schedule: "por la mañana, con el desayuno",
      adherence_status: "unknown",
      adherence_text: "[unknown]",
    }),
    medication("Clonazepam", "active", {
      dose: "0,5 mg",
      schedule: "de rescate si aparece ansiedad",
      adherence_status: "unknown",
      adherence_text: "not_applicable",
    }),
  ];

  const report = renderClinicalReport(input);
  const current = report.split("TRATAMIENTO ACTUAL\n")[1];

  assert.match(current, /Sertralina 50 mg: por la mañana, con el desayuno/);
  assert.match(current, /Clonazepam 0,5 mg: de rescate si aparece ansiedad/);
  assert.doesNotMatch(current, /unknown|not[_ ]?applicable|Adherencia/i);
});

test("renderer: no muestra mensajes internos de verificación de CIMA", () => {
  const input = assessment();
  input.medications.current = [
    medication("clatipina", "active", {
      display_name: "clatipina (no encontrada correspondencia en CIMA)",
      active_ingredient_known: false,
      dose: "15 mg",
      schedule: "antes de dormir",
    }),
  ];

  const report = renderClinicalReport(input);
  const current = report.split("TRATAMIENTO ACTUAL\n")[1];

  assert.equal(current, "clatipina 15 mg: antes de dormir");
  assert.doesNotMatch(current, /CIMA|correspondencia|no encontrada/i);
});

test("renderer: conserva la negación explícita cuando no hay medicación habitual estructurada", () => {
  const input = assessment();
  input.medications.habitual = [];
  input.sections.tratamiento_habitual = section("No toma medicación habitual.", "supported");

  const report = renderClinicalReport(input);
  const habitual = report.split("TRATAMIENTO HABITUAL\n")[1].split("\n\nENFERMEDAD ACTUAL")[0];

  assert.equal(habitual, "No toma medicación habitual.");
});
