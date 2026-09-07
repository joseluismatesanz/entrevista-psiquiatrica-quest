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

function diagnosticFields(judgment) {
  return {
    diagnosis: String(judgment?.primary_diagnosis || "").trim(),
    cie10: String(judgment?.cie10_code || "").trim(),
    dsm5: String(judgment?.dsm5_code || "").trim(),
  };
}

function canonicalDiagnosticText(judgment) {
  const { diagnosis, cie10, dsm5 } = diagnosticFields(judgment);
  if (!diagnosis || !cie10 || !dsm5) return "";

  let text = `JUICIO CLÍNICO: ${diagnosis}. CIE-10: ${cie10}. DSM-5: ${dsm5}.`;
  const differential = Array.isArray(judgment?.differential)
    ? judgment.differential.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  if (differential.length) text += ` Diagnóstico diferencial: ${differential.join("; ")}.`;
  return text;
}

function sectionKinds(section, kinds) {
  return new Set((section?.source_ids || []).map((id) => kinds.get(id)).filter(Boolean));
}

function splitClinicalSentences(text) {
  return String(text || "")
    .match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
}

function retainExplicitProposalResponse(text) {
  const sentences = splitClinicalSentences(text);
  const proposalPattern = /\b(?:se\s+)?(?:prop(?:uso|one|uso|one)|propuest\w*|plante(?:ó|a)|ofreci(?:ó|a)|ofert(?:ó|a)|recomend(?:ó|a)|sugiri(?:ó|o))\b/i;
  const responsePattern = /\b(?:rechaz\w*|acept\w*|rehus\w*|se\s+niega\w*|neg(?:ó|o)\b|no\s+(?:quiso|quiere|voy|va|acepta)|consinti\w*)/i;
  const retained = [];

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    if (!proposalPattern.test(sentence)) continue;

    let chunk = sentence;
    let hasResponse = responsePattern.test(sentence);

    if (!hasResponse && index + 1 < sentences.length) {
      const next = sentences[index + 1];
      if (!proposalPattern.test(next) && responsePattern.test(next)) {
        chunk += ` ${next}`;
        hasResponse = true;
        index += 1;
      }
    }

    if (hasResponse) retained.push(chunk.trim());
  }

  return retained.join(" ").trim();
}

function isUnverifiedFamilyIdentityBeliefSentence(sentence) {
  const text = String(sentence || "").trim();
  if (!text) return false;

  const attributionPattern = /\b(?:refiere|afirma|dice|cree|piensa|sospecha|asegura|mantiene|considera|está\s+convencid[oa])\b/i;
  const disputedIdentityPattern = /\b(?:
    no\s+(?:es|son|sería|serían|eran)\s+(?:realmente|de\s+verdad)\b|
    no\s+(?:es|son|sería|serían|eran)\s+(?:mi|mis|su|sus)\s+(?:madre|padre|padres|progenitor(?:a|es)?|familia(?:res)?)\b|
    impostor(?:a|es)?\b|
    fals[oa]s?\s+(?:madre|padre|padres|familiares?)\b|
    suplantad[oa]s?\b|
    sustituid[oa]s?\b
  )/ix;
  const familyIdentityPattern = /\b(?:madre|padre|padres|progenitor(?:a|es)?|familia(?:res)?)\b/i;
  const strongPsychoticIdentityMarker = /\b(?:impostor(?:a|es)?|suplantad[oa]s?|sustituid[oa]s?)\b/i;

  return familyIdentityPattern.test(text)
    && disputedIdentityPattern.test(text)
    && (attributionPattern.test(text) || strongPsychoticIdentityMarker.test(text));
}

