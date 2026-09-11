import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { redactAndAttributeSegments } from "../server/privacy-attribution.mjs";
import {
  createPrivacyProof,
  verifyPrivacyProof,
  LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
} from "../server/privacy-proof.mjs";
import {
  createClinicalEvidenceProof,
  verifyClinicalEvidenceProof,
} from "../server/clinical-evidence-proof.mjs";
import { filterClinicalBlockTranscript } from "../server/clinical-block-filter.mjs";
import { verifyLongInterviewBlocks, verifyLongInterviewEvidence } from "../api/analyze.mjs";

const env = { PRIVACY_PROOF_SECRET: "long-interview-test-secret" };
const now = 1_800_000_000_000;

function combinedClient(items) {
  return {
    responses: {
      async parse(params) {
        assert.equal(params.store, false);
        assert.equal(params.background, false);
        assert.equal(params.reasoning.effort, "none");
        return {
          status: "completed",
          output_parsed: { items },
          _request_id: "req_long_interview_test",
        };
      },
    },
  };
}

test("V0.6: MADRE explícita prevalece también en la ruta combinada de privacidad + atribución", async () => {
  const segments = [
    { id: "s1", speaker: "A", text: "Y usted, ¿es su madre? ¿Qué piensa de cómo está estos días?" },
    { id: "s2", speaker: "B", text: "Está siempre muy agobiada y desde hace una semana duerme peor." },
  ];
  const result = await redactAndAttributeSegments(segments, {
    client: combinedClient([
      { segment_id: "s1", redacted_text: segments[0].text, replacements: 0, residual_person_name: false, role: "psychiatrist", confidence: "high" },
      { segment_id: "s2", redacted_text: segments[1].text, replacements: 0, residual_person_name: false, role: "caregiver", confidence: "high" },
    ]),
  });
  assert.match(result.transcript, /^MADRE: Está siempre muy agobiada/m);
  assert.doesNotMatch(result.transcript, /^CUIDADOR\/A:/m);
  assert.equal(result.segments[1].role, "mother");
  assert.equal(result.meta.explicit_family_role_anchors, 1);
});

test("V0.6: el contexto previo desidentificado se usa solo como referencia y no forma parte de la salida", async () => {
  const prior = "MADRE: Desde ayer está peor y duerme poco.";
  const segment = { id: "s1", speaker: "A", text: "Además hoy no ha querido ir a clase." };
  let prompt = "";
  const client = {
    responses: {
      async parse(params) {
        prompt = params.input[0].content[0].text;
        return {
          status: "completed",
          output_parsed: { items: [{ segment_id: "s1", redacted_text: segment.text, replacements: 0, residual_person_name: false, role: "mother", confidence: "high" }] },
        };
      },
    },
  };
  const result = await redactAndAttributeSegments([segment], { client, previousSafeContext: prior });
  assert.match(prompt, /CONTEXTO PREVIO DESIDENTIFICADO/);
  assert.equal(result.transcript, `MADRE: ${segment.text}`);
  assert.doesNotMatch(result.transcript, /Desde ayer está peor/);
});

test("V0.6: una prueba de bloque sobrevive una entrevista de 30 minutos pero no más allá del margen largo", () => {
  const transcript = "PACIENTE: Soy XXXXXXXXXXX y desde hace una semana duermo mal.";
  const token = createPrivacyProof(transcript, {
    env, now,
    ttlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
    maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS,
  });
  const after31Minutes = now + 31 * 60 * 1000;
  assert.equal(verifyPrivacyProof(transcript, token, { env, now: after31Minutes, maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS }), true);
  assert.equal(verifyPrivacyProof(transcript, token, { env, now: after31Minutes }), false);
  assert.equal(verifyPrivacyProof(transcript, token, { env, now: now + 46 * 60 * 1000, maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS }), false);
});

test("V0.6: analyze solo acepta el atajo si TODOS los bloques firmados forman exactamente la transcripción visible", () => {
  const block1 = "PSIQUIATRA: Buenos días.\nPACIENTE: Me llamo XXXXXXXXXXX.";
  const block2 = "MADRE: Soy la madre y desde ayer la noto peor.";
  const proofOptions = { env, now, ttlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS, maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS };
  const blocks = [
    { block_index: 1, transcript: block1, privacy_proof: createPrivacyProof(block1, proofOptions) },
    { block_index: 2, transcript: block2, privacy_proof: createPrivacyProof(block2, proofOptions) },
  ];
  const joined = `${block1}\n${block2}`;
  assert.equal(verifyLongInterviewBlocks(joined, blocks, { env, now: now + 20 * 60 * 1000 }).verified, true);
  assert.equal(verifyLongInterviewBlocks(`${joined}\nPACIENTE: texto añadido`, blocks, { env, now: now + 20 * 60 * 1000 }).verified, false);
});

