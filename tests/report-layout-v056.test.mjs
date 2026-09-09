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
  assert.match(reportJs, /escapeHtml\(section\.body/);
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
