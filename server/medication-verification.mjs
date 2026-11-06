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


function stripHtmlText(value) {
  return String(value || "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/(?:p|li|div|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/&uuml;/gi, "ü")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim();
}

function section45Text(payload) {
  const sections = Array.isArray(payload)
    ? payload
    : listFromPayload(payload?.secciones ? payload.secciones : payload);
  const section = sections.find((item) => String(item?.seccion ?? item?.section ?? item?.id ?? "").trim() === "4.5")
    || (payload && typeof payload === "object" && String(payload.seccion ?? payload.section ?? "") === "4.5" ? payload : null);
  return stripHtmlText(section?.contenido ?? section?.content ?? "");
}

function interactionDrugNames(med) {
  const verification = med?.medication_verification || {};
  const values = [
    ...(Array.isArray(verification.activeIngredients) ? verification.activeIngredients : []),
    ...(Array.isArray(med?.active_ingredients) ? med.active_ingredients : []),
    verification.queriedName,
    med?.display_name,
    med?.raw_name,
  ];
  const candidates = new Set();
  for (const value of values) {
    const full = normalize(value).replace(/\b(?:hidrocloruro|clorhidrato|succinato|maleato|fumarato|mesilato|besilato|tartrato|citrato|sulfato|hemifumarato)\b/g, " ").replace(/\s+/g, " ").trim();
    if (full.length >= 5) candidates.add(full);
    const first = full.split(/\s+/)[0];
    if (first?.length >= 6) candidates.add(first);
  }
  return [...candidates].sort((a, b) => b.length - a.length);
}

function hasExactMedicineMention(text, candidates) {
  const normalizedText = normalize(text);
  return candidates.some((candidate) => {
    const escaped = escapeMedicationPattern(candidate);
    return escaped && new RegExp("(?<![a-z0-9])" + escaped + "(?![a-z0-9])", "i").test(normalizedText);
  });
}

function interactionSignal(text) {
  const normalized = normalize(text);
  const withoutNegatedContraindication = normalized.replace(/\bno\s+(?:esta|es|se considera)\s+contraindicad[oa]\b/g, "");
  if (/\b(?:contraindicad[oa]|no debe administrarse|no debe utilizarse|evitar la asociacion|evitar el uso concomitante)\b/.test(withoutNegatedContraindication)) {
    return "La ficha técnica indica contraindicar o evitar la asociación";
  }
  if (/\b(?:precaucion|monitorizar|vigilar|controlar|puede aumentar|puede reducir|riesgo de|se recomienda controlar)\b/.test(normalized)) {
    return "La ficha técnica describe una interacción que requiere precaución o monitorización";
  }
  return "Interacción mencionada en la ficha técnica";
}

async function fetchInteractionSection(nregistro, fetchFn, timeoutMs) {
  const url = `${CIMA_BASE_URL}/docSegmentado/contenido/1?nregistro=${encodeURIComponent(nregistro)}&seccion=4.5`;
  const payload = await fetchJson(url, fetchFn, timeoutMs);
  const text = section45Text(payload);
  if (!text) throw new Error("CIMA no devolvió el contenido de la sección 4.5");
  return {
    text,
    url: `https://cima.aemps.es/cima/dochtml/ft/${encodeURIComponent(nregistro)}/4.5/FichaTecnica.html`,
  };
}


function sectionTextById(payload, id) {
  const sections = Array.isArray(payload)
    ? payload
    : listFromPayload(payload?.secciones ? payload.secciones : payload);
  const section = sections.find((item) => String(item?.seccion ?? item?.section ?? item?.id ?? "").trim() === String(id))
    || (payload && typeof payload === "object" && String(payload.seccion ?? payload.section ?? "") === String(id) ? payload : null);
  return stripHtmlText(section?.contenido ?? section?.content ?? "");
}

async function fetchCimaFichaSection(nregistro, sectionId, fetchFn, timeoutMs) {
  const payload = await fetchJson(
    `${CIMA_BASE_URL}/docSegmentado/contenido/1?nregistro=${encodeURIComponent(nregistro)}&seccion=${encodeURIComponent(sectionId)}`,
    fetchFn,
    timeoutMs,
  );
  const text = sectionTextById(payload, sectionId);
  if (!text) throw new Error(`CIMA no devolvió la sección ${sectionId}`);
  return {
    text,
    url: `https://cima.aemps.es/cima/dochtml/ft/${encodeURIComponent(nregistro)}/${encodeURIComponent(sectionId)}/FichaTecnica.html`,
  };
}

function extractDoseBoundaries(section42) {
  const text = section42.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/,/g, ".");
  const range = text.match(/(?:entre|de)\s*(\d+(?:\.\d+)?)\s*(?:a|y|[-–])\s*(\d+(?:\.\d+)?)\s*mg(?:\s*\/?\s*d[ií]a|\s+diarios?)?/i);
  const maximum = text.match(/maxim[oa]s?[^.]{0,140}?(\d+(?:\.\d+)?)\s*mg(?:\s*\/?\s*d[ií]a|\s+diarios?)?/i)
    || text.match(/\bno\s+debe\s+superar[^.]{0,100}?(\d+(?:\.\d+)?)\s*mg(?:\s*\/?\s*d[ií]a)?/i);
  return {
    minimum: range ? Number(range[1]) : null,
    maximum: range ? Number(range[2]) : maximum ? Number(maximum[1]) : null,
    rangeFound: Boolean(range),
    maxFound: Boolean(range || maximum),
  };
}

