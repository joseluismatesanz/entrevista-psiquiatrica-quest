const DEFAULT_TIMEOUT_MS = 55_000;
const MAX_REQUEST_CHARACTERS = 60_000;
const MAX_ITEMS_PER_REQUEST = 80;

function normalizeItems(inputItems) {
  const items = (Array.isArray(inputItems) ? inputItems : [])
    .map((item, index) => ({
      ...item,
      id: String(item?.id || `item-${index + 1}`),
      text: String(item?.text || ""),
    }))
    .filter((item) => item.text.trim());

  if (!items.length) throw new TypeError("No hay texto para anonimizar con Presidio.");
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new TypeError("Los fragmentos para Presidio contienen identificadores duplicados.");
  }
  return items;
}

function resolveEndpoint(options = {}) {
  const explicit = String(options.endpoint || process.env.PRESIDIO_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const deploymentHost = String(process.env.VERCEL_URL || "").trim();
  if (deploymentHost) return `https://${deploymentHost.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/api/presidio`;

  throw new Error("Presidio no está disponible en este entorno. Usa Vercel o configura PRESIDIO_URL.");
}

export function presidioEndpointForRequest(req) {
  const forwardedHost = String(req?.headers?.["x-forwarded-host"] || "").split(",")[0].trim();
  const requestHost = String(req?.headers?.host || "").trim();
  const host = forwardedHost || requestHost;

  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/i.test(host)) {
    return `https://${host}/api/presidio`;
  }
  if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(host)) {
    return `http://${host}/api/presidio`;
  }
  return undefined;
}

function chunkItems(items) {
  const chunks = [];
  let current = [];
  let characters = 0;

  for (const item of items) {
    const size = item.text.length + item.id.length + 32;
    if (item.text.length > MAX_REQUEST_CHARACTERS) {
      throw new RangeError("Un fragmento supera el tamaño permitido para Presidio.");
    }
    if (current.length && (current.length >= MAX_ITEMS_PER_REQUEST || characters + size > MAX_REQUEST_CHARACTERS)) {
      chunks.push(current);
      current = [];
      characters = 0;
    }
    current.push(item);
    characters += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function mergeEntityCounts(target, source) {
  for (const [entity, count] of Object.entries(source || {})) {
    target[entity] = (target[entity] || 0) + (Number(count) || 0);
  }
}

async function deidentifyChunk(chunk, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const endpoint = resolveEndpoint(options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Clinical-Privacy-Stage": "presidio-es",
      },
      body: JSON.stringify({
        language: "es",
        items: chunk.map(({ id, text }) => ({ id, text })),
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || `Presidio no pudo anonimizar el texto (${response.status}).`);
    }
    if (payload?.engine !== "presidio" || payload?.language !== "es" || !Array.isArray(payload.items)) {
      throw new Error("Presidio devolvió una respuesta no verificable.");
    }

    const byId = new Map();
    for (const item of payload.items) {
      const id = String(item?.id || "");
      const text = String(item?.text || "");
      if (!id || !text.trim() || byId.has(id)) throw new Error("Presidio devolvió fragmentos incompletos o duplicados.");
      byId.set(id, { text, replacements: Number(item.replacements) || 0, entityCounts: item.entity_counts || {} });
    }
    if (byId.size !== chunk.length || chunk.some((item) => !byId.has(item.id))) {
      throw new Error("Presidio no devolvió todos los fragmentos solicitados.");
    }

    return {
      items: chunk.map((item) => ({ ...item, ...byId.get(item.id) })),
      version: String(payload.version || "unknown"),
      model: String(payload.model || "es_core_news_md"),
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Presidio agotó el tiempo de anonimización.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function deidentifySegmentsWithPresidio(inputSegments, options = {}) {
  const items = normalizeItems(inputSegments);
  const output = [];
  const entityCounts = {};
  let version = "unknown";
  let model = "es_core_news_md";

  for (const chunk of chunkItems(items)) {
    const result = await deidentifyChunk(chunk, options);
    version = result.version;
    model = result.model;
    for (const item of result.items) {
      mergeEntityCounts(entityCounts, item.entityCounts);
      output.push(item);
    }
  }

  const replacements = output.reduce((total, item) => total + item.replacements, 0);
  return {
    segments: output.map(({ replacements: _replacements, entityCounts: _entityCounts, ...item }) => ({
      ...item,
      presidio_replacements: _replacements,
    })),
    replacements,
    entityCounts,
    meta: {
      enabled: true,
      engine: "presidio",
      version,
      model,
      language: "es",
      self_hosted: !process.env.PRESIDIO_URL && !options.endpoint,
      store: false,
      fail_closed: true,
    },
  };
}

function splitTranscript(transcript, maxCharacters = 40_000) {
  const lines = transcript.split(/(\r?\n)/);
  const items = [];
  let text = "";
  let index = 1;

  for (const part of lines) {
    if (text && text.length + part.length > maxCharacters) {
      items.push({ id: `transcript-${index++}`, text });
      text = "";
    }
    text += part;
  }
  if (text) items.push({ id: `transcript-${index}`, text });
  return items;
}

export async function deidentifyTranscriptWithPresidio(inputTranscript, options = {}) {
  const transcript = String(inputTranscript || "").trim();
  if (!transcript) throw new TypeError("No hay transcripción para anonimizar con Presidio.");

  const result = await deidentifySegmentsWithPresidio(splitTranscript(transcript), options);
  return {
    transcript: result.segments.map((item) => item.text).join(""),
    replacements: result.replacements,
    entityCounts: result.entityCounts,
    meta: result.meta,
  };
}
