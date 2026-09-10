import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, reportJs, reportCss, healthApi, packageJson] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../report-v056.js", import.meta.url), "utf8"),
  readFile(new URL("../report-v056.css", import.meta.url), "utf8"),
  readFile(new URL("../api/health.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

test("V0.5.6 informe: la pantalla se presenta como borrador pendiente de revisión", () => {
  assert.match(indexHtml, /Borrador de informe clínico/);
  assert.match(indexHtml, /Pendiente de validación profesional/);
  assert.match(indexHtml, /DOCUMENTO CLÍNICO PENDIENTE DE REVISIÓN/);
});

test("V0.5.6 informe: resume pendientes sin convertirlos en hallazgos negativos", () => {
  assert.match(reportJs, /INFORMACIÓN PENDIENTE EN ESTE BORRADOR/);
  assert.match(reportJs, /No los transforma en hallazgos negativos/);
  assert.match(reportJs, /missingList/);
  assert.match(reportJs, /conflictList/);
  assert.match(reportJs, /revisión obligatoria/);
});

test("V0.5.6 informe: la validación siempre requiere una acción explícita del profesional", () => {
  assert.match(reportJs, /function resetReportValidation/);
  assert.match(reportJs, /checkbox\.checked = false/);
  assert.match(reportJs, /copyButton\.disabled = true/);
  assert.match(reportJs, /window\.addEventListener\('pageshow', resetReportValidation\)/);
  assert.match(reportJs, /resetReportValidation\(\);/);
});

test("V0.5.6 informe: editar invalida cualquier validación previa", () => {
  assert.match(reportJs, /function startSectionEditor[\s\S]*resetReportValidation\(\)/);
  assert.match(reportJs, /function saveSectionEditor[\s\S]*resetReportValidation\(\)/);
  assert.match(reportJs, /document\.addEventListener\('input',[\s\S]*report-section-input[\s\S]*resetReportValidation\(\)/);
  assert.match(reportJs, /report-section-editing/);
  assert.match(reportJs, /event\.target\.checked = false/);
});

test("V0.5.6 informe: assets de pantalla 3 están conectados", () => {
  assert.match(indexHtml, /report-v056\.css/);
  assert.match(indexHtml, /report-v056\.js/);
  assert.match(indexHtml, /reportPendingBanner/);
  assert.match(reportCss, /report-pending-banner/);
});

test("V0.5.6: versión y health están sincronizados", () => {
  assert.match(indexHtml, /V0\.5\.6/);
  assert.match(packageJson, /"version": "0\.5\.6"/);
  assert.match(healthApi, /version: "0\.5\.6"/);
  assert.match(healthApi, /report_draft_pending_summary_enabled: true/);
});
