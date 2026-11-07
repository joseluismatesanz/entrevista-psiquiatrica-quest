function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function psychiatristLines(transcript) {
  return String(transcript || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /^PSIQUIATRA\s*:/i.test(line))
    .map((line) => line.replace(/^PSIQUIATRA\s*:\s*/i, "").trim());
}

export function explicitPsychiatristIdentityFromTranscript(transcript) {
  for (const speech of psychiatristLines(transcript)) {
    const titled = speech.match(
      /\b(?:soy|me\s+llamo)\s+(?:(?:la|el)\s+)?((?:Dra?\.?|Dr\.?|MIR)\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'’-]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'’-]+){0,2})/i
    );
    if (titled?.[1]) return titled[1].trim();

    const named = speech.match(
      /\bme\s+llamo\s+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'’-]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'’-]+){1,2})\b/
    );
    if (named?.[1]) return named[1].trim();
  }
  return "";
}

export function groundPsqGuardiaToTranscript(inputAssessment, transcript) {
  const assessment = structuredClone(inputAssessment);
  const warnings = [];
  const section = assessment.sections?.psq_guardia;
  if (!section) return { assessment, warnings };

  const identity = explicitPsychiatristIdentityFromTranscript(transcript);

  if (!identity) {
    if (clean(section.text) || section.evidence_status === "supported") {
      warnings.push("psq_guardia_unsupported_identity_removed");
    }
    section.text = "";
    section.evidence_status = "not_provided";
    section.source_ids = [];
    return { assessment, warnings };
  }

  section.text = identity;
  section.evidence_status = "supported";
  const psychiatristSource = (assessment.sources || []).find((source) => source.kind === "psychiatrist");
  section.source_ids = psychiatristSource ? [psychiatristSource.id] : [];

  return { assessment, warnings };
}
