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

function activeIngredientFetch({ query, nregistro, officialName, ingredient }) {
  return async (url) => {
    if (url.includes(`/medicamento?nregistro=${nregistro}`)) {
      return response({
        nregistro,
        nombre: officialName,
        principiosActivos: [{ nombre: ingredient }],
      });
    }
    if (url.includes(`practiv1=${encodeURIComponent(query)}`)) {
      return response({ resultados: [{ nregistro, nombre: officialName }] });
    }
    if (url.includes(`nombre=${encodeURIComponent(query)}`)) {
      return response({ resultados: [{ nregistro, nombre: officialName }] });
    }
    return response({ resultados: [] });
  };
}

test("V0.6 medicamentos: sertralina se verifica primero como principio activo aunque el listado CIMA no incluya pactivos", async () => {
  const fetchFn = activeIngredientFetch({
    query: "Sertralina",
    nregistro: "65997",
    officialName: "SERTRALINA CUVE 50 MG COMPRIMIDOS RECUBIERTOS CON PELICULA EFG",
    ingredient: "SERTRALINA HIDROCLORURO",
  });

  const result = await verifyAssessmentMedications(baseAssessment("Sertralina"), { fetchFn });
  const med = result.assessment.medications.habitual[0];
  assert.equal(med.display_name, "Sertralina");
  assert.equal(med.active_ingredient_known, true);
  assert.equal(med.dose, "50 mg");
  assert.equal(med.schedule, "1-0-0");
  assert.equal(med.medication_verification.status, "confirmed");
  assert.equal(med.medication_verification.matchType, "active_ingredient_exact_token");
  assert.equal(med.medication_verification.formulation_inferred, false);
  assert.equal(result.assessment.safety_review.length, 0);
  assert.equal(result.meta.medication_active_ingredient_lookup_precedes_product_lookup, true);
});

test("V0.6 medicamentos: mirtazapina bien transcrita sigue verificándose literalmente", async () => {
  const fetchFn = activeIngredientFetch({
    query: "Mirtazapina",
    nregistro: "77777",
    officialName: "MIRTAZAPINA 15 MG COMPRIMIDOS EFG",
    ingredient: "MIRTAZAPINA",
  });
  const result = await verifyAssessmentMedications(baseAssessment("Mirtazapina"), { fetchFn });
  const med = result.assessment.medications.habitual[0];
  assert.equal(med.display_name, "Mirtazapina");
  assert.equal(med.medication_verification.status, "confirmed");
  assert.equal(med.medication_verification.medicationAliasApplied, false);
  assert.equal(result.assessment.safety_review.length, 0);
});

test("V0.6 medicamentos: nombre comercial real se asocia al principio activo sin ocultar la marca", async () => {
  const fetchFn = async (url) => {
    if (url.includes("/medicamento?nregistro=60000")) {
      return response({
        nregistro: "60000",
        nombre: "RISPERDAL 1 MG COMPRIMIDOS",
        principiosActivos: [{ nombre: "RISPERIDONA" }],
      });
    }
    if (url.includes("practiv1=Risperdal")) return response({ resultados: [] });
    if (url.includes("nombre=Risperdal")) return response({ resultados: [{ nregistro: "60000", nombre: "RISPERDAL 1 MG COMPRIMIDOS" }] });
    return response({ resultados: [] });
  };

  const result = await verifyAssessmentMedications(baseAssessment("Risperdal"), { fetchFn });
  const med = result.assessment.medications.habitual[0];
  assert.equal(med.display_name, "Risperidona (Risperdal)");
  assert.equal(med.medication_verification.status, "confirmed");
  assert.equal(med.medication_verification.matchType, "product_name_exact_or_prefix");
  assert.equal(med.medication_verification.formulation_inferred, false);
  assert.equal(med.dose, "50 mg");
  assert.equal(med.route, "oral");
});

test("V0.6 medicamentos: Cetralina usa alias validado Sertralina antes de CIMA", async () => {
  const seen = [];
  const baseFetch = activeIngredientFetch({
    query: "Sertralina",
    nregistro: "65997",
    officialName: "SERTRALINA CUVE 50 MG COMPRIMIDOS RECUBIERTOS CON PELICULA EFG",
    ingredient: "SERTRALINA HIDROCLORURO",
  });
  const fetchFn = async (url) => { seen.push(url); return baseFetch(url); };

  const result = await verifyAssessmentMedications(baseAssessment("Cetralina"), { fetchFn });
  const med = result.assessment.medications.habitual[0];
  assert.equal(med.display_name, "Sertralina");
  assert.equal(med.active_ingredient_known, true);
  assert.equal(med.medication_verification.status, "confirmed");
  assert.equal(med.medication_verification.medicationAliasApplied, true);
  assert.equal(med.medication_verification.medicationAliasId, "cetralina_to_sertralina");
  assert.equal(med.medication_verification.medicationCorrectionType, "validated_alias");
  assert.equal(med.medication_verification.queriedName, "Sertralina");
  assert.ok(seen.some((url) => url.includes("practiv1=Sertralina")));
  assert.ok(seen.every((url) => !url.includes("practiv1=Cetralina")));
  assert.equal(result.assessment.safety_review.length, 0);
  assert.equal(result.meta.medication_validated_alias_correction, true);
  assert.equal(result.meta.medication_free_fuzzy_autocorrection, false);
});

