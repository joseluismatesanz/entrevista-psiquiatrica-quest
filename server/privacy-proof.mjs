import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const PROOF_VERSION = "v1";
export const DEFAULT_PRIVACY_PROOF_TTL_MS = 10 * 60 * 1000;
export const LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS = 45 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 30 * 1000;

function rootSecret(env = process.env) {
  return env.PRIVACY_PROOF_SECRET || env.OPENAI_API_KEY || env.AI_GATEWAY_API_KEY || "";
}

function derivedKey(env = process.env) {
  const root = rootSecret(env);
  if (!root) return null;
  return createHmac("sha256", root)
    .update("entrevista-psiquiatrica:privacy-proof:v1", "utf8")
    .digest();
}

function normalizedTranscript(transcript) {
  return String(transcript || "").trim();
}

function transcriptDigest(transcript) {
  return createHash("sha256").update(normalizedTranscript(transcript), "utf8").digest("hex");
}

function macFor(transcript, expiresAt, key) {
  const payload = `${PROOF_VERSION}.${expiresAt}.${transcriptDigest(transcript)}`;
  return createHmac("sha256", key).update(payload, "utf8").digest("base64url");
}

function allowedTtl(options = {}) {
  return Number.isFinite(options.maxTtlMs)
    ? Math.max(1_000, Number(options.maxTtlMs))
    : DEFAULT_PRIVACY_PROOF_TTL_MS;
}

export function createPrivacyProof(transcript, options = {}) {
  const key = derivedKey(options.env || process.env);
  const text = normalizedTranscript(transcript);
  if (!key || !text) return "";

  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const maxTtlMs = allowedTtl(options);
  const requestedTtlMs = Number.isFinite(options.ttlMs)
    ? Math.max(1_000, Number(options.ttlMs))
    : DEFAULT_PRIVACY_PROOF_TTL_MS;
  const ttlMs = Math.min(requestedTtlMs, maxTtlMs);
  const expiresAt = now + ttlMs;
  const mac = macFor(text, expiresAt, key);
  return `${PROOF_VERSION}.${expiresAt}.${mac}`;
}

export function verifyPrivacyProof(transcript, token, options = {}) {
  const key = derivedKey(options.env || process.env);
  const text = normalizedTranscript(transcript);
  if (!key || !text || typeof token !== "string") return false;

  const [version, expiresRaw, suppliedMac, ...extra] = token.split(".");
  if (version !== PROOF_VERSION || extra.length || !/^\d{10,16}$/.test(expiresRaw) || !suppliedMac) return false;

  const expiresAt = Number(expiresRaw);
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const maxTtlMs = allowedTtl(options);
  if (!Number.isFinite(expiresAt) || expiresAt < now - MAX_CLOCK_SKEW_MS) return false;
  if (expiresAt > now + maxTtlMs + MAX_CLOCK_SKEW_MS) return false;

  const expectedMac = macFor(text, expiresAt, key);
  const supplied = Buffer.from(suppliedMac, "utf8");
  const expected = Buffer.from(expectedMac, "utf8");
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}
