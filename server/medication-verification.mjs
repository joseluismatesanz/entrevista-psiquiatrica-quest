import { MEDICATION_NAME_ALIASES, PSYCHIATRIC_MEDICATION_VOCABULARY, resolveHighConfidenceMedicationCandidate } from "./medication-name-aliases.mjs";

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

function activeIngredientMatch(queryName, item) {
  const wanted = normalize(queryName);
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

function productNameMatches(queryName, item) {
  const wanted = normalize(queryName);
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

function confirmedResult(queryName, detail, matchType, fallbackItem = detail) {
  return {
    status: "confirmed",
    rawName: queryName,
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

async function findExactActiveIngredient(queryName, items, fetchFn, timeoutMs) {
  const limited = items.slice(0, MAX_ACTIVE_CANDIDATE_DETAILS);
  const details = await Promise.all(limited.map((item) => withMedicationDetail(item, fetchFn, timeoutMs)));
  for (let index = 0; index < details.length; index += 1) {
    const detail = details[index];
    const match = activeIngredientMatch(queryName, detail);
    if (match) return confirmedResult(queryName, detail, match.matchType, limited[index]);
  }
  return null;
}

function withCorrectionTrace(result, rawName, resolution) {
  return {
    ...result,
    rawName: clean(rawName),
    queriedName: clean(resolution?.canonical) || clean(rawName),
    medicationAliasApplied: Boolean(resolution?.corrected),
    medicationAliasId: resolution?.aliasId || "",
    medicationCorrectionType: resolution?.correctionType || "none",
    medicationHighConfidenceCandidate: resolution?.correctionType === "high_confidence_fuzzy",
    medicationCandidateDistance: Number.isFinite(resolution?.distance) ? resolution.distance : null,
    medicationCandidateSimilarity: Number.isFinite(resolution?.similarity) ? resolution.similarity : null,
  };
}

async function findExactActiveIngredientInMaster(queryName, fetchFn, timeoutMs) {
  const encoded = encodeURIComponent(queryName);
  let payload;
  try {
    payload = await fetchJson(
      `${CIMA_BASE_URL}/maestras?maestra=1&nombre=${encoded}&enuso=0`,
      fetchFn,
      timeoutMs,
    );
  } catch {
    return null;
  }

  const wanted = normalize(queryName);
  const items = listFromPayload(payload);
  const exact = items.find((item) =>
    !clean(item?.nregistro)
    && normalize(item?.nombre) === wanted
  );
  if (!exact) return null;

  const official = clean(exact?.nombre) || queryName;
  return {
    status: "confirmed",
    rawName: queryName,
    source: "AEMPS CIMA",
    matchType: "active_ingredient_master_exact",
    officialName: official,
    activeIngredients: [official],
    nregistro: "",
    registryState: null,
    commercialized: null,
    formulation_inferred: false,
    dose_inferred: false,
    route_inferred: false,
  };
}

async function searchCima(rawName, options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("fetch no disponible para CIMA");
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const resolution = resolveHighConfidenceMedicationCandidate(rawName);
  const queryName = clean(resolution.canonical) || clean(rawName);
  const encoded = encodeURIComponent(queryName);

  // Corrección conservadora: alias validados o candidato único de alta confianza dentro
  // de un vocabulario farmacológico controlado. Nunca se elige por similitud entre
  // resultados arbitrarios de CIMA. CIMA debe confirmar después el nombre canónico.
  let activePayload;
  try {
    activePayload = await fetchJson(`${CIMA_BASE_URL}/medicamentos?practiv1=${encoded}`, fetchFn, timeoutMs);
  } catch (error) {
    throw new Error(`No se pudo verificar el principio activo en CIMA: ${error.message}`);
  }

  const activeItems = listFromPayload(activePayload);
  const activeMatch = await findExactActiveIngredient(queryName, activeItems, fetchFn, timeoutMs);
  if (activeMatch) return withCorrectionTrace(activeMatch, rawName, resolution);

  const masterMatch = await findExactActiveIngredientInMaster(queryName, fetchFn, timeoutMs);
  if (masterMatch) return withCorrectionTrace(masterMatch, rawName, resolution);

  let productPayload;
  try {
    productPayload = await fetchJson(`${CIMA_BASE_URL}/medicamentos?nombre=${encoded}`, fetchFn, timeoutMs);
  } catch (error) {
    throw new Error(`No se pudo verificar el nombre de medicamento en CIMA: ${error.message}`);
  }

  const productItems = listFromPayload(productPayload);
  const product = productItems.find((item) => productNameMatches(queryName, item));
  if (!product) {
    return withCorrectionTrace({ status: "not_found", rawName: queryName, source: "AEMPS CIMA" }, rawName, resolution);
  }

  const detail = await withMedicationDetail(product, fetchFn, timeoutMs);
  return withCorrectionTrace(confirmedResult(queryName, detail, "product_name_exact_or_prefix", product), rawName, resolution);
}

function appendSafetyReview(assessment, med, note, topic = "medicacion_no_verificada") {
  assessment.safety_review ||= [];
  const evidence = note;
  const exists = assessment.safety_review.some((item) => item.topic === topic && item.evidence === evidence);
  if (!exists) {
    assessment.safety_review.push({
      topic,
      evidence,
      source_ids: Array.isArray(med.source_ids) ? med.source_ids : [],
      needs_clinician_review: true,
    });
  }
}

function canonicalDisplayName(verification, rawName) {
  const raw = clean(rawName);
  const canonicalInput = verification.medicationAliasApplied
    ? clean(verification.queriedName)
    : raw;
  const matchType = verification.matchType || "";

  if (
    matchType === "active_ingredient_exact"
    || matchType === "active_ingredient_exact_token"
    || matchType === "active_ingredient_master_exact"
  ) {
    return titleCaseMedication(canonicalInput);
  }

  if (verification.activeIngredients?.length === 1) {
    return `${titleCaseMedication(verification.activeIngredients[0])} (${titleCaseMedication(canonicalInput)})`;
  }
  if (verification.activeIngredients?.length > 1) {
    return `${verification.activeIngredients.map(titleCaseMedication).join(" / ")} (${titleCaseMedication(canonicalInput)})`;
  }

  return titleCaseMedication(canonicalInput) || clean(verification.officialName);
}

export async function verifyMedicationName(rawName, options = {}) {
  try {
    return await searchCima(rawName, options);
  } catch (error) {
    const resolution = resolveHighConfidenceMedicationCandidate(rawName);
    return {
      status: "unavailable",
      rawName: clean(rawName),
      queriedName: clean(resolution.canonical) || clean(rawName),
      medicationAliasApplied: Boolean(resolution.corrected),
      medicationAliasId: resolution.aliasId || "",
      medicationCorrectionType: resolution.correctionType || "none",
      medicationHighConfidenceCandidate: resolution.correctionType === "high_confidence_fuzzy",
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
      if (options.onlyUnverified && med?.medication_verification?.status === "confirmed") continue;
      const rawName = clean(med.raw_name) || clean(med.display_name);
      if (!rawName) continue;
      medicationEntries.push({ med, rawName, key: normalize(rawName) });
    }
  }

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
        || verification.matchType === "active_ingredient_exact_token"
        || verification.matchType === "active_ingredient_master_exact";

      if (verification.medicationCorrectionType === "validated_alias") {
        warnings.push(`medication_validated_alias_applied:${rawName}->${verification.queriedName}`);
      }
      if (verification.medicationHighConfidenceCandidate) {
        warnings.push(`medication_high_confidence_candidate_confirmed:${rawName}->${verification.queriedName}`);
        appendSafetyReview(
          assessment,
          med,
          `La transcripción «${rawName}» se aproximó con alta confianza a «${verification.queriedName}» y CIMA confirmó ese medicamento. Confirmar visualmente el nombre antes de validar el informe.`,
          "medicacion_recuperada_por_similitud"
        );
      }
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
      medication_validated_alias_correction: true,
      medication_high_confidence_candidate_recovery: true,
      medication_free_fuzzy_autocorrection: false,
      medication_formulation_inference: false,
      medication_active_ingredient_lookup_precedes_product_lookup: true,
      medication_active_ingredient_master_fallback: true,
      medication_verification_parallelized: true,
      medication_only_unverified_pass: Boolean(options.onlyUnverified),
    },
  };
}


function escapeMedicationPattern(value) {
  return clean(value).split(/\s+/).map((part) => part.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")).join("\\s+");
}
function medicationMentionPattern(value) {
  const escaped = escapeMedicationPattern(value);
  return escaped ? new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu") : null;
}

function appendReportMedicationReview(assessment, evidence, topic) {
  assessment.safety_review ||= [];
  if (assessment.safety_review.some((item) => item.topic === topic && item.evidence === evidence)) return;
  assessment.safety_review.push({
    topic,
    evidence,
    source_ids: [],
    needs_clinician_review: true,
  });
}

export async function verifyReportMedicationMentions(inputAssessment, options = {}) {
  const assessment = structuredClone(inputAssessment);
  const warningSet = new Set();
  const candidates = new Map();
  const knownVocabulary = [
    ...PSYCHIATRIC_MEDICATION_VOCABULARY,
    ...MEDICATION_NAME_ALIASES.map((alias) => alias.source),
  ];

  for (const name of knownVocabulary) {
    const cleaned = clean(name);
    if (cleaned) candidates.set(normalize(cleaned), cleaned);
  }

  const medicationContextPattern = /\b(?:medicacion|medicación|tratamiento)\s+(?:con|de)\s+([a-záéíóúüñ][a-záéíóúüñ-]{3,})|(?:toma|tomar|tomando|iniciar|inicia|prescribir|prescribe|pautar|pauta|indicar|indica|mantener|suspender|suspende|retirar|retira|cambiar\s+a|cambio\s+a)\s+(?:(?:el|la|un|una)\s+)?([a-záéíóúüñ][a-záéíóúüñ-]{3,})/giu;
  const nonMedicationWords = new Set(["medicacion", "tratamiento", "pauta", "ninguna", "ningun", "ningún", "actualmente", "correctamente", "adecuadamente", "ninguno"]);
  for (const section of Object.values(assessment.sections || {})) {
    const text = clean(section?.text);
    if (!text) continue;
    for (const match of text.matchAll(medicationContextPattern)) {
      const candidate = clean(match[1] || match[2]);
      if (candidate && !nonMedicationWords.has(normalize(candidate))) {
        candidates.set(normalize(candidate), candidate);
      }
    }
  }

  for (const group of ["habitual", "current"]) {
    for (const med of assessment.medications?.[group] || []) {
      for (const name of [med?.raw_name, String(med?.display_name || "").includes("(") ? "" : med?.display_name, med?.medication_verification?.queriedName]) {
        const cleaned = clean(name);
        if (cleaned) candidates.set(normalize(cleaned), cleaned);
      }
    }
  }

  const sectionMatches = [];
  for (const [sectionKey, section] of Object.entries(assessment.sections || {})) {
    if (!section?.text) continue;
    for (const candidate of candidates.values()) {
      const pattern = medicationMentionPattern(candidate);
      if (!pattern) continue;
      const matches = [...section.text.matchAll(pattern)].map((match) => match[0]);
      for (const matchedText of matches) {
        sectionMatches.push({ sectionKey, candidate, matchedText });
      }
    }
  }

  const uniqueNames = new Map();
  for (const match of sectionMatches) {
    const key = normalize(match.candidate);
    if (!uniqueNames.has(key)) uniqueNames.set(key, match.candidate);
  }

  const structuredVerification = new Map();
  for (const group of ["habitual", "current"]) {
    for (const med of assessment.medications?.[group] || []) {
      const verification = med?.medication_verification;
      if (!verification) continue;
      for (const name of [med?.raw_name, verification?.queriedName, verification?.rawName]) {
        const key = normalize(name);
        if (key) structuredVerification.set(key, verification);
      }
    }
  }

  const pairs = await Promise.all([...uniqueNames.entries()].map(async ([key, name]) => {
    const existing = structuredVerification.get(key);
    return [key, existing || await verifyMedicationName(name, options)];
  }));
  const verifications = new Map(pairs);
  const replacements = new Map();
  let confirmedCount = 0;
  let pendingCount = 0;

  for (const [key, name] of uniqueNames) {
    const verification = verifications.get(key);
    const mention = sectionMatches.find((match) => normalize(match.candidate) === key);
    const mentionText = mention?.matchedText || name;
    const sectionLabel = mention?.sectionKey || "apartado no identificado";
    if (verification?.status === "confirmed") {
      confirmedCount += 1;
      const displayName = canonicalDisplayName(verification, mentionText);
      replacements.set(key, { name, displayName, status: "confirmed" });
    } else {
      pendingCount += 1;
      const unavailable = verification?.status === "unavailable";
      const suffix = unavailable ? " (verificación CIMA no disponible)" : " (no encontrada correspondencia en CIMA)";
      replacements.set(key, { name, displayName: `${mentionText}${suffix}`, status: verification?.status || "unavailable" });
      const evidence = unavailable
        ? `No se pudo verificar en CIMA la mención «${mentionText}» del apartado «${sectionLabel}». Confirmar manualmente antes de validar el informe.`
        : `No se encontró correspondencia en CIMA para la mención «${mentionText}» del apartado «${sectionLabel}». Confirmar manualmente antes de validar el informe.`;
      appendReportMedicationReview(assessment, evidence, unavailable ? "medicacion_en_informe_no_verificada" : "medicacion_en_informe_no_encontrada");
      warningSet.add(unavailable ? `report_medication_verification_unavailable:${mentionText}` : `report_medication_not_found_in_cima:${mentionText}`);
    }
  }

  for (const section of Object.values(assessment.sections || {})) {
    if (!section?.text) continue;
    const ordered = [...replacements.entries()].sort((left, right) => right[1].name.length - left[1].name.length);
    for (const [key, replacement] of ordered) {
      const pattern = medicationMentionPattern(replacement.name);
      if (!pattern) continue;
      section.text = section.text.replace(pattern, () => replacement.displayName);
    }
  }

  return {
    assessment,
    warnings: [...warningSet],
    meta: {
      medication_report_mentions_checked: uniqueNames.size,
      medication_report_mentions_confirmed: confirmedCount,
      medication_report_mentions_pending: pendingCount,
      medication_report_mention_sources: ["AEMPS CIMA"],
    },
  };
}