function calculatedDailyDose(med) {
  const doseMatch = clean(med?.dose).replace(/,/g, ".").match(/(\d+(?:\.\d+)?)\s*(mg|mcg|µg|ug|g)\b/i);
  const schedule = clean(med?.schedule).replace(/,/g, ".");
  const slots = schedule.match(/^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/);
  if (!doseMatch || !slots || med?.prn) return null;
  let strength = Number(doseMatch[1]);
  const unit = doseMatch[2].toLowerCase();
  if (unit === "g") strength *= 1000;
  else if (unit === "mcg" || unit === "µg" || unit === "ug") strength /= 1000;
  const administrations = slots.slice(1).reduce((sum, value) => sum + Number(value), 0);
  return Number((strength * administrations).toFixed(4));
}

export async function reviewMedicationDosesAgainstCima(inputAssessment, options = {}) {
  const assessment = structuredClone(inputAssessment);
  const fetchFn = options.fetchFn || globalThis.fetch;
  const timeoutMs = options.timeoutMs || 6000;
  const warnings = [];
  const entries = [];
  const diagnosis = clean(assessment.diagnostic_judgment?.primary_diagnosis);
  let checked = 0;
  let unavailable = 0;

  for (const group of ["habitual", "current"]) {
    for (const med of assessment.medications?.[group] || []) {
      if (med?.status !== "active") continue;
      const verification = med?.medication_verification || {};
      const label = clean(med.display_name || med.raw_name) || "Medicamento no identificado";
      const registry = clean(verification.nregistro);
      const review = {
        source: "AEMPS CIMA, ficha técnica secciones 4.1 y 4.2",
        status: "not_assessable",
        daily_dose_mg: calculatedDailyDose(med),
        dose_boundary_mg: null,
        indication_status: diagnosis ? "requires_clinician_review" : "not_assessable",
        diagnosis: diagnosis || "",
        note: "",
        source_url: "",
      };
      med.cima_dose_review = review;
      if (verification.status !== "confirmed" || !registry) {
        review.status = "cima_product_unconfirmed";
        review.note = "No se pudo vincular esta entidad con un medicamento registrado en CIMA; no se valora la dosis.";
        unavailable += 1;
        continue;
      }
      try {
        const [section41, section42] = await Promise.all([
          fetchCimaFichaSection(registry, "4.1", fetchFn, timeoutMs),
          fetchCimaFichaSection(registry, "4.2", fetchFn, timeoutMs),
        ]);
        checked += 1;
        review.source_url = section42.url;
        const boundaries = extractDoseBoundaries(section42.text);
        const dailyDose = review.daily_dose_mg;
        review.dose_boundary_mg = {
          minimum: boundaries.minimum,
          maximum: boundaries.maximum,
          source_section: "4.2",
        };
        // Keep section 4.1 available as the source of authorized indications;
        // automated matching is intentionally not treated as a diagnosis.
        const section41HasText = Boolean(section41.text.trim());
        if (dailyDose !== null && boundaries.rangeFound) {
          if (dailyDose < boundaries.minimum || dailyDose > boundaries.maximum) {
            review.status = "off_label_dose";
            review.note = `OFF-LABEL por dosis: ${dailyDose} mg/día frente al rango posológico CIMA de ${boundaries.minimum}–${boundaries.maximum} mg/día (sección 4.2). Verificar formulación, frecuencia y contexto clínico.`;
          } else {
            review.status = "within_cima_range";
            review.note = `Dosis calculada: ${dailyDose} mg/día; dentro del rango de ${boundaries.minimum}–${boundaries.maximum} mg/día indicado en CIMA (sección 4.2). La indicación y la adecuación individual requieren revisión clínica.`;
          }
        } else if (dailyDose !== null && boundaries.maxFound && boundaries.maximum !== null) {
          if (dailyDose > boundaries.maximum) {
            review.status = "off_label_dose";
            review.note = `OFF-LABEL por dosis: ${dailyDose} mg/día supera el maximo de ${boundaries.maximum} mg/día de CIMA (sección 4.2). Verificar formulación, frecuencia y contexto clínico.`;
          } else {
            review.status = "within_cima_maximum";
            review.note = `Dosis calculada: ${dailyDose} mg/día; no supera el maximo de ${boundaries.maximum} mg/día localizado en CIMA (sección 4.2). No se ha inferido que la dosis o indicación estén aprobadas; validar clínicamente.`;
          }
        } else {
          review.status = "not_assessable";
          review.note = dailyDose === null
            ? "CIMA consultada (secciones 4.1 y 4.2), pero no se puede calcular la dosis diaria con seguridad a partir de la dosis y pauta estructuradas."
            : "CIMA consultada (secciones 4.1 y 4.2), pero no se pudo extraer automáticamente un límite posológico explícito comparable.";
        }
        if (!diagnosis || !section41HasText) {
          review.indication_status = "not_assessable";
          review.note += " No se puede confirmar la indicación autorizada porque el diagnóstico o los datos clínicos necesarios no constan.";
        }
      } catch (error) {
        review.status = "cima_section_unavailable";
        review.note = `No se pudo consultar la ficha técnica CIMA (secciones 4.1/4.2): ${String(error?.message || "error de consulta")}.`;
        unavailable += 1;
      }
      entries.push({ group, label, status: review.status });
      if (review.status === "off_label_dose") warnings.push(`medication_off_label_dose:${group}:${label}`);
    }
  }
  assessment.medication_dose_review = {
    source: "AEMPS CIMA, ficha técnica secciones 4.1 y 4.2",
    checked_products: checked,
    unavailable_products: unavailable,
    entries,
  };
  return {
    assessment,
    warnings,
    meta: {
      medication_dose_review_source: assessment.medication_dose_review.source,
      medication_dose_review_checked_products: checked,
      medication_dose_review_unavailable_products: unavailable,
    },
  };
}

