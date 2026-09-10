import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSON_NAME_MASK,
  redactPersonNamesInSegments,
  redactPersonNamesInTranscript,
} from "../server/person-name-redaction.mjs";

function mockClient(items) {
  return {
    responses: {
      async parse(params) {
        assert.equal(params.store, false);
        assert.equal(params.background, false);
        assert.equal(params.reasoning.effort, "none");
        assert.match(params.instructions, /XXXXXXXXXXX/);
        return {
          status: "completed",
          output_parsed: { items },
        };
      },
    },
  };
}

test("V0.5.6 privacidad: sustituye nombres y apellidos de personas por XXXXXXXXXXX sin borrar información clínica", async () => {
  const result = await redactPersonNamesInSegments([
    { id: "s1", speaker: "A", text: "Me llamo María José López y vivo en Badajoz." },
    { id: "s2", speaker: "B", text: "La Dra. García me indicó sertralina 50 mg." },
    { id: "s3", speaker: "B", text: "Mi madre Ana refiere que duermo peor." },
  ], {
    client: mockClient([
      { segment_id: "s1", redacted_text: "Me llamo XXXXXXXXXXX y vivo en Badajoz.", replacements: 1, residual_person_name: false },
      { segment_id: "s2", redacted_text: "La Dra. XXXXXXXXXXX me indicó sertralina 50 mg.", replacements: 1, residual_person_name: false },
      { segment_id: "s3", redacted_text: "Mi madre XXXXXXXXXXX refiere que duermo peor.", replacements: 1, residual_person_name: false },
    ]),
  });

  assert.equal(PERSON_NAME_MASK, "XXXXXXXXXXX");
  assert.equal(result.replacements, 3);
  assert.doesNotMatch(result.transcript, /María|López|García|Ana/);
  assert.match(result.transcript, /XXXXXXXXXXX/);
  assert.match(result.transcript, /Badajoz/);
  assert.match(result.transcript, /sertralina 50 mg/);
  assert.equal(result.meta.store, false);
  assert.equal(result.meta.fail_closed, true);
});

test("V0.5.6 privacidad: falla cerrado si la verificación indica que queda un nombre personal", async () => {
  await assert.rejects(
    () => redactPersonNamesInSegments([
      { id: "s1", speaker: "A", text: "Mi hermano se llama Pedro." },
    ], {
      client: mockClient([
        { segment_id: "s1", redacted_text: "Mi hermano se llama Pedro.", replacements: 0, residual_person_name: true },
      ]),
    }),
    /No se pudo verificar la eliminación de nombres personales/
  );
});

test("V0.5.6 privacidad: también desidentifica texto pegado antes de generar documentos y conserva máscaras previas", async () => {
  const input = `PSIQUIATRA: ¿Cómo te llamas?\nPACIENTE: Soy Lucía Martín. Mi madre es ${PERSON_NAME_MASK}.`;
  const result = await redactPersonNamesInTranscript(input, {
    client: mockClient([
      { segment_id: "line-1", redacted_text: "PSIQUIATRA: ¿Cómo te llamas?", replacements: 0, residual_person_name: false },
      { segment_id: "line-2", redacted_text: `PACIENTE: Soy ${PERSON_NAME_MASK}. Mi madre es ${PERSON_NAME_MASK}.`, replacements: 1, residual_person_name: false },
    ]),
  });

  assert.doesNotMatch(result.transcript, /Lucía|Martín/);
  assert.equal((result.transcript.match(/XXXXXXXXXXX/g) || []).length, 2);
  assert.equal(result.replacements, 1);
});
