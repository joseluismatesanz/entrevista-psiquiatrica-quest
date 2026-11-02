import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, client, validation] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../backend-client.js", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v058.js", import.meta.url), "utf8"),
]);

test("flujo posterior: Informe genera y abre directamente el correo", () => {
  assert.match(html, /id="analyzeCase"[^>]*>Informe<\/button>/);
  assert.match(client, /analyzeCase'\)\?\.addEventListener\('click', \(\) => analyzeWithBackend\('email'\)\)/);
  assert.match(client, /window\.sendClinicalReportDirect\(payload\.report\)/);
  assert.match(validation, /window\.sendClinicalReportDirect = sendClinicalReportDirect/);
  assert.match(validation, /mailto:\$\{EMAIL_RECIPIENT\}/);
});

test("flujo posterior: Organización muestra la transcripción antes de organizar", () => {
  assert.match(html, /id="organizeCase"[^>]*>Organización<\/button>/);
  assert.match(html, /id="organizeTranscript"[^>]*>Organizar información clínica<\/button>/);
  assert.match(client, /organizeCase'\)\?\.addEventListener\('click', openTranscriptForOrganization\)/);
  assert.match(client, /document\.body\.classList\.remove\('transcription-actions-only'\)/);
  assert.match(client, /organizeTranscript'\)\?\.addEventListener\('click', \(\) => analyzeWithBackend\('review'\)\)/);
});
