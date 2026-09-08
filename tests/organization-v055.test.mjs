import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, organizationJs, organizationCss, healthApi] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../organization-v055.js", import.meta.url), "utf8"),
  readFile(new URL("../organization-v055.css", import.meta.url), "utf8"),
  readFile(new URL("../api/health.mjs", import.meta.url), "utf8"),
]);

test("V0.5.5 organización: la interfaz usa estados clínicos comprensibles", () => {
  for (const label of [
    "Consta",
    "Negado explícitamente",
    "No explorado",
    "Información insuficiente",
    "Discrepancia",
    "Requiere revisión",
  ]) {
    assert.match(organizationJs, new RegExp(label));
  }
});

test("V0.5.5 organización: una negación explícita pura se diferencia de un apartado con información positiva", () => {
  assert.match(organizationJs, /function isPureExplicitDenial/);
  assert.match(organizationJs, /clauses\.every/);
  assert.match(organizationJs, /return isPureExplicitDenial\(preview\) \? 'explicitly_denied' : rawStatus/);
  assert.match(organizationJs, /consumo\\b/);
});

test("V0.5.5 organización: el resumen de pendientes es determinista y no presenta una puntuación de fiabilidad", () => {
  assert.match(organizationJs, /missingList/);
  assert.match(organizationJs, /conflictList/);
  assert.match(organizationJs, /mandatoryReviewItems/);
  assert.match(organizationJs, /No se completarán por inferencia/);
  assert.doesNotMatch(organizationJs, /% fiable|fiabilidad|risk score|riesgo bajo|riesgo alto/i);
});

test("V0.5.5 organización: seguridad clínica no se cuenta automáticamente como pendiente", () => {
  assert.match(organizationJs, /topic === 'revisión obligatoria'/);
  assert.match(organizationJs, /Resumen de seguridad clínica/);
  assert.match(organizationCss, /safety-summary-card/);
});

test("V0.5.5 organización: assets y llamada a borrador están conectados", () => {
  assert.match(indexHtml, /organization-v055\.css/);
  assert.match(indexHtml, /organization-v055\.js/);
  assert.match(indexHtml, /Generar borrador de informe/);
  assert.match(indexHtml, /V0\.5\.5/);
  assert.match(organizationCss, /organization-attention/);
});

test("V0.5.5 health expone las nuevas capacidades de organización", () => {
  assert.match(healthApi, /version: "0\.5\.5"/);
  assert.match(healthApi, /organization_status_labels_enabled: true/);
  assert.match(healthApi, /organization_attention_summary_enabled: true/);
});