export async function checkCurrentMedicationInteractions(inputAssessment, options = {}) {
  const assessment = structuredClone(inputAssessment);
  const current = (assessment.medications?.current || []).filter((med) => med?.status === "active");
  const review = { source: "AEMPS CIMA, ficha técnica sección 4.5", status: "not_applicable", checked_pairs: 0, findings: [], note: "" };

  if (current.length < 2) {
    review.status = "single_or_no_medication";
    review.note = current.length
      ? "No hay una combinación de dos o más medicamentos activos en el tratamiento revisado para comparar."
      : "No consta medicación activa en el tratamiento revisado.";
    assessment.medication_interaction_review = review;
    return { assessment, warnings: [], meta: { medication_interaction_check_source: review.source, medication_interaction_check_status: review.status } };
  }

  const fetchFn = options.fetchFn || globalThis.fetch;
  const timeoutMs = options.timeoutMs || 6000;
  const medicationData = [];
  const unavailable = [];

  for (const med of current) {
    const verification = med?.medication_verification || {};
    const candidates = interactionDrugNames(med);
    const registry = clean(verification.nregistro);
    if (verification.status !== "confirmed" || !candidates.length || !registry) {
      unavailable.push(clean(med.display_name || med.raw_name) || "medicamento no identificado");
      continue;
    }
    medicationData.push({
      label: clean(med.display_name || med.raw_name),
      registry,
      candidates,
      ingredients: Array.isArray(verification.activeIngredients) ? verification.activeIngredients : [],
    });
  }

  if (unavailable.length) {
    review.status = "incomplete";
    review.note = `Comprobación incompleta: no se pudo vincular con CIMA ${[...new Set(unavailable)].join(", ")}. No se puede concluir que no haya interacciones.`;
    assessment.medication_interaction_review = review;
    return {
      assessment,
      warnings: ["medication_interaction_check_incomplete"],
      meta: { medication_interaction_check_source: review.source, medication_interaction_check_status: review.status },
    };
  }

  const uniqueRegistries = [...new Set(medicationData.map((med) => med.registry))];
  const fetched = await Promise.all(uniqueRegistries.map(async (registry) => {
    try {
      return [registry, await fetchInteractionSection(registry, fetchFn, timeoutMs)];
    } catch (error) {
      return [registry, { error: String(error?.message || "No se pudo consultar CIMA") }];
    }
  }));
  const sections = new Map(fetched);

  const pairKeys = new Set();
  for (let leftIndex = 0; leftIndex < medicationData.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < medicationData.length; rightIndex += 1) {
      const left = medicationData[leftIndex];
      const right = medicationData[rightIndex];
      if (left.registry === right.registry) continue;
      review.checked_pairs += 1;
      const key = [left.label, right.label].sort().join(" + ");
      if (pairKeys.has(key)) continue;
      pairKeys.add(key);

      let found = null;
      for (const [source, target] of [[left, right], [right, left]]) {
        const section = sections.get(source.registry);
        if (!section || section.error) continue;
        const evidence = section.text
          .split(/\n+/)
          .map((paragraph) => paragraph.trim())
          .find((paragraph) => hasExactMedicineMention(paragraph, target.candidates));
        if (evidence) {
          found = {
            medicines: [left.label, right.label],
            type: interactionSignal(evidence),
            detail: evidence,
            source: section.url,
          };
          break;
        }
      }
      if (found) review.findings.push(found);
    }
  }

  const failed = fetched.filter(([, section]) => section.error);
  if (failed.length) {
    review.status = "incomplete";
    review.note = `No se pudo consultar la sección 4.5 de ${failed.length} ficha(s) técnica(s) en CIMA. No se puede concluir que no haya interacciones.`;
  } else if (review.findings.length) {
    review.status = "interaction_found";
    review.note = "CIMA describe las siguientes interacciones entre medicamentos del tratamiento revisado.";
  } else {
    review.status = "no_direct_interaction_found";
    review.note = "No se encontró una mención directa entre estos principios activos en las secciones 4.5 consultadas. Esto no excluye interacciones por clases, factores del paciente u otras fuentes.";
  }

  assessment.medication_interaction_review = review;
  return {
    assessment,
    warnings: review.status === "interaction_found" ? ["medication_interaction_found"] : failed.length ? ["medication_interaction_check_incomplete"] : [],
    meta: {
      medication_interaction_check_source: review.source,
      medication_interaction_check_status: review.status,
      medication_interaction_pairs_checked: review.checked_pairs,
    },
  };
}
