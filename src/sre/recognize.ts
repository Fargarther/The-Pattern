// Top-level dispatcher. Cascade:
//   1. Rule-based geometric recognizers (deterministic, fast)
//   2. $Q template matching (Phase 2 fallback for iconic glyphs)
//
// Rule-based is preferred because it's:
//   - Deterministic (same input → same output)
//   - Debuggable (each gate is named)
//   - Independent of template-data quality
//
// $Q runs when rules don't match because:
//   - Iconic glyphs (heart, star, key, anchor, etc.) don't have clean
//     geometric definitions
//   - Templates encode "what these shapes look like" via examples
//
// We DON'T run $Q first because templates are noisier than rules — a
// triangle would otherwise match against any vaguely triangular template
// in the library at moderate confidence.

import { extractFeatures } from './features.js';
import { recognizeQ, qScale, type QMatch } from './qdollar.js';
import { RECOGNIZERS } from './recognizers.js';
import { getQTemplates } from './templates.js';
import type {
  NormalizedStroke,
  RecognitionResult,
  ShapeFeatures,
  ShapeName,
} from './types.js';
import { SRE_TUNING } from './types.js';

/** Minimum $Q confidence to accept a template match in the cascade fallback.
 * Templates are synthetic right now so we set this conservatively — we'd
 * rather return null than pick the wrong glyph. */
const Q_CONFIDENCE_THRESHOLD = 0.45;

export interface RecognizeContext {
  /** Optional override for the resampled cloud the recognizer should pass
   * to $Q. Pass this when you have access to the preprocessed stroke
   * (most callers do). When omitted, $Q falls back to the cloud
   * reconstructed from features (less ideal — feature extraction has
   * already centred and resampled, so we use that). */
  cloud?: ReadonlyArray<{ x: number; y: number }>;
}

export function recognize(
  strokeOrFeatures: NormalizedStroke | ShapeFeatures,
  context: RecognizeContext = {},
): RecognitionResult {
  const features: ShapeFeatures =
    'points' in strokeOrFeatures ? extractFeatures(strokeOrFeatures) : strokeOrFeatures;
  const cloud =
    context.cloud ??
    ('points' in strokeOrFeatures ? strokeOrFeatures.points : null);

  // ===== Rule-based pass =====
  const ruleMatches: Array<{ shape: ShapeName; confidence: number }> = RECOGNIZERS.map((r) => ({
    shape: r.name,
    confidence: r.match(features),
  }))
    .filter((m) => m.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  if (
    ruleMatches.length > 0 &&
    ruleMatches[0]!.confidence >= SRE_TUNING.CONFIDENCE_THRESHOLD
  ) {
    return {
      shape: ruleMatches[0]!.shape,
      confidence: ruleMatches[0]!.confidence,
      features,
      alternativeMatches: ruleMatches.slice(1, 4),
    };
  }

  // ===== $Q fallback for iconic glyphs =====
  // Only runs when rule-based recognition didn't claim the shape with
  // sufficient confidence. The cloud must be available; if we only got
  // ShapeFeatures (no original stroke), there's nothing to template-match.
  let qMatch: QMatch | null = null;
  if (cloud && cloud.length >= 8) {
    qMatch = recognizeQ(cloud, getQTemplates());
  }

  if (qMatch && qMatch.confidence >= Q_CONFIDENCE_THRESHOLD) {
    const altMatches = ruleMatches.slice(0, 3);
    return {
      shape: qMatch.template.name as ShapeName,
      confidence: qMatch.confidence,
      features,
      alternativeMatches: altMatches,
    };
  }

  // Nothing fired with enough confidence
  return {
    shape: null,
    confidence: ruleMatches[0]?.confidence ?? qMatch?.confidence ?? 0,
    features,
    alternativeMatches: ruleMatches.slice(0, 3),
  };
}

// Re-export qScale so the canvas UI can preview what $Q sees if needed.
export { qScale };
