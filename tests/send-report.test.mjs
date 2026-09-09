import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/send-report.mjs";

function makeResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

function makeRequest({ method = "POST", body = {}, headers = {} } = {}) {
  return {
    method,
    body,
    headers: {
      host: "clinical.example.test",
      origin: "https://clinical.example.test",
      ...headers,
    },
  };
}

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.RESEND_API_KEY;
const originalFrom = process.env.REPORT_FROM_EMAIL;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalApiKey;
  if (originalFrom === undefined) delete process.env.REPORT_FROM_EMAIL;
  else process.env.REPORT_FROM_EMAIL = originalFrom;
});

test("send-report: solo admite POST y fuerza no-store", async () => {
  const res = makeResponse();
  await handler(makeRequest({ method: "GET" }), res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers["cache-control"], "no-store, max-age=0");
  assert.equal(res.body.error, "method_not_allowed");
});

test("send-report: rechaza informe vacío", async () => {
  const res = makeResponse();
  await handler(makeRequest({ body: { report: "   " } }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "report_required");
});

test("send-report: no intenta enviar si el transporte no está configurado", async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.REPORT_FROM_EMAIL;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("should not run");
  };

  const res = makeResponse();
  await handler(makeRequest({ body: { report: "Informe ficticio" } }), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "email_transport_not_configured");
  assert.equal(called, false);
});

test("send-report: fija el destinatario institucional en backend", async () => {
  process.env.RESEND_API_KEY = "test-key";
  process.env.REPORT_FROM_EMAIL = "prototipo@example.org";

  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return { id: "email_123" };
      },
    };
  };

  const res = makeResponse();
  await handler(
    makeRequest({
      body: {
        report: "MOTIVO DE LA CONSULTA\nTexto ficticio",
        requestId: "request-123",
      },
    }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.accepted, true);
  assert.equal(res.body.recipient, "joseluis.matesanz@salud-juntaex.es");
  assert.equal(res.body.provider_id, "email_123");
  assert.equal(request.url, "https://api.resend.com/emails");

  const payload = JSON.parse(request.options.body);
  assert.deepEqual(payload.to, ["joseluis.matesanz@salud-juntaex.es"]);
  assert.equal(payload.from, "prototipo@example.org");
  assert.equal(payload.subject, "Informe clínico validado");
  assert.equal(payload.text, "MOTIVO DE LA CONSULTA\nTexto ficticio");
  assert.equal(request.options.headers["Idempotency-Key"], "request-123");
  assert.doesNotMatch(JSON.stringify(payload), /gmail\.com/i);
});

test("send-report: si el proveedor rechaza, no confirma envío", async () => {
  process.env.RESEND_API_KEY = "test-key";
  process.env.REPORT_FROM_EMAIL = "prototipo@example.org";
  globalThis.fetch = async () => ({ ok: false, status: 422 });

  const res = makeResponse();
  await handler(makeRequest({ body: { report: "Informe ficticio" } }), res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, "email_delivery_rejected");
  assert.equal(res.body.provider_status, 422);
  assert.doesNotMatch(JSON.stringify(res.body), /Informe ficticio/);
});
