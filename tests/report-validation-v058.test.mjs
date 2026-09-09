import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [indexHtml, validationJs] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../report-validation-v058.js", import.meta.url), "utf8"),
]);

test("V0.5.6 validación: una edición exige un paso explícito de revisión antes de volver a validar", () => {
  assert.match(validationJs, /reviewedRevision/);
  assert.match(validationJs, /Cambios pendientes de revalidación/);
  assert.match(validationJs, /Revisar cambios del informe/);
  assert.match(validationJs, /hasUnreviewedChanges/);
  assert.match(validationJs, /check\.disabled = editing \|\| pendingReview/);
});

test("V0.5.6 validación: revisar cambios no valida; solo vuelve a habilitar la casilla", () => {
  assert.match(validationJs, /function markChangesReviewed/);
  assert.match(validationJs, /state\.reviewedRevision = state\.revision/);
  assert.match(validationJs, /state\.validatedRevision = null/);
  assert.match(validationJs, /Cambios revisados\. Marca la casilla para validar esta versión del informe/);
});

test("V0.5.6 validación: la copia exige revisión y validación de la misma revisión", () => {
  assert.match(validationJs, /state\.validatedRevision === state\.revision/);
  assert.match(validationJs, /state\.reviewedRevision === state\.revision/);
  assert.match(validationJs, /!isEditing\(\)/);
});

test("V0.5.6 validación: index fuerza la carga del nuevo script", () => {
  assert.match(indexHtml, /report-validation-v058\.js\?v=20260909-1/);
  assert.doesNotMatch(indexHtml, /report-validation-v057\.js/);
});
