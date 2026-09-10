import { redactPersonNamesInSegments, PERSON_NAME_MASK } from "./person-name-redaction.mjs";
import { attributeClinicalSpeakerRoles, deduplicateClearAdjacentOverlaps } from "./speaker-attribution.mjs";

export async function redactAndAttributeSegmentsParallel(inputSegments, options = {}) {
  const deduplication = deduplicateClearAdjacentOverlaps(inputSegments);
  const segments = deduplication.segments;
  if (!segments.length) throw new TypeError("No hay segmentos para procesar.");

  let redactionMs = 0;
  let attributionMs = 0;
  const totalStartedAt = Date.now();

  const redactionPromise = (async () => {
    const startedAt = Date.now();
    const result = await redactPersonNamesInSegments(segments, options.redactionOptions || {});
    redactionMs = Date.now() - startedAt;
    return result;
  })();

  const attributionPromise = (async () => {
    const startedAt = Date.now();
    const result = await attributeClinicalSpeakerRoles(segments, options.attributionOptions || {});
    attributionMs = Date.now() - startedAt;
    return result;
  })();

  // Promise.all es intencional: ambas tareas parten de la misma transcripción acústica
  // y son independientes. La salida nominal de atribución nunca se expone; solo sus
  // etiquetas se fusionan con el texto que ya superó la redacción fail-closed.
  const [redaction, attribution] = await Promise.all([redactionPromise, attributionPromise]);
  const attributionById = new Map((attribution.segments || []).map((segment) => [String(segment.id), segment]));

  const mergedSegments = redaction.segments.map((redacted) => {
    const attributed = attributionById.get(String(redacted.id));
    if (!attributed) throw new Error("La atribución de interlocutores no devolvió todos los segmentos.");
    return {
      ...redacted,
      acoustic_speaker: attributed.acoustic_speaker || redacted.speaker,
      role: attributed.role,
      role_label: attributed.role_label,
      role_display: attributed.role_display,
      role_confidence: attributed.role_confidence,
      source_sensitive: attributed.source_sensitive,
      review_required: attributed.review_required,
    };
  });

  const reviewItems = mergedSegments
    .filter((segment) => segment.review_required)
    .map((segment) => ({
      segment_id: segment.id,
      text: segment.text,
      suggested_role: segment.role,
      confidence: segment.role_confidence,
      acoustic_speaker: segment.acoustic_speaker,
    }));

  return {
    transcript: mergedSegments.map((segment) => `${segment.role_label}: ${segment.text}`).join("\n"),
    segments: mergedSegments,
    participants: attribution.participants || [],
    review_items: reviewItems,
    replacements: redaction.replacements,
    meta: {
      model: `${redaction.meta.model}+${attribution.meta.role_model}`,
      transport: attribution.meta.role_transport || redaction.meta.transport,
      store: false,
      mask: PERSON_NAME_MASK,
      fail_closed: true,
      automatic_role_attribution: true,
      critical_review_count: reviewItems.length,
      deduplicated_overlap_segments: deduplication.removed,
      parallel_privacy_attribution: true,
      redaction_ms: redactionMs,
      speaker_attribution_ms: attributionMs,
      parallel_total_ms: Date.now() - totalStartedAt,
    },
  };
}
