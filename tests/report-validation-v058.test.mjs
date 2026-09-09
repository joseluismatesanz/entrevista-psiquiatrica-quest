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
  assert.match(validationJs, /He revisado los cambios/);
  assert.match(validationJs, /hasUnreviewedChanges/);
  assert.match(validationJs, /check\.disabled = editing \|\| pendingReview/);
});

test("V0.5.6 validación: el bloqueo de la casilla se explica de forma visible", () => {
  assert.match(validationJs, /Validación bloqueada hasta confirmar que has revisado los cambios/);
  assert.match(validationJs, /Finaliza la edición para poder validar el informe/);
  assert.match(validationJs, /function setValidationLabel/);
});

test("V0.5.6 validación: confirmar cambios no valida; solo vuelve a habilitar la casilla", () => {
  assert.match(validationJs, /function markChangesReviewed/);
  assert.match(validationJs, /state\.reviewedRevision = state\.revision/);
  assert.match(validationJs, /state\.validatedRevision = null/);
  assert.match(validationJs, /Cambios revisados; falta la validación clínica/);
});

test("V0.5.6 validación: la copia exige revisión y validación de la misma revisión", () => {
  assert.match(validationJs, /state\.validatedRevision === state\.revision/);
  assert.match(validationJs, /state\.reviewedRevision === state\.revision/);
  assert.match(validationJs, /!isEditing\(\)/);
});

test("V0.5.6 validación: index fuerza la carga de esta revisión del script", () => {
  assert.match(indexHtml, /report-validation-v058\.js\?v=20260909-2/);
  assert.doesNotMatch(indexHtml, /report-validation-v057\.js/);
});
