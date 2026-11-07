export async function resolveModelAuth(options = {}) {
  const env = options.env || process.env;

  // Preferencia de producción: OpenAI directo cuando existe OPENAI_API_KEY.
  // Esto evita depender de la facturación de Vercel AI Gateway y mantiene
  // la clave exclusivamente en el entorno server-side de Vercel.
  if (env.OPENAI_API_KEY) {
    return {
      apiKey: env.OPENAI_API_KEY,
      baseURL: undefined,
      transport: "openai-direct",
      defaultModel: "gpt-5.6",
    };
  }

  if (env.AI_GATEWAY_API_KEY) {
    return {
      apiKey: env.AI_GATEWAY_API_KEY,
      baseURL: "https://ai-gateway.vercel.sh/v1",
      transport: "vercel-ai-gateway-key",
      defaultModel: "openai/gpt-5.6-sol",
    };
  }

  // Fallback de pruebas/despliegue: Vercel AI Gateway mediante OIDC.
  // Puede requerir método de pago en el workspace de Vercel.
  try {
    const { getVercelOidcToken } = await import("@vercel/oidc");
    const oidcToken = await getVercelOidcToken({
      project: env.VERCEL_PROJECT_ID || "salud-mental-v04-clinical",
      team: env.VERCEL_TEAM_ID || "team_YLFMxhxyNMPMHeeGr4094QWC",
      expirationBufferMs: 60_000,
    });

    if (oidcToken) {
      return {
        apiKey: oidcToken,
        baseURL: "https://ai-gateway.vercel.sh/v1",
        transport: "vercel-ai-gateway-oidc-runtime",
        defaultModel: "openai/gpt-5.6-sol",
      };
    }
  } catch {
    // No registrar detalles ni tokens; se continúa con los fallbacks seguros.
  }

  if (env.VERCEL_OIDC_TOKEN) {
    return {
      apiKey: env.VERCEL_OIDC_TOKEN,
      baseURL: "https://ai-gateway.vercel.sh/v1",
      transport: "vercel-ai-gateway-oidc-env",
      defaultModel: "openai/gpt-5.6-sol",
    };
  }

  return null;
}
