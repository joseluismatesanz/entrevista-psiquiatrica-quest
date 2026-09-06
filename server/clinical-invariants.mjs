function sourceKindMap(assessment) {
  return new Map((assessment.sources || []).map((s) => [s.id, s.kind]));
}

function addMissing(assessment, topic, note) {
  const exists = (assessment.missing_or_not_explored || []).some((x) => x.topic === topic && x.note === note);
  if (!exists) assessment.missing_or_not_explored.push({ topic, status: "insufficient", note });
}

function clearSection(section, status = "insufficient") {
  section.text = "";
  section.evidence_status = status;
  section.source_ids = [];
}

export function applyClinicalInvariants(input) {
  const assessment = structuredClone(input);
  const kinds = sourceKindMap(assessment);
  const warnings = [];

  assessment.sections.psq_guardia.text = "MIR MAtesanz";
  assessment.sections.psq_guardia.evidence_status = "supported";
  assessment.sections.psq_guardia.source_ids = [];

  // Familiares psiquiátricos: solo contenido aportado por el paciente.
  const family = assessment.sections.antecedentes_familiares_psiquiatricos;
  const familyKinds = (family.source_ids || []).map((id) => kinds.get(id)).filter(Boolean);
  if (family.evidence_status === "supported" && familyKinds.some((kind) => kind !== "patient")) {
    warnings.push("family_history_non_patient_source_removed");
    clearSection(family);
    addMissing(
      assessment,
      "antecedentes_familiares_psiquiatricos",
      "Se retiró contenido porque no estaba sustentado exclusivamente por el paciente en la entrevista actual."
    );
  }

  // INTERVENCIÓN necesita al menos fuente psiquiatra y paciente.
  const intervention = assessment.sections.intervencion;
  if (intervention.evidence_status === "supported" && intervention.text.trim()) {
    const interventionKinds = new Set((intervention.source_ids || []).map((id) => kinds.get(id)).filter(Boolean));
    if (!interventionKinds.has("psychiatrist") || !interventionKinds.has("patient")) {
      warnings.push("intervention_without_explicit_proposal_response_removed");
      clearSection(intervention, "not_provided");
    }
  } else {
    clearSection(intervention, "not_provided");
  }

  // Nunca inventar principio activo: si no se conoce, display_name = raw_name.
  for (const group of ["habitual", "current"]) {
    for (const med of assessment.medications?.[group] || []) {
      if (!med.active_ingredient_known) med.display_name = med.raw_name;
    }
  }

  assessment.validation.is_draft = true;
  assessment.validation.clinician_validation_required = true;
  assessment.diagnostic_judgment.requires_clinician_validation = true;

  return { assessment, warnings };
}

export function collectClinicalInvariantViolations(assessment) {
  const violations = [];
  const motivo = assessment.sections?.motivo_consulta?.text?.trim() || "";
  if (/^(la|el)\s+(paciente|madre|padre|hermano|hermana)\s+(refiere|explica|comenta|dice)/i.test(motivo)) {
    violations.push("motivo_is_narrative_instead_of_direct_clinical_formulation");
  }

  const psq = assessment.sections?.psq_guardia?.text?.trim();
  if (psq !== "MIR MAtesanz") violations.push("psq_guardia_not_exact");

  if (assessment.validation?.is_draft !== true) violations.push("report_not_marked_draft");
  if (assessment.validation?.clinician_validation_required !== true) violations.push("clinician_validation_not_required");

  return violations;
}
