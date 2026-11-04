function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function speakerLines(transcript) {
  return String(transcript || "")
    .split(/\n+/)
    .map((line) => {
      const match = line.match(/^\s*([A-ZÁÉÍÓÚÜÑ_/ ]+)\s*:\s*(.*)$/u);
      return match ? { speaker: match[1].toUpperCase(), text: match[2].trim() } : null;
    })
    .filter(Boolean);
}

const DIAGNOSIS_CATALOG = [
  {
    aliases: [/\banorexia\s+nerviosa\b/i],
    diagnosis: "Anorexia nerviosa",
    cie10: "F50.00",
    dsm5: "307.1",
  },
  {
    aliases: [/\btrastorno\s+de\s+ansiedad\s+generalizada\b/i, /\bansiedad\s+generalizada\b/i],
    diagnosis: "Trastorno de ansiedad generalizada",
    cie10: "F41.1",
    dsm5: "300.02",
  },
  {
    aliases: [/\btdah\b/i, /\btrastorno\s+por\s+deficit\s+de\s+atencion\s+e\s+hiperactividad\b/i],
    diagnosis: "Trastorno por déficit de atención e hiperactividad, presentación no especificada",
    cie10: "F90.9",
    dsm5: "314.01",
  },
  {
    aliases: [/\btrastorno\s+negativista\s+desafiante\b/i],
    diagnosis: "Trastorno negativista desafiante",
    cie10: "F91.3",
    dsm5: "313.81",
  },
];

const EXPLICIT_DIAGNOSIS_CONTEXT = /\b(?:diagnosticad[oa]\s+(?:de|con)|diagnosticos?\s+(?:previos?\s+)?de|juicio\s+clinico|seguimiento\s+(?:por|en)\b.{0,50}\bpor|padece|presenta|tiene)\b/i;
const NONCONFIRMING_DIAGNOSIS_CONTEXT = /\b(?:descartar|posible|sospecha|sospechoso|diagnostico\s+diferencial|diagnóstico\s+diferencial|valorar\s+si|no\s+(?:tiene|presenta|padece)|niega)\b/i;

function sourceKindFromSpeaker(speaker) {
  const value = normalize(speaker);
  if (value.includes("psiquiat")) return "psychiatrist";
  if (value.includes("madre")) return "mother";
  if (value.includes("padre")) return "father";
  if (value.includes("famil")) return "family";
  return "patient";
}

function sourceIdForLine(assessment, line) {
  const kind = sourceKindFromSpeaker(line?.speaker);
  return (assessment.sources || []).find((source) => source.kind === kind)?.id || "";
}

function explicitDiagnosisFromTranscript(assessment, transcript) {
  for (const line of speakerLines(transcript)) {
    const text = normalize(line.text);
    if (!EXPLICIT_DIAGNOSIS_CONTEXT.test(text) || NONCONFIRMING_DIAGNOSIS_CONTEXT.test(text)) continue;
    for (const entry of DIAGNOSIS_CATALOG) {
      if (!entry.aliases.some((pattern) => pattern.test(text))) continue;
      const inRemission = /\bremision\b/i.test(text);
      return {
        ...entry,
        diagnosis: inRemission ? `${entry.diagnosis}, en remisión` : entry.diagnosis,
        sourceId: sourceIdForLine(assessment, line),
      };
    }
  }
  return null;
}

function groundExplicitDiagnosis(assessment, transcript, warnings) {
  const explicit = explicitDiagnosisFromTranscript(assessment, transcript);
  if (!explicit) return;
  const judgment = assessment.diagnostic_judgment || (assessment.diagnostic_judgment = {});
  const existing = normalize(judgment.primary_diagnosis);
  const matchesExisting = !existing || explicit.aliases.some((pattern) => pattern.test(existing));
  if (!matchesExisting) return;

  judgment.primary_diagnosis = clean(judgment.primary_diagnosis) || explicit.diagnosis;
  judgment.cie10_code = clean(judgment.cie10_code) || explicit.cie10;
  judgment.dsm5_code = clean(judgment.dsm5_code) || explicit.dsm5;
  judgment.provisional = false;
  judgment.basis_summary = clean(judgment.basis_summary)
    || "Diagnóstico previamente establecido y expresamente indicado durante la entrevista.";
  judgment.requires_clinician_validation = true;

  const section = assessment.sections?.orientacion_diagnostica;
  if (section && explicit.sourceId) {
    section.source_ids = [...new Set([...(section.source_ids || []), explicit.sourceId])];
  }
  warnings.push(`explicit_diagnosis_recovered:${explicit.diagnosis}`);
}

