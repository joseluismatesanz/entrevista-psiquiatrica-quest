import { resolveModelAuth } from "../server/model-auth.mjs";

const REALTIME_TRANSCRIPTION_MODEL = "gpt-live-transcribe";

function setPrivacyHeaders(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export default async function handler(req, res) {
  setPrivacyHeaders(res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const auth = await resolveModelAuth();
    // Los client secrets de Realtime se emiten con una clave OpenAI estándar.
    // Si el despliegue usa un gateway, el navegador conserva automáticamente el fallback batch.
    if (!auth?.apiKey || auth.transport !== "openai-direct") {
      return res.status(503).json({
        error: "realtime_unavailable",
        message: "La transcripción en tiempo real no está disponible en este despliegue.",
      });
    }

    const upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "transcription",
          audio: {
            input: {
              transcription: {
                model: REALTIME_TRANSCRIPTION_MODEL,
                languages: ["es"],
                delay: "low",
              },
              noise_reduction: { type: "far_field" },
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 450,
              },
            },
          },
          include: [],
        },
      }),
    });

    if (!upstream.ok) {
      return res.status(503).json({
        error: "realtime_unavailable",
        message: "No se pudo iniciar la transcripción en tiempo real; se usará el modo compatible.",
      });
    }

    const data = await upstream.json().catch(() => ({}));
    if (typeof data?.value !== "string" || !data.value.startsWith("ek_")) {
      return res.status(503).json({ error: "invalid_realtime_secret" });
    }

    // Nunca se devuelve la API key principal ni la configuración del proveedor.
    return res.status(200).json({
      value: data.value,
      expires_at: Number(data.expires_at) || null,
      model: REALTIME_TRANSCRIPTION_MODEL,
    });
  } catch {
    return res.status(503).json({
      error: "realtime_unavailable",
      message: "No se pudo iniciar la transcripción en tiempo real; se usará el modo compatible.",
    });
  }
}
