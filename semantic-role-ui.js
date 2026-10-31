(() => {
  let latestPayload = null;
  let pendingCriticalReview = false;

  const ROLE_OPTIONS = [
    ["psychiatrist", "Psiquiatra"],
    ["patient", "Paciente"],
    ["mother", "Madre"],
    ["father", "Padre"],
    ["sibling", "Hermano/a"],
    ["caregiver", "Cuidador/a"],
    ["family", "Familiar"],
    ["nurse", "Enfermería"],
    ["police", "Policía"],
    ["security", "Seguridad"],
    ["other", "Otro"],
    ["unknown", "No identificado"],
  ];

  const ROLE_LABELS = {
    psychiatrist: "PSIQUIATRA",
    patient: "PACIENTE",
    mother: "MADRE",
    father: "PADRE",
    sibling: "HERMANO/A",
    caregiver: "CUIDADOR/A",
    family: "FAMILIAR",
    nurse: "ENFERMERÍA",
    police: "POLICÍA",
    security: "SEGURIDAD",
    other: "OTRO",
    unknown: "INTERLOCUTOR_NO_IDENTIFICADO",
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;",
    })[char]);
  }

  function roleOptions(selected = "unknown") {
    return ROLE_OPTIONS.map(([value, label]) =>
      `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`
    ).join("");
  }

  function participantSummary(payload) {
    const participants = Array.isArray(payload?.participants) ? payload.participants : [];
    if (!participants.length) return "No se han podido identificar interlocutores clínicos con suficiente seguridad.";
    return participants.map((item) => `<span class="tag">${escapeHtml(item.label)}</span>`).join("");
  }

  function renderAutomaticAttribution(payload) {
    const card = document.getElementById("speakerMappingCard");
    const fields = document.getElementById("speakerMappingFields");
    const message = document.getElementById("speakerMappingMessage");
    const applyButton = document.getElementById("applySpeakerMapping");
    if (!card || !fields || !message || !applyButton) return;

    if (payload?.attribution_error || !payload?.meta?.automatic_role_attribution) {
      pendingCriticalReview = true;
      message.textContent = "La transcripción está disponible, pero no se pudo atribuir automáticamente quién habla. No se organizará clínicamente hasta resolver la fuente.";
      return;
    }

    const reviewItems = Array.isArray(payload.review_items) ? payload.review_items : [];
    pendingCriticalReview = reviewItems.length > 0;

    let html = `<div style="display:grid;gap:8px;margin-bottom:12px">
      <div><b>Fuentes detectadas automáticamente</b></div>
      <div class="tag-list">${participantSummary(payload)}</div>
      <div class="muted small">La letra acústica A/B/C es solo una pista. El rol clínico se atribuye por el contenido y el contexto de la conversación.</div>
    </div>`;

    if (payload?.meta?.long_interview) {
      html += `<div class="analysis-principle" style="margin-bottom:10px"><b>Entrevista por bloques:</b> ${escapeHtml(payload.meta.block_count || 0)} bloques ya procesados y desidentificados. Las letras acústicas pueden reiniciarse entre bloques; aquí se revisan roles clínicos, no letras.</div>`;
    }

    if (reviewItems.length) {
      html += `<div style="border-top:1px solid #d8e5e7;padding-top:12px">
        <b>${reviewItems.length} intervención${reviewItems.length === 1 ? "" : "es"} clínicamente relevante${reviewItems.length === 1 ? "" : "s"} necesita${reviewItems.length === 1 ? "" : "n"} confirmar la fuente</b>
        <p class="muted small" style="margin:5px 0 10px">Solo se muestran las ambigüedades que pueden cambiar riesgo, medicación, antecedentes, diagnóstico o plan.</p>
      </div>`;
      html += reviewItems.map((item) => `<label class="speaker-row">
        <span><b>${escapeHtml(item.text)}</b><small>Voz acústica ${escapeHtml(item.acoustic_speaker)} · confianza ${escapeHtml(item.confidence)}</small></span>
        <select data-critical-segment="${escapeHtml(item.segment_id)}">${roleOptions(item.suggested_role)}</select>
      </label>`).join("");
      applyButton.hidden = false;
      applyButton.textContent = `Confirmar ${reviewItems.length} fuente${reviewItems.length === 1 ? "" : "s"} pendiente${reviewItems.length === 1 ? "" : "s"}`;
      message.textContent = "El resto de la entrevista ya está atribuido automáticamente.";
    } else {
      html += `<div class="analysis-principle"><b>Sin revisión manual necesaria.</b> No hay ambigüedades de fuente clínicamente relevantes detectadas.</div>`;
      applyButton.hidden = true;
      message.textContent = "Puedes revisar el texto y organizar la información clínica directamente.";
    }

    fields.innerHTML = html;
    card.classList.remove("hidden");
  }

  function rebuildTranscriptWithCorrections() {
    if (!latestPayload?.segments?.length) return;
    const corrections = new Map(
      [...document.querySelectorAll("select[data-critical-segment]")]
        .map((select) => [select.dataset.criticalSegment, select.value])
    );

    latestPayload.segments = latestPayload.segments.map((segment) => {
      const correction = corrections.get(String(segment.id));
      if (!correction) return segment;
      return {
        ...segment,
        role: correction,
        role_label: ROLE_LABELS[correction] || ROLE_LABELS.unknown,
        role_confidence: "human_confirmed",
        review_required: false,
      };
    });

    latestPayload.review_items = [];
    latestPayload.transcript = latestPayload.segments
      .map((segment) => `${segment.role_label || ROLE_LABELS[segment.role] || ROLE_LABELS.unknown}: ${segment.text}`)
      .join("\n");

    const area = document.getElementById("caseText");
    if (area) area.value = latestPayload.transcript;
    pendingCriticalReview = false;
    renderAutomaticAttribution(latestPayload);
  }

  function acceptPayload(payload) {
    latestPayload = payload;
    window.__CLINICAL_ROLE_ATTRIBUTION = payload;
    setTimeout(() => renderAutomaticAttribution(payload), 0);
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const target = args[0];
    const url = typeof target === "string" ? target : String(target?.url || "");

    if (/\/api\/transcribe(?:$|[?#])/i.test(url) && response.ok) {
      try {
        const payload = await response.clone().json();
        acceptPayload(payload);
      } catch {
        // La respuesta original sigue su curso; no se registra contenido clínico.
      }
    }
    return response;
  };

  // V0.6: los bloques individuales no se muestran en este panel. El controlador de
  // entrevista larga publica un único resultado agregado y ya desidentificado al finalizar.
  window.addEventListener("clinical-long-attribution-ready", (event) => {
    const payload = event?.detail;
    if (!payload || !payload.meta?.long_interview) return;
    acceptPayload(payload);
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("#applySpeakerMapping") : null;
    if (!target || !latestPayload?.meta?.automatic_role_attribution) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    rebuildTranscriptWithCorrections();
  }, true);

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("#analyzeCase") : null;
    if (!target || !pendingCriticalReview) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const message = document.getElementById("speakerMappingMessage");
    if (message) message.textContent = "Confirma primero únicamente las fuentes críticas señaladas arriba.";
    document.getElementById("speakerMappingCard")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, true);
})();