function groundExplicitNegativeSubstanceUse(assessment, transcript, warnings) {
  const section = assessment.sections?.habitos_toxicos;
  if (!section || (section.evidence_status === "supported" && clean(section.text))) return;
  const found = new Set();
  const sourceIds = new Set();
  for (const line of speakerLines(transcript)) {
    const text = normalize(line.text);
    if (/\b(?:no\s+fumo|no\s+fuma|nieg\w*\s+(?:el\s+)?(?:consumo\s+de\s+)?tabaco)\b/i.test(text)) found.add("tabaco");
    if (/\b(?:no\s+bebo|no\s+bebe|no\s+consum\w*\s+alcohol|nieg\w*\s+(?:el\s+)?(?:consumo\s+de\s+)?alcohol)\b/i.test(text)) found.add("alcohol");
    if (/\b(?:no\s+consum\w*\s+(?:drogas|otras\s+sustancias|ninguna\s+(?:otra\s+)?sustancia)|nieg\w*\s+(?:el\s+)?consumo\s+de\s+(?:drogas|otras\s+sustancias))\b/i.test(text)) found.add("otras sustancias");
    const sourceId = sourceIdForLine(assessment, line);
    if (found.size && sourceId) sourceIds.add(sourceId);
  }
  if (!found.size) return;
  const values = [...found];
  const joined = values.length === 1 ? values[0] : `${values.slice(0, -1).join(", ")} y ${values.at(-1)}`;
  section.text = `Niega consumo de ${joined}.`;
  section.evidence_status = "supported";
  section.source_ids = [...sourceIds];
  warnings.push("explicit_negative_substance_use_recovered");
}

function groundMedicationChangeEncounter(assessment, transcript, warnings) {
  const lines = speakerLines(transcript);
  const explicitUpdateLine = lines.find((item) => {
    const text = normalize(item.text);
    return /\b(?:actualizacion|actualizar|revision|revisar)\b/i.test(text)
      && /\b(?:tratamiento|medicacion|farmacolog|psicofarmacolog)\b/i.test(text);
  });
  const line = explicitUpdateLine || lines.find((item) => {
    const text = normalize(item.text);
    return /\b(?:cambiar|cambio|modificar|modificacion|adaptar|adaptacion|ajustar|ajuste|revisar|actualizar|actualizacion)\b/i.test(text)
      && /\b(?:tratamiento|medicacion|farmacolog|psicofarmacolog)\b/i.test(text);
  });
  if (!line) return;
  const sourceId = sourceIdForLine(assessment, line);
  const motive = assessment.sections?.motivo_consulta;
  if (motive && (explicitUpdateLine || !(motive.evidence_status === "supported" && clean(motive.text)))) {
    motive.text = explicitUpdateLine
      ? "Actualización del tratamiento farmacológico."
      : "Valoración para modificación del tratamiento farmacológico.";
    motive.evidence_status = "supported";
    motive.source_ids = sourceId ? [sourceId] : [];
    warnings.push(explicitUpdateLine
      ? "medication_update_motive_canonicalized"
      : "medication_change_motive_recovered");
  }
  const current = assessment.sections?.enfermedad_actual;
  if (current && !(current.evidence_status === "supported" && clean(current.text))) {
    current.text = "Acude para valorar una modificación del tratamiento farmacológico.";
    current.evidence_status = "supported";
    current.source_ids = sourceId ? [sourceId] : [];
    warnings.push("medication_change_current_illness_recovered");
  }
}

export function groundExplicitClinicalFacts(inputAssessment, transcript) {
  const assessment = structuredClone(inputAssessment);
  const warnings = [];
  groundExplicitDiagnosis(assessment, transcript, warnings);
  groundExplicitNegativeSubstanceUse(assessment, transcript, warnings);
  groundMedicationChangeEncounter(assessment, transcript, warnings);
  return { assessment, warnings };
}