test("V0.6 medicamentos: variante conocida de mirtazapina se normaliza antes de CIMA", async () => {
  const seen = [];
  const baseFetch = activeIngredientFetch({
    query: "Mirtazapina",
    nregistro: "77777",
    officialName: "MIRTAZAPINA 15 MG COMPRIMIDOS EFG",
    ingredient: "MIRTAZAPINA",
  });
  const fetchFn = async (url) => { seen.push(url); return baseFetch(url); };

  const result = await verifyAssessmentMedications(baseAssessment("Mirtacepina"), { fetchFn });
  const med = result.assessment.medications.habitual[0];
  assert.equal(med.display_name, "Mirtazapina");
  assert.equal(med.medication_verification.status, "confirmed");
  assert.equal(med.medication_verification.medicationCorrectionType, "validated_alias");
  assert.equal(med.medication_verification.queriedName, "Mirtazapina");
  assert.ok(seen.some((url) => url.includes("practiv1=Mirtazapina")));
  assert.equal(result.assessment.safety_review.length, 0);
});

test("V0.6 medicamentos: aproximación única de alta confianza se confirma en CIMA pero exige revisión", async () => {
  const seen = [];
  const baseFetch = activeIngredientFetch({
    query: "Mirtazapina",
    nregistro: "77777",
    officialName: "MIRTAZAPINA 15 MG COMPRIMIDOS EFG",
    ingredient: "MIRTAZAPINA",
  });
  const fetchFn = async (url) => { seen.push(url); return baseFetch(url); };

  const result = await verifyAssessmentMedications(baseAssessment("Mirtazipina"), { fetchFn });
  const med = result.assessment.medications.habitual[0];
  assert.equal(med.display_name, "Mirtazapina");
  assert.equal(med.medication_verification.status, "confirmed");
  assert.equal(med.medication_verification.medicationHighConfidenceCandidate, true);
  assert.equal(med.medication_verification.medicationCorrectionType, "high_confidence_fuzzy");
  assert.equal(med.medication_verification.queriedName, "Mirtazapina");
  assert.ok(seen.some((url) => url.includes("practiv1=Mirtazapina")));
  assert.equal(result.assessment.safety_review.length, 1);
  assert.equal(result.assessment.safety_review[0].topic, "medicacion_recuperada_por_similitud");
  assert.match(result.assessment.safety_review[0].evidence, /confirmar visualmente/i);
  assert.equal(result.meta.medication_high_confidence_candidate_recovery, true);
  assert.equal(result.meta.medication_free_fuzzy_autocorrection, false);
});

test("V0.6 medicamentos: Ribotril usa alias validado Rivotril y CIMA confirma clonazepam", async () => {
  const seen = [];
  const fetchFn = async (url) => {
    seen.push(url);
    if (url.includes("/medicamento?nregistro=55555")) {
      return response({
        nregistro: "55555",
        nombre: "RIVOTRIL 0,5 MG COMPRIMIDOS",
        principiosActivos: [{ nombre: "CLONAZEPAM" }],
      });
    }
    if (url.includes("practiv1=Rivotril")) return response({ resultados: [] });
    if (url.includes("nombre=Rivotril")) {
      return response({ resultados: [{ nregistro: "55555", nombre: "RIVOTRIL 0,5 MG COMPRIMIDOS" }] });
    }
    return response({ resultados: [] });
  };

  const result = await verifyAssessmentMedications(baseAssessment("Ribotril"), { fetchFn });
  const med = result.assessment.medications.habitual[0];
  assert.equal(med.display_name, "Clonazepam (Rivotril)");
  assert.equal(med.active_ingredient_known, true);
  assert.equal(med.medication_verification.status, "confirmed");
  assert.equal(med.medication_verification.medicationAliasApplied, true);
  assert.equal(med.medication_verification.medicationAliasId, "ribotril_to_rivotril");
  assert.equal(med.medication_verification.queriedName, "Rivotril");
  assert.ok(seen.some((url) => url.includes("nombre=Rivotril")));
  assert.ok(seen.every((url) => !url.includes("nombre=Ribotril")));
  assert.equal(result.assessment.safety_review.length, 0);
});

test("V0.6 medicamentos: caída de CIMA no se presenta como medicamento inexistente", async () => {
  const fetchFn = async () => { throw new Error("network down"); };
  const verification = await verifyMedicationName("Cetralina", { fetchFn, timeoutMs: 50 });
  assert.equal(verification.status, "unavailable");
  assert.equal(verification.queriedName, "Sertralina");
  assert.equal(verification.medicationAliasApplied, true);

  const result = await verifyAssessmentMedications(baseAssessment("Cetralina"), { fetchFn, timeoutMs: 50 });
  const med = result.assessment.medications.habitual[0];
  assert.equal(med.display_name, "Cetralina (verificación CIMA no disponible)");
  assert.equal(result.assessment.safety_review.length, 1);
});
