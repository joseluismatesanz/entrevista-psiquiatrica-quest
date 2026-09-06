function setPrivacyHeaders(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export default async function handler(req, res) {
  setPrivacyHeaders(res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const gatewayAvailable = Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
  const directOpenAIAvailable = Boolean(process.env.OPENAI_API_KEY);

  return res.status(200).json({
    ok: true,
    version: "0.4",
    mode: "text_only",
    recording_enabled: false,
    persistent_clinical_storage: false,
    response_cache: "no-store",
    model_transport_available: gatewayAvailable
      ? "vercel_ai_gateway"
      : directOpenAIAvailable
        ? "openai_direct"
        : "missing",
  });
}
