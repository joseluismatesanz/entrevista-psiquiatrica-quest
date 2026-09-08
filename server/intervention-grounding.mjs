function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text) {
  return String(text || "")
    .match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
}

function parseTranscript(transcript) {
  return String(transcript || "")
    .split(/\n+/)
    .map((line) => {
      const match = line.match(/^\s*([A-ZÁÉÍÓÚÜÑ ]+)\s*:\s*(.+)$/i);
      if (!match) return null;
      return {
        speaker: normalize(match[1]),
        text: match[2].trim(),
      };
    })
    .filter(Boolean);
}

const PROPOSAL_VERB_PATTERN = /\b(?:propongo|proponemos|propone|planteo|planteamos|plantea|recomiendo|recomendamos|recomienda|sugiero|sugerimos|sugiere|ofrezco|ofrecemos|ofrece)\b/i;
const ACCEPT_PATTERN = /\b(?:acepto|acepta|aceptamos|de\s+acuerdo|conforme|estoy\s+de\s+acuerdo|estamos\s+de\s+acuerdo|me\s+parece\s+bien|nos\s+parece\s+bien)\b/i;
const REJECT_PATTERN = /\b(?:rechazo|rechaza|rechazamos|no\s+acepto|no\s+acepta|no\s+aceptamos|me\s+niego|se\s+niega|no\s+quiero|no\s+quiere)\b/i;

function proposalSentenceFromLine(text) {
  const sentences = splitSentences(text);
  return sentences.find((sentence) => PROPOSAL_VERB_PATTERN.test(sentence)) || "";
}

function normalizeProposalSentence(sentence) {
  return String(sentence || "")
    .replace(/^\s*propongo\b/i, "Se propone")
    .replace(/^\s*proponemos\b/i, "Se propone")
    .replace(/^\s*planteo\b/i, "Se plantea")
    .replace(/^\s*planteamos\b/i, "Se plantea")
    .replace(/^\s*recomiendo\b/i, "Se recomienda")
    .replace(/^\s*recomendamos\b/i, "Se recomienda")
    .replace(/^\s*sugiero\b/i, "Se sugiere")
    .replace(/^\s*sugerimos\b/i, "Se sugiere")
    .replace(/^\s*ofrezco\b/i, "Se ofrece")
    .replace(/^\s*ofrecemos\b/i, "Se ofrece")
    .trim();
}

function sourceIdForKind(assessment, kinds) {
  const wanted = new Set(kinds);
  return (assessment.sources || []).find((source) => wanted.has(source.kind))?.id || "";
}

function responseSummary(speaker, text) {
  const rejected = REJECT_PATTERN.test(text);
  const accepted = !rejected && ACCEPT_PATTERN.test(text);
  if (!accepted && !rejected) return null;

  if (speaker === "paciente") {
    return {
      text: rejected ? "La paciente rechaza la propuesta." : "La paciente acepta la propuesta.",
      kinds: ["patient"],
      patient: true,
    };
  }
  if (speaker === "madre") {
    return {
      text: rejected ? "La madre rechaza la propuesta." : "La madre muestra conformidad.",
      kinds: ["mother", "family", "caregiver"],
      patient: false,
    };
  }
  if (speaker === "padre") {
    return {
      text: rejected ? "El padre rechaza la propuesta." : "El padre muestra conformidad.",
      kinds: ["father", "family", "caregiver"],
      patient: false,
    };
  }
  if (/^cuidador|^cuidadora/.test(speaker)) {
    return {
      text: rejected ? "La persona cuidadora rechaza la propuesta." : "La persona cuidadora muestra conformidad.",
      kinds: ["caregiver", "family"],
      patient: false,
    };
  }
  return null;
}

export function groundInterventionToTranscript(inputAssessment, transcript) {
  const assessment = structuredClone(inputAssessment);
  const warnings = [];
  const section = assessment.sections?.intervencion;
  if (!section) return { assessment, warnings, grounded: false };

  const lines = parseTranscript(transcript);
  let proposalIndex = -1;
  let proposal = "";

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].speaker !== "psiquiatra") continue;
    const candidate = proposalSentenceFromLine(lines[index].text);
    if (!candidate) continue;
    proposalIndex = index;
    proposal = normalizeProposalSentence(candidate);
    break;
  }

  if (!proposal || proposalIndex < 0) {
    return { assessment, warnings, grounded: false };
  }

  const responses = [];
  for (let index = proposalIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.speaker === "psiquiatra") break;
    const summary = responseSummary(line.speaker, line.text);
    if (summary) responses.push(summary);
  }

  const patientResponse = responses.find((item) => item.patient);
  if (!patientResponse) {
    return { assessment, warnings, grounded: false };
  }

  const sourceIds = [];
  const psychiatristId = sourceIdForKind(assessment, ["psychiatrist"]);
  if (psychiatristId) sourceIds.push(psychiatristId);

  for (const response of responses) {
    const id = sourceIdForKind(assessment, response.kinds);
    if (id && !sourceIds.includes(id)) sourceIds.push(id);
  }

  section.text = [proposal, ...responses.map((item) => item.text)].join(" ");
  section.evidence_status = "supported";
  section.source_ids = sourceIds;
  warnings.push("intervention_grounded_to_explicit_transcript_proposal_response");

  return { assessment, warnings, grounded: true };
}
