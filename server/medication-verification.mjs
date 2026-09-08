const CIMA_BASE_URL = "https://cima.aemps.es/cima/rest";
const DEFAULT_TIMEOUT_MS = 4500;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|ml|ui|mg\/ml|mcg\/dosis))\b/gi, " ")
    .replace(/\b(?:comprimidos?|capsulas?|cápsulas?|solucion|solución|gotas?|jarabe|inyectable|inhalador|inhalacion|inhalación|parches?|sobres?|ampollas?|viales?|oral|efg|retard|liberacion|liberación|prolongada)\b/gi, " ")
    .replace(/[^a-z0-9/+ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseMedication(value) {
  const text = clean(value).toLowerCase();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["resultados", "results", "medicamentos", "items", "data"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function ingredientNames(item) {
  const names = [];
  const pactivos = clean(item?.pactivos);
  if (pactivos) names.push(...pactivos.split(/[,;+]/).map((x) => clean(x)).filter(Boolean));
  for (const active of item?.principiosActivos || []) {
    const name = clean(active?.nombre);
    if (name) names.push(name);
  }
  return [...new Set(names)];
}

function ingredientContainsExactToken(ingredient, wanted) {
  if (!wanted || wanted.includes(" ") || wanted.length < 5) return false;
  return normalize(ingredient).split(/\s+/).includes(wanted);
}

function exactCandidate(rawName, items) {
  const wanted = normalize(rawName);
  if (!wanted) return null;

  for (const item of items) {
    const officialName = normalize(item?.nombre);
    const ingredients = ingredientNames(item);
    const normalizedIngredients = ingredients.map(normalize);

    if (normalizedIngredients.includes(wanted)) {
      return { item, matchType: "active_ingredient_exact", ingredients };
    }

    if (ingredients.some((ingredient) => ingredientContainsExactToken(ingredient, wanted))) {
      return { item, matchType: "active_ingredient_exact_token", ingredients };
    }

    if (officialName === wanted || officialName.startsWith(`${wanted} `)) {
      return { item, matchType: "product_name_exact_or_prefix", ingredients };
    }
  }
  return null;
}

async function fetchJson(url, fetchFn, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`CIMA HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchCima(rawName, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("fetch no disponible para CIMA");
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const query = clean(rawName);
  const encoded = encodeURIComponent(query);

  const searches = [
    `${CIMA_BASE_URL}/medicamentos?nombre=${encoded}&autorizados=1`,
    `${CIMA_BASE_URL}/medicamentos?practiv1=${encoded}&autorizados=1`,
  ];

  let lastError = null;
  const merged = [];
  for (const url of searches) {
    try {
      const payload = await fetchJson(url, fetchFn, timeoutMs);
      merged.push(...listFromPayload(payload));
    } catch (error) {
      lastError = error;
    }
  }

  const unique = [...new Map(merged.map((item, index) => [String(item?.nregistro || item?.nombre || `item-${index}`), item])).values()];
  if (!unique.length && lastError) throw lastError;

  const match = exactCandidate(rawName, unique);
  if (!match) return { status: "not_found", rawName, source: "AEMPS CIMA" };

  let detail = match.item;
  const nregistro = clean(match.item?.nregistro);
  if (nregistro && ingredientNames(detail).length === 0) {
    try {
      detail = await fetchJson(`${CIMA_BASE_URL}/medicamento?nregistro=${encodeURIComponent(nregistro)}`, fetchFn, timeoutMs);
    } catch {
      // La coincidencia por nombre sigue siendo válida aunque falle el detalle.
    }
  }

  const ingredients = ingredientNames(detail);
  return {
    status: "confirmed",
    rawName,
    source: "AEMPS CIMA",
    matchType: match.matchType,
    officialName: clean(detail?.nombre || match.item?.nombre),
    activeIngredients: ingredients,
    nregistro: clean(detail?.nregistro || match.item?.nregistro),
  };
}

function appendSafetyReview(assessment, med, note) {
  assessment.safety_review ||= [];
  const evidence = note;
  const exists = assessment.safety_review.some((item) => item.topic === "medicacion_no_verificada" && item.evidence === evidence);
  if (!exists) {
    assessment.safety_review.push({
      topic: "medicacion_no_verificada",
      evidence,
      source_ids: Array.isArray(med.source_ids) ? med.source_ids : [],
      needs_clinician_review: true,
    });
  }
}

function canonicalDisplayName(verification, rawName) {
  if (verification.activeIngredients?.length === 1) {
    return titleCaseMedication(verification.activeIngredients[0]);
  }
  if (verification.activeIngredients?.length > 1) {
    return verification.activeIngredients.map(titleCaseMedication).join(" / ");
  }
  return clean(verification.officialName) || clean(rawName);
}

export async function verifyMedicationName(rawName, options = {}) {
  try {
    return await searchCima(rawName, options);
  } catch (error) {
    return {
      status: "unavailable",
      rawName: clean(rawName),
      source: "AEMPS CIMA",
      error: String(error?.message || "CIMA no disponible"),
    };
  }
}

export async function verifyAssessmentMedications(inputAssessment, options = {}) {
  const assessment = structuredClone(inputAssessment);
  const warnings = [];
  const cache = new Map();

  for (const group of ["habitual", "current"]) {
    for (const med of assessment.medications?.[group] || []) {
      const rawName = clean(med.raw_name) || clean(med.display_name);
      if (!rawName) continue;

      const key = normalize(rawName);
      let verification = cache.get(key);
      if (!verification) {
        verification = await verifyMedicationName(rawName, options);
        cache.set(key, verification);
      }

      med.medication_verification = verification;

      if (verification.status === "confirmed") {
        med.display_name = canonicalDisplayName(verification, rawName);
        med.active_ingredient_known = Boolean(verification.activeIngredients?.length);
      } else if (verification.status === "not_found") {
        med.display_name = `${rawName} (no encontrada correspondencia en CIMA)`;
        med.active_ingredient_known = false;
        warnings.push(`medication_not_found_in_cima:${rawName}`);
        appendSafetyReview(assessment, med, `No se encontró correspondencia en CIMA para «${rawName}». Mantener el nombre transcrito y confirmar manualmente antes de validar el informe.`);
      } else {
        med.display_name = `${rawName} (verificación CIMA no disponible)`;
        med.active_ingredient_known = false;
        warnings.push(`medication_verification_unavailable:${rawName}`);
        appendSafetyReview(assessment, med, `No se pudo verificar «${rawName}» en CIMA por indisponibilidad técnica. Confirmar manualmente antes de validar el informe.`);
      }
    }
  }

  return {
    assessment,
    warnings,
    meta: {
      medication_verification_enabled: true,
      medication_verification_source: "AEMPS CIMA",
      medication_query_data_minimization: "medication_name_only",
    },
  };
}
