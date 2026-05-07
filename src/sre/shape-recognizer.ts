// Strategy-pattern interface for shape recognizers.
//
// This is the swap-out seam recommended by the recognition-engine-roadmap
// (§A.4). Wrapping our existing cascade behind a typed interface lets us
// A/B alternative recognizers (Penny Pincher, Jackknife, !FTL, a hybrid
// $Q+CNN, etc.) without touching the UI or the composite parser.
//
// The current implementation, `CascadeShapeRecognizer`, is the production
// one. It runs the existing rule-based-then-$Q cascade in `recognize()`.
// Future alternative implementations live alongside it; the rest of the
// app talks only to the `ShapeRecognizer` interface.

import { preprocessStrokes } from './preprocessing.js';
import { recognize, type RecognizeContext } from './recognize.js';
import { setRuntimeTemplates } from './templates.js';
import type { QTemplate } from './qdollar.js';
import type { RecognitionResult, Stroke } from './types.js';

export interface RecognizeOptions {
  /** Reserved for future use. Our `RecognitionResult` already returns all
   *  scored alternatives via `alternativeMatches`; callers that want a
   *  bounded list slice it themselves. Kept on the interface so future
   *  implementations (e.g., topK-aware $Q variants) can honor it. */
  topK?: number;
}

/** A recognizer takes raw strokes and returns a single `RecognitionResult`
 *  for one shape. Composite parsing (multiple shapes in one gesture) lives
 *  one layer up, in `composite.ts`, and calls a recognizer per group. */
export interface ShapeRecognizer {
  /** Stable identifier for telemetry and benchmarking, e.g. `cascade-rule-q`,
   *  `dollar-q`, `penny-pincher`. */
  readonly id: string;
  /** Recognizer engine version (semver). Bump major if the public behaviour
   *  changes in a way that invalidates previously-saved confidence scores. */
  readonly version: string;
  /** Replace the runtime template library used by template-matching
   *  components of the cascade. Synchronous to keep init deterministic. */
  loadTemplates(templates: readonly QTemplate[]): void;
  /** Run the full pipeline (preprocess → features → cascade) on raw strokes
   *  and return the best match. Implementations must NEVER throw — degenerate
   *  input returns a low-confidence "unrecognized" result. */
  recognize(strokes: readonly Stroke[], opts?: RecognizeOptions): RecognitionResult;
}

/** Minimum-points guard that all recognizer implementations should apply
 *  before doing real work. Mirrors §G.5 false-positive prevention from the
 *  roadmap, but without the canvas-px gates (those belong in the UI layer
 *  where canvas dimensions are known). */
function isDegenerate(strokes: readonly Stroke[]): boolean {
  if (strokes.length === 0) return true;
  let total = 0;
  for (const s of strokes) total += s.points.length;
  return total < 2;
}

function unrecognizedResult(): RecognitionResult {
  return {
    shape: null,
    confidence: 0,
    features: {
      cornerCount: 0,
      cornerAngles: [],
      cornerSignedAngles: [],
      cornerIndices: [],
      cornerPoints: [],
      sideVectors: [],
      cornerTurnRatio: 0,
      totalAbsoluteAngle: 0,
      totalSignedAngle: 0,
      closureDistance: 0,
      isClosed: false,
      bboxWidth: 0,
      bboxHeight: 0,
      bboxAspectRatio: 0,
      bboxDiagonal: 0,
      sideLengths: [],
      sideLengthMean: 0,
      sideLengthStdev: 0,
      sideLengthCV: 0,
      dcr: 0,
      horizontalSymmetry: 0,
      verticalSymmetry: 0,
      rotationalSymmetry4: 0,
    },
    alternativeMatches: [],
  };
}

/** Production recognizer: runs the rule-based-then-$Q cascade currently
 *  exported by `recognize.ts`. */
export class CascadeShapeRecognizer implements ShapeRecognizer {
  readonly id = 'cascade-rule-q';
  readonly version = '1.0.0';

  loadTemplates(templates: readonly QTemplate[]): void {
    setRuntimeTemplates([...templates]);
  }

  recognize(strokes: readonly Stroke[], _opts: RecognizeOptions = {}): RecognitionResult {
    if (isDegenerate(strokes)) return unrecognizedResult();
    const norm = preprocessStrokes(strokes);
    const ctx: RecognizeContext = { cloud: norm.points };
    return recognize(norm, ctx);
  }
}
