import test from "node:test";
import assert from "node:assert/strict";
import { verifyAssessmentMedications, verifyMedicationName } from "../server/medication-verification.mjs";

function response(payload, ok = true, status = 200) {
  return { ok, status, async json() { return payload; } };
}

function baseAssessment(rawName) {
  const med = {
    raw_name: rawName,
    display_name: rawName,
    active_ingredient_known: false,
    role: "psychiatric",
    dose: "50 mg",
    schedule: "1-0-0",
    route: "oral",
    prn: false,
    adherence_status: "unknown",
    adherence_text: "",
    status: "active",
    source_ids: ["patient"],
  };
  return {
    medications: { habitual: [med], current: [] },
    safety_review: [],
  };
}

test("V0.5.4 medicamentos: sertralina se confirma contra CIMA y conserva dosis/pauta", async () => {
  const fetchFn = async (url) => {
    if (url.includes("/medicamento?nregistro=65997")) {
      return response({
        nregistro: "65997",
        nombre: "SERTRALINA CUVE 50 MG COMPRIMIDOS RECUBIERTOS CON PELICULA EFG",
        principiosActivos: [{ nombre: "SERTRALINA" }],
      });
    }
    if (url.includes("nombre=Sertralina")) {
      return response({ resultados: [{ nregistro: "65997", nombre: "SERTRALINA CUVE 50 MG COMPRIMIDOS RECUBIERTOS CON PELICULA EFG" }] });
    }
    return response({ resultados: [] });
  };

  const result = await verifyAssessmentMedications(baseAssessment("Sertralina"), { fetchFn });
  const med = result.assessment.medications.habitual[0];
  assert.equal(med.display_name, "Sertralina");
  assert.equal(med.active_ingredient_known, true);
  assert.equal(med.dose, "50 mg");
  assert.equal(med.schedule, "1-0-0");
  assert.equal(med.medication_verification.status, "confirmed");
  assert.equal(result.assessment.safety_review.length, 0);
});

test("V0.5.4 medicamentos: nombre comercial real se normaliza al principio activo confirmado", async () => {
  const fetchFn = async (url) => {
    if (url.includes("/medicamento?nregistro=60000")) {
      return response({
        nregistro: "60000",
        nombre: "RISPERDAL 1 MG COMPRIMIDOS",
        principiosActivos: [{ nombre: "RISPERIDONA" }],
      });
    }
    if (url.includes("nombre=Risperdal")) {
      return response({ resultados: [{ nregistro: "60000", nombre: "RISPERDAL 1 MG COMPRIMIDOS" }] });
    }
    return response({ resultados: [] });
  };

  const result = await verifyAssessmentMedications(baseAssessment("Risperdal"), { fetchFn });
  const med = result.assessment.medications.habitual[0];
  assert.equal(med.display_name, "Risperidona");
  assert.equal(med.medication_verification.status, "confirmed");
});

test("V0.5.4 medicamentos: Cetralina no se autocorrige por similitud", async () => {
  const fetchFn = async () => response({ resultados: [] });
  const result = await verifyAssessmentMedications(baseAssessment("Cetralina"), { fetchFn });
  const med = result.assessment.medications.habitual[0];
  assert.equal(med.display_name, "Cetralina (no encontrada correspondencia en CIMA)");
  assert.equal(med.active_ingredient_known, false);
  assert.equal(med.medication_verification.status, "not_found");
  assert.equal(result.assessment.safety_review.length, 1);
  assert.match(result.assessment.safety_review[0].evidence, /Cetralina/);
});

test("V0.5.4 medicamentos: caída de CIMA no se presenta como medicamento inexistente", async () => {
  const fetchFn = async () => { throw new Error("network down"); };
  const verification = await verifyMedicationName("Cetralina", { fetchFn, timeoutMs: 50 });
  assert.equal(verification.status, "unavailable");

  const result = await verifyAssessmentMedications(baseAssessment("Cetralina"), { fetchFn, timeoutMs: 50 });
  const med = result.assessment.medications.habitual[0];
  assert.equal(med.display_name, "Cetralina (verificación CIMA no disponible)");
  assert.equal(result.assessment.safety_review.length, 1);
});