function pruneUnverifiedFamilyIdentityBeliefs(text) {
  const sentences = splitClinicalSentences(text);
  const retained = [];
  let pruned = false;

  for (const sentence of sentences) {
    if (isUnverifiedFamilyIdentityBeliefSentence(sentence)) {
      pruned = true;
      continue;
    }
    retained.push(sentence);
  }

  return { text: retained.join(" ").trim(), pruned };
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
  const familyKinds = sectionKinds(family, kinds);
  if (family.evidence_status === "supported" && [...familyKinds].some((kind) => kind !== "patient")) {
    warnings.push("family_history_non_patient_source_removed");
    clearSection(family);
    addMissing(
      assessment,
      "antecedentes_familiares_psiquiatricos",
      "Se retiró contenido porque no estaba sustentado exclusivamente por el paciente en la entrevista actual."
    );
  }

  // SITUACIÓN SOCIOFAMILIAR solo debe contener hechos de convivencia/relación/apoyo.
  // Una creencia de identidad/filiación no verificada se mantiene fuera de este apartado.
  const socio = assessment.sections.situacion_sociofamiliar;
  if (socio.evidence_status === "supported" && socio.text.trim()) {
    const originalSocio = socio.text.trim();
    const { text: retainedSocio, pruned } = pruneUnverifiedFamilyIdentityBeliefs(originalSocio);
    if (pruned) {
      warnings.push("sociofamily_unverified_identity_belief_pruned");
      if (retainedSocio) {
        socio.text = retainedSocio;
      } else {
        clearSection(socio, "insufficient");
      }
    }
  }

  // INTERVENCIÓN necesita al menos fuente psiquiatra y paciente y, además,
  // solo puede conservar propuesta clínica explícita + aceptación/rechazo.
  // Consentimientos, evolución, contención y procedimientos pertenecen a otros apartados.
  const intervention = assessment.sections.intervencion;
  if (intervention.evidence_status === "supported" && intervention.text.trim()) {
    const interventionKinds = sectionKinds(intervention, kinds);
    if (!interventionKinds.has("psychiatrist") || !interventionKinds.has("patient")) {
      warnings.push("intervention_without_explicit_proposal_response_removed");
      clearSection(intervention, "not_provided");
    } else {
      const originalIntervention = intervention.text.trim();
      const retainedIntervention = retainExplicitProposalResponse(originalIntervention);
      if (!retainedIntervention) {
        warnings.push("intervention_without_explicit_proposal_response_removed");
        clearSection(intervention, "not_provided");
      } else {
        intervention.text = retainedIntervention;
        if (retainedIntervention !== originalIntervention) {
          warnings.push("intervention_nonproposal_content_pruned");
        }
      }
    }
  } else {
    clearSection(intervention, "not_provided");
  }

  // Exploración psicopatológica: debe proceder del paciente y/o valoración clínica directa,
  // nunca quedar sustentada exclusivamente por familiares/EHR/policía.
  const mse = assessment.sections.exploracion_psicopatologica;
  if (mse.evidence_status === "supported" && mse.text.trim()) {
    const mseKinds = sectionKinds(mse, kinds);
    const directKinds = ["patient", "psychiatrist", "clinician_observation"];
    const hasDirectSource = directKinds.some((kind) => mseKinds.has(kind));
    if (!hasDirectSource) {
      warnings.push("mse_without_direct_assessment_source_removed");
      clearSection(mse, "insufficient");
      addMissing(
        assessment,
        "exploracion_psicopatologica",
        "Se retiró una exploración que no estaba sustentada por entrevista directa u observación clínica actual."
      );
    }
  }

  // Nunca inventar principio activo: si no se conoce, display_name = raw_name.
  for (const group of ["habitual", "current"]) {
    for (const med of assessment.medications?.[group] || []) {
      if (!med.active_ingredient_known) med.display_name = med.raw_name;
    }
  }

  // ORIENTACIÓN DIAGNÓSTICA tiene dos estados válidos:
  // 1) juicio sustentado: diagnóstico + CIE-10 + DSM-5 completos;
  // 2) evidencia insuficiente: los tres campos quedan vacíos y NO se fuerza una etiqueta diagnóstica.
  const diagnosticText = canonicalDiagnosticText(assessment.diagnostic_judgment);
  const fields = diagnosticFields(assessment.diagnostic_judgment);
  const presentCount = [fields.diagnosis, fields.cie10, fields.dsm5].filter(Boolean).length;

  if (diagnosticText) {
    assessment.sections.orientacion_diagnostica.text = diagnosticText;
    assessment.sections.orientacion_diagnostica.evidence_status = "supported";
  } else if (presentCount === 0) {
    warnings.push("diagnostic_judgment_withheld_for_insufficient_evidence");
    assessment.sections.orientacion_diagnostica.text =
      "Información insuficiente para establecer un juicio clínico diagnóstico con la entrevista disponible.";
    assessment.sections.orientacion_diagnostica.evidence_status = "insufficient";
    assessment.sections.orientacion_diagnostica.source_ids = [];
    addMissing(
      assessment,
      "orientacion_diagnostica",
      "Faltan datos clínicos suficientes para formular un diagnóstico principal y codificarlo en CIE-10 y DSM-5; no se fuerza una etiqueta diagnóstica."
    );
  } else {
    warnings.push("diagnostic_codes_incomplete");
    clearSection(assessment.sections.orientacion_diagnostica, "insufficient");
    addMissing(
      assessment,
      "orientacion_diagnostica",
      "Juicio clínico incompleto: no se renderiza un diagnóstico hasta disponer de diagnóstico principal, CIE-10 y DSM-5 coherentes."
    );
  }

  assessment.validation.is_draft = true;
  assessment.validation.clinician_validation_required = true;
  assessment.diagnostic_judgment.requires_clinician_validation = true;

  return { assessment, warnings };
}

export function collectClinicalInvariantViolations(assessment) {
  const violations = [];
  const motivo = assessment.sections?.motivo_consulta?.text?.trim() || "";
  if (/(^|[.!?]\s+)(la|el)\s+(paciente|madre|padre|hermano|hermana)\s+(refiere|explica|comenta|dice)/i.test(motivo)) {
    violations.push("motivo_is_narrative_instead_of_direct_clinical_formulation");
  }

  const psq = assessment.sections?.psq_guardia?.text?.trim();
  if (psq !== "MIR MAtesanz") violations.push("psq_guardia_not_exact");

  const socio = assessment.sections?.situacion_sociofamiliar?.text?.trim() || "";
  if (splitClinicalSentences(socio).some(isUnverifiedFamilyIdentityBeliefSentence)) {
    violations.push("sociofamily_contains_unverified_identity_belief");
  }

  const judgment = assessment.diagnostic_judgment || {};
  const fields = diagnosticFields(judgment);
  const presentCount = [fields.diagnosis, fields.cie10, fields.dsm5].filter(Boolean).length;

  // Los tres vacíos son válidos cuando la orientación queda explícitamente como insuficiente.
  if (presentCount > 0 && presentCount < 3) {
    if (!fields.diagnosis) violations.push("missing_primary_diagnosis");
    if (!fields.cie10) violations.push("missing_cie10_code");
    if (!fields.dsm5) violations.push("missing_dsm5_code");
  }
  if (presentCount === 3 && assessment.sections?.orientacion_diagnostica?.evidence_status !== "supported") {
    violations.push("diagnostic_judgment_not_rendered_as_supported");
  }

  if (assessment.validation?.is_draft !== true) violations.push("report_not_marked_draft");
  if (assessment.validation?.clinician_validation_required !== true) violations.push("clinician_validation_not_required");

  return violations;
}
