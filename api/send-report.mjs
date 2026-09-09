const REPORT_RECIPIENT = "joseluis.matesanz@salud-juntaex.es";
const MAX_REPORT_CHARS = 120_000;

function setPrivacyHeaders(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function requestBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body || "");
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function sameOriginRequest(req) {
  const origin = String(req.headers?.origin || "").trim();
  const host = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "").trim();
  if (!origin || !host) return true;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  setPrivacyHeaders(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  if (!sameOriginRequest(req)) {
    return res.status(403).json({ error: "origin_not_allowed" });
  }

  const contentLength = Number(req.headers?.["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > 180_000) {
    return res.status(413).json({ error: "payload_too_large" });
  }

  const body = requestBody(req);
  const report = typeof body.report === "string" ? body.report.trim() : "";
  const requestId = typeof body.requestId === "string" ? body.requestId.trim().slice(0, 120) : "";

  if (!report) {
    return res.status(400).json({ error: "report_required" });
  }

  if (report.length > MAX_REPORT_CHARS) {
    return res.status(413).json({ error: "report_too_large" });
  }

  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.REPORT_FROM_EMAIL || "").trim();

  if (!apiKey || !from) {
    return res.status(503).json({
      error: "email_transport_not_configured",
      required_environment: ["RESEND_API_KEY", "REPORT_FROM_EMAIL"],
    });
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (requestId) headers["Idempotency-Key"] = requestId;

  let providerResponse;
  try {
    providerResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from,
        to: [REPORT_RECIPIENT],
        subject: "Informe clínico validado",
        text: report,
      }),
    });
  } catch {
    return res.status(502).json({ error: "email_transport_unreachable" });
  }

  if (!providerResponse.ok) {
    return res.status(502).json({
      error: "email_delivery_rejected",
      provider_status: providerResponse.status,
    });
  }

  let providerId = null;
  try {
    const result = await providerResponse.json();
    providerId = typeof result?.id === "string" ? result.id : null;
  } catch {
    providerId = null;
  }

  return res.status(200).json({
    ok: true,
    accepted: true,
    recipient: REPORT_RECIPIENT,
    provider_id: providerId,
  });
}
