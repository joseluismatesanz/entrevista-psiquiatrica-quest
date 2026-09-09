import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [reportJs, reportCss] = await Promise.all([
  readFile(new URL("../report-v056.js", import.meta.url), "utf8"),
  readFile(new URL("../report-v056.css", import.meta.url), "utf8"),
]);

test("V0.5.6 informe: el texto clínico se presenta por apartados sin regenerar contenido", () => {
  assert.match(reportJs, /parseReportSections/);
  assert.match(reportJs, /report-section-block/);
  assert.match(reportJs, /editor\.innerText \|\| editor\.textContent/);
  assert.match(reportJs, /escapeHtml\(body\)/);
});

test("V0.5.6 informe: los apartados mantienen una presentación clínica compacta de una sola columna", () => {
  assert.match(reportCss, /\.report-section-block/);
  assert.match(reportCss, /\.report-section-block h3/);
  assert.match(reportCss, /\.report-section-block p/);
  assert.match(reportCss, /\.structured-report-editor\{[^}]*white-space:normal/);
  assert.match(reportCss, /\.report-section-block p\{[^}]*white-space:pre-wrap/);
  assert.doesNotMatch(reportCss, /grid-template-columns:[^}]*repeat\(2/i);
});

test("V0.5.6 informe: los apartados sin información se diferencian sin convertirlos en negativos", () => {
  assert.match(reportJs, /no explorado\./i);
  assert.match(reportJs, /no consta\./i);
  assert.match(reportJs, /información insuficiente\./i);
  assert.match(reportCss, /report-section-empty/);
});

test("V0.5.6 informe: la edición es controlada por apartado y no sobre todo el documento", () => {
  assert.match(reportJs, /report-edit-button/);
  assert.match(reportJs, /report-section-input/);
  assert.match(reportJs, /report-section-save/);
  assert.match(reportJs, /report-section-cancel/);
  assert.match(reportJs, /editor\.setAttribute\('contenteditable', 'false'\)/);
  assert.match(reportCss, /\.report-section-input/);
});

test("V0.5.6 informe: un cambio profesional queda marcado y obliga a revalidar", () => {
  assert.match(reportJs, /Editado por profesional/);
  assert.match(reportJs, /report-section-edited/);
  assert.match(reportJs, /resetReportValidation\(\);/);
  assert.match(reportCss, /report-edited-label/);
});

test("V0.5.6 informe: la copia validada serializa solo títulos y contenido clínico", () => {
  assert.match(reportJs, /function getClinicalReportText\(\)/);
  assert.match(reportJs, /block\.querySelector\('h3'\)/);
  assert.match(reportJs, /block\.querySelector\('\.report-section-text'\)/);
  assert.match(reportJs, /navigator\.clipboard\.writeText\(getClinicalReportText\(\)\)/);
  assert.match(reportJs, /stopImmediatePropagation/);
});