test("V0.6: evidencia incremental se firma contra su bloque exacto y no puede trasplantarse", () => {
  const source = "PSIQUIATRA: ¿Duermes bien?\nPACIENTE: Duermo cuatro horas.";
  const evidence = "PACIENTE: Duermo cuatro horas.";
  const token = createClinicalEvidenceProof(3, source, evidence, { env, now });
  assert.equal(verifyClinicalEvidenceProof(3, source, evidence, token, { env, now: now + 1000 }), true);
  assert.equal(verifyClinicalEvidenceProof(4, source, evidence, token, { env, now: now + 1000 }), false);
  assert.equal(verifyClinicalEvidenceProof(3, `${source} CAMBIO`, evidence, token, { env, now: now + 1000 }), false);
});

test("V0.6: evidence bundle solo se usa cuando todos los bloques tienen evidencia firmada coherente", () => {
  const source1 = "PSIQUIATRA: Buenos días.\nPACIENTE: Duermo mal.";
  const source2 = "MADRE: Desde hace una semana está más irritable.";
  const proofOptions = { env, now, ttlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS, maxTtlMs: LONG_INTERVIEW_PRIVACY_PROOF_TTL_MS };
  const rawBlocks = [
    { block_index: 1, transcript: source1, privacy_proof: createPrivacyProof(source1, proofOptions) },
    { block_index: 2, transcript: source2, privacy_proof: createPrivacyProof(source2, proofOptions) },
  ];
  const joined = `${source1}\n${source2}`;
  const verifiedBlocks = verifyLongInterviewBlocks(joined, rawBlocks, { env, now });
  const evidence = [
    { block_index: 1, clinical_transcript: "PACIENTE: Duermo mal.", evidence_proof: createClinicalEvidenceProof(1, source1, "PACIENTE: Duermo mal.", { env, now }) },
    { block_index: 2, clinical_transcript: source2, evidence_proof: createClinicalEvidenceProof(2, source2, source2, { env, now }) },
  ];
  const result = verifyLongInterviewEvidence(verifiedBlocks, evidence, { env, now });
  assert.equal(result.verified, true);
  assert.match(result.transcript, /Duermo mal/);
  assert.match(result.transcript, /más irritable/);
  assert.equal(verifyLongInterviewEvidence(verifiedBlocks, evidence.slice(0, 1), { env, now }).verified, false);
});

test("V0.6: filtro clínico conserva determinísticamente medicación y síntomas aunque el modelo quiera excluirlos", async () => {
  const transcript = [
    "PSIQUIATRA: Hola, buenas tardes.",
    "PACIENTE: Hola.",
    "PACIENTE: Duermo solo cuatro horas.",
    "PACIENTE: Tomo sertralina 50 mg por la mañana.",
  ].join("\n");
  const client = {
    responses: {
      async parse() {
        return { status: "completed", output_parsed: { keep_indices: [0] } };
      },
    },
  };
  const result = await filterClinicalBlockTranscript(transcript, { client });
  assert.match(result.clinical_transcript, /Duermo solo cuatro horas/);
  assert.match(result.clinical_transcript, /sertralina 50 mg/);
});

test("V0.6: arquitectura larga usa bloques de 20 s, concurrencia acotada y acelerador clínico firmado", async () => {
  const [longController, contextBridge, index, loader, vercel, health, pkg, analyzeApi, clinicalAnalyze] = await Promise.all([
    readFile(new URL("../long-interview-v06.js", import.meta.url), "utf8"),
    readFile(new URL("../long-interview-context-v06.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../loader.js", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../api/health.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../api/analyze.mjs", import.meta.url), "utf8"),
    readFile(new URL("../server/analyze.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(longController, /BLOCK_SECONDS = 20/);
  assert.match(longController, /MAX_CONCURRENT_BLOCKS = 2/);
  assert.match(longController, /pumpBlockQueue/);
  assert.match(longController, /\/api\/extract-block-evidence/);
  assert.match(longController, /verified_evidence/);
  assert.match(longController, /MAX_BUFFERED_BLOCKS/);
  assert.match(contextBridge, /safeBlocks\.get\(blockIndex - 1\)/);
  assert.match(index, /bloques de aproximadamente 20 segundos/);
  assert.match(index, /20260911-20s-2/);
  assert.match(loader, /transcribe\(\?:-block\)\?/);
  assert.match(vercel, /api\/extract-block-evidence\.mjs/);
  assert.match(health, /long_interview_blocks/);
  assert.match(pkg, /server\/clinical-block-filter\.mjs/);
  assert.match(pkg, /api\/extract-block-evidence\.mjs/);
  assert.match(analyzeApi, /verifyLongInterviewEvidence/);
  assert.match(analyzeApi, /modelTranscript: evidenceBundle\.transcript/);
  assert.match(clinicalAnalyze, /model_input_compacted/);
  assert.match(clinicalAnalyze, /applyClinicalPostprocessing\(assessment, transcript\)/);
});
