export async function resolveModelAuth(options = {}) {
  const env = options.env || process.env;

  if (env.AI_GATEWAY_API_KEY) {
    return {
      apiKey: env.AI_GATEWAY_API_KEY,
      baseURL: "https://ai-gateway.vercel.sh/v1",
      transport: "vercel-ai-gateway-key",
      defaultModel: "openai/gpt-5.6-sol",
    };
  }

  // En Vercel, obtener el token OIDC en tiempo de ejecución es más robusto
  // que asumir que VERCEL_OIDC_TOKEN existe como variable de entorno.
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

  if (env.OPENAI_API_KEY) {
    return {
      apiKey: env.OPENAI_API_KEY,
      baseURL: undefined,
      transport: "openai-direct",
      defaultModel: "gpt-5.6",
    };
  }

  return null;
}
