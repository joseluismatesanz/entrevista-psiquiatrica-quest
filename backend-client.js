(() => {
  const baseUrl = String(window.CLINICAL_API_URL || "").replace(/\/+$/, "");
  if (!baseUrl) return;

  const backendState = { result: null };
  const $ = (id) => document.getElementById(id);

  const SECTION_TITLES = {
    motivo_consulta: "MOTIVO DE LA CONSULTA",
    psq_guardia: "PSQ GUARDIA",
    alergias_ram: "ALERGIAS / RAM",
    antecedentes_somaticos: "ANTECEDENTES PERSONALES SOMÁTICOS",
    antecedentes_salud_mental: "ANTECEDENTES PERSONALES EN SALUD MENTAL",
    antecedentes_familiares_psiquiatricos: "ANTECEDENTES FAMILIARES PSIQUIÁTRICOS",
    situacion_sociofamiliar: "SITUACIÓN SOCIOFAMILIAR",
    habitos_toxicos: "HÁBITOS TÓXICOS",
    tratamiento_habitual: "TRATAMIENTO HABITUAL",
    enfermedad_actual: "ENFERMEDAD ACTUAL",
    intervencion: "INTERVENCIÓN",
    exploracion_psicopatologica: "EXPLORACIÓN PSICOPATOLÓGICA",
    orientacion_diagnostica: "ORIENTACIÓN DIAGNÓSTICA",
    plan_terapeutico: "PLAN TERAPÉUTICO",
    tratamiento_actual: "TRATAMIENTO ACTUAL",
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[c]);
  }

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach((x) => x.classList.remove("active"));
    const screen = $(`screen-${name}`);
    if (screen) screen.classList.add("active");
    document.querySelectorAll(".step").forEach((x) => x.classList.toggle("active", x.dataset.step === name));
    if (name === "report" && backendState.result) {
      $("reportEditor").textContent = backendState.result.report;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderReview(result) {
    const assessment = result.assessment;

    $("routingGrid").innerHTML = Object.entries(SECTION_TITLES)
      .filter(([key]) => !(key === "intervencion" &&
        assessment.sections[key]?.evidence_status !== "supported"))
      .map(([key, title]) => {
        const section = assessment.sections[key] || {};
        const text = section.text?.trim() || "Sin información suficiente.";
        return `<article class="route-card ${section.evidence_status === "supported" ? "active" : ""}">
          <div class="route-title">${escapeHtml(title)}</div>
          <p>${escapeHtml(text)}</p>
          <small>${escapeHtml(section.evidence_status || "not_provided")}</small>
        </article>`;
      }).join("");

    $("sourcesList").innerHTML = (assessment.sources || [])
      .map((source) => `<span class="tag">${escapeHtml(source.label)} · ${escapeHtml(source.kind)}</span>`)
      .join("") || '<span class="tag">Sin fuentes identificadas</span>';

    $("missingList").innerHTML = (assessment.missing_or_not_explored || [])
      .map((item) => `<li><b>${escapeHtml(item.topic)}</b>: ${escapeHtml(item.note)}</li>`)
      .join("") || "<li>Sin datos pendientes señalados.</li>";

    $("conflictList").innerHTML = (assessment.conflicts || [])
      .map((conflict) => {
        const accounts = (conflict.accounts || [])
          .map((a) => escapeHtml(a.statement)).join(" / ");
        return `<li><b>${escapeHtml(conflict.topic)}</b>: ${accounts}</li>`;
      }).join("") || "<li>Sin discrepancias detectadas.</li>";

    $("alertList").innerHTML = (assessment.safety_review || [])
      .map((item) => `<li><b>${escapeHtml(item.topic)}</b>: ${escapeHtml(item.evidence)}</li>`)
      .join("") || "<li>Sin alertas estructuradas.</li>";

    $("reportEditor").textContent = result.report;
  }

  async function analyzeWithBackend(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const transcript = $("caseText").value.trim();
    if (!transcript) {
      alert("Pega primero una entrevista.");
      return;
    }

    const button = $("analyzeCase");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Analizando con Structured Outputs…";

    try {
      const response = await fetch(`${baseUrl}/api/analyze`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || `Error del backend (${response.status})`);
      }

      backendState.result = payload;
      renderReview(payload);
      showScreen("review");
    } catch (error) {
      console.error("Backend analysis failed without logging transcript.", error);
      alert(`No se pudo completar el análisis: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  const engineBanner = document.createElement("section");
  engineBanner.className = "privacy-banner";
  engineBanner.innerHTML =
    "<strong>Motor V0.4</strong><span>Structured Outputs activado · API key protegida en servidor · borrador sujeto a validación clínica.</span>";
  const privacyBanner = document.querySelector(".privacy-banner");
  privacyBanner?.insertAdjacentElement("afterend", engineBanner);

  $("analyzeCase")?.addEventListener("click", analyzeWithBackend, true);

  document.querySelectorAll("[data-go], .step[data-step]").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (!backendState.result) return;
      const target = button.dataset.go || button.dataset.step;
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showScreen(target);
    }, true);
  });

  $("destroySession")?.addEventListener("click", () => {
    backendState.result = null;
  }, true);
  $("destroyInput")?.addEventListener("click", () => {
    backendState.result = null;
  }, true);
})();
