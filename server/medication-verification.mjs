const CIMA_BASE_URL = "https://cima.aemps.es/cima/rest";
const DEFAULT_TIMEOUT_MS = 4500;
const MAX_ACTIVE_CANDIDATE_DETAILS = 6;

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

function activeIngredientMatch(rawName, item) {
  const wanted = normalize(rawName);
  if (!wanted) return null;
  const ingredients = ingredientNames(item);
  const normalizedIngredients = ingredients.map(normalize);

  if (normalizedIngredients.includes(wanted)) {
    return { matchType: "active_ingredient_exact", ingredients };
  }
  if (ingredients.some((ingredient) => ingredientContainsExactToken(ingredient, wanted))) {
    return { matchType: "active_ingredient_exact_token", ingredients };
  }
  return null;
}

function productNameMatches(rawName, item) {
  const wanted = normalize(rawName);
  const officialName = normalize(item?.nombre);
  return Boolean(wanted && (officialName === wanted || officialName.startsWith(`${wanted} `)));
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

async function withMedicationDetail(item, fetchFn, timeoutMs) {
  if (ingredientNames(item).length > 0) return item;
  const nregistro = clean(item?.nregistro);
  if (!nregistro) return item;
  try {
    return await fetchJson(`${CIMA_BASE_URL}/medicamento?nregistro=${encodeURIComponent(nregistro)}`, fetchFn, timeoutMs);
  } catch {
    return item;
  }
}

function confirmedResult(rawName, detail, matchType, fallbackItem = detail) {
  return {
    status: "confirmed",
    rawName,
    source: "AEMPS CIMA",
    matchType,
    officialName: clean(detail?.nombre || fallbackItem?.nombre),
    activeIngredients: ingredientNames(detail),
    nregistro: clean(detail?.nregistro || fallbackItem?.nregistro),
    registryState: detail?.estado ?? fallbackItem?.estado ?? null,
    commercialized: detail?.comerc ?? fallbackItem?.comerc ?? null,
    formulation_inferred: false,
    dose_inferred: false,
    route_inferred: false,
  };
}

async function findExactActiveIngredient(rawName, items, fetchFn, timeoutMs) {
  const limited = items.slice(0, MAX_ACTIVE_CANDIDATE_DETAILS);
  // Los detalles candidatos son independientes. Resolverlos en paralelo evita hasta
  // seis esperas HTTP consecutivas cuando CIMA no incluye principios activos en el listado.
  const details = await Promise.all(limited.map((item) => withMedicationDetail(item, fetchFn, timeoutMs)));
  for (let index = 0; index < details.length; index += 1) {
    const detail = details[index];
    const match = activeIngredientMatch(rawName, detail);
    if (match) return confirmedResult(rawName, detail, match.matchType, limited[index]);
  }
  return null;
}

async function searchCima(rawName, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("fetch no disponible para CIMA");
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const query = clean(rawName);
  const encoded = encodeURIComponent(query);

  // Regla de seguridad: primero se comprueba expresamente como principio activo.
  // Solo si CIMA responde correctamente y no hay coincidencia exacta se permite
  // interpretar el texto como nombre de medicamento/marca.
  // Solo se envía a CIMA el nombre farmacológico, nunca la transcripción ni datos del paciente.
  let activePayload;
  try {
    activePayload = await fetchJson(`${CIMA_BASE_URL}/medicamentos?practiv1=${encoded}`, fetchFn, timeoutMs);
  } catch (error) {
    throw new Error(`No se pudo verificar el principio activo en CIMA: ${error.message}`);
  }

  const activeItems = listFromPayload(activePayload);
  const activeMatch = await findExactActiveIngredient(rawName, activeItems, fetchFn, timeoutMs);
  if (activeMatch) return activeMatch;

  let productPayload;
  try {
    productPayload = await fetchJson(`${CIMA_BASE_URL}/medicamentos?nombre=${encoded}`, fetchFn, timeoutMs);
  } catch (error) {
    throw new Error(`No se pudo verificar el nombre de medicamento en CIMA: ${error.message}`);
  }

  const productItems = listFromPayload(productPayload);
  const product = productItems.find((item) => productNameMatches(rawName, item));
  if (!product) return { status: "not_found", rawName, source: "AEMPS CIMA" };

  const detail = await withMedicationDetail(product, fetchFn, timeoutMs);
  return confirmedResult(rawName, detail, "product_name_exact_or_prefix", product);
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
  const raw = clean(rawName);
  const matchType = verification.matchType || "";

  // Si la palabra transcrita corresponde al principio activo, la conservamos literalmente.
  // No sustituimos "Sertralina" por "Sertralina hidrocloruro" si la sal no fue expresada.
  if (matchType === "active_ingredient_exact" || matchType === "active_ingredient_exact_token") {
    return titleCaseMedication(raw);
  }

  // Si es una marca confirmada, mostramos el principio activo confirmado y conservamos
  // la marca entre paréntesis. Nunca se infieren dosis, formulación ni vía desde CIMA.
  if (verification.activeIngredients?.length === 1) {
    return `${titleCaseMedication(verification.activeIngredients[0])} (${raw})`;
  }
  if (verification.activeIngredients?.length > 1) {
    return `${verification.activeIngredients.map(titleCaseMedication).join(" / ")} (${raw})`;
  }

  return raw || clean(verification.officialName);
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
  const medicationEntries = [];

  for (const group of ["habitual", "current"]) {
    for (const med of assessment.medications?.[group] || []) {
      const rawName = clean(med.raw_name) || clean(med.display_name);
      if (!rawName) continue;
      medicationEntries.push({ med, rawName, key: normalize(rawName) });
    }
  }

  // Los nombres farmacológicos independientes se verifican a la vez. Los duplicados
  // habitual/actual siguen compartiendo un único resultado.
  const uniqueNames = new Map();
  for (const entry of medicationEntries) {
    if (!uniqueNames.has(entry.key)) uniqueNames.set(entry.key, entry.rawName);
  }

  const verificationPairs = await Promise.all(
    [...uniqueNames.entries()].map(async ([key, rawName]) => [
      key,
      await verifyMedicationName(rawName, options),
    ])
  );
  const cache = new Map(verificationPairs);

  for (const { med, rawName, key } of medicationEntries) {
    const verification = cache.get(key);
    med.medication_verification = verification;

    if (verification.status === "confirmed") {
      med.display_name = canonicalDisplayName(verification, rawName);
      med.active_ingredient_known = Boolean(verification.activeIngredients?.length)
        || verification.matchType === "active_ingredient_exact"
        || verification.matchType === "active_ingredient_exact_token";
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

  return {
    assessment,
    warnings,
    meta: {
      medication_verification_enabled: true,
      medication_verification_source: "AEMPS CIMA",
      medication_query_data_minimization: "medication_name_only",
      medication_similarity_autocorrection: false,
      medication_formulation_inference: false,
      medication_active_ingredient_lookup_precedes_product_lookup: true,
      medication_verification_parallelized: true,
    },
  };
}
