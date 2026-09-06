import http from "node:http";
import { analyzeTranscript } from "./analyze.mjs";

const PORT = Number(process.env.PORT || 8787);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:8080";

function send(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || origin === ALLOWED_ORIGIN) {
    return {
      "Access-Control-Allow-Origin": origin || ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
  }
  return {};
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }

  if (req.method !== "POST" || req.url !== "/api/analyze") {
    return send(res, 404, { error: "not_found" }, corsHeaders(req));
  }

  const headers = corsHeaders(req);
  if (req.headers.origin && !headers["Access-Control-Allow-Origin"]) {
    return send(res, 403, { error: "origin_not_allowed" });
  }

  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 1_500_000) req.destroy();
  });

  req.on("end", async () => {
    try {
      const body = JSON.parse(raw || "{}");
      // No se registra ni persiste la transcripción.
      const result = await analyzeTranscript(body.transcript);
      return send(res, 200, result, headers);
    } catch (error) {
      const status = error instanceof SyntaxError || error instanceof TypeError ? 400 : 502;
      return send(
        res,
        status,
        {
          error: error.name || "AnalysisError",
          message: error.message || "No se pudo completar el análisis.",
        },
        headers
      );
    }
  });
});

server.listen(PORT, () => {
  console.log(`API clínica de prueba escuchando en http://localhost:${PORT}`);
});
