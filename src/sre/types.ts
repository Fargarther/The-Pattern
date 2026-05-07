// Core types for the Semantic Recognition Engine (SRE).
// Spec: sre-phase1-geometric-recognizer-spec.md §1.

// ===== Input types =====

export type PointerType = 'pen' | 'touch' | 'mouse';

export interface RawPoint {
  x: number;
  y: number;
  t: number; // timestamp ms (epoch or perf-now; the SRE only uses deltas)
  pressure?: number;
  pointerType?: PointerType;
}

export interface Stroke {
  points: RawPoint[];
  startTime: number;
  endTime: number;
  pointerType: PointerType;
}

// ===== Normalized types (post-preprocessing) =====

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface NormalizedStroke {
  points: NormalizedPoint[]; // Resampled to N evenly-spaced points along arc length
  raw: RawPoint[]; // Preserved for fallback into $Q in Phase 2
}

// ===== Feature types (filled in Day 2) =====

export interface ShapeFeatures {
  cornerCount: number;
  cornerAngles: number[]; // Turning-angle MAGNITUDE at each detected corner, radians
  cornerSignedAngles: number[]; // Same indices, signed (positive = CCW). Used by
  // arrow / hourglass to detect mixed rotation direction (concave indents).
  cornerIndices: number[]; // Indices into the resampled point cloud (kept for UI overlay)
  cornerPoints: NormalizedPoint[]; // Actual point positions at detected corners
  // Unit vectors along each side (cornerPoint[i] → cornerPoint[(i+1) % N]).
  // Used by quadrilateral recognizers to test parallelism / perpendicularity.
  sideVectors: NormalizedPoint[];
  totalAbsoluteAngle: number;
  totalSignedAngle: number;
  // Sum of detected corner-angle magnitudes / totalAbsoluteAngle. ≈1.0 for a
  // pure polygon (all turn lives at corners); ≈0.3 for a smooth circle-with-
  // kinks (most turn is distributed across curved arcs). The cleanest single
  // discriminator between polygons and curves we have.
  cornerTurnRatio: number;
  closureDistance: number;
  isClosed: boolean;
  bboxWidth: number;
  bboxHeight: number;
  bboxAspectRatio: number;
  bboxDiagonal: number;
  sideLengths: number[];
  sideLengthMean: number;
  sideLengthStdev: number;
  sideLengthCV: number;
  dcr: number;
  horizontalSymmetry: number;
  verticalSymmetry: number;
  rotationalSymmetry4: number;
}

// ===== Recognition output =====

// Locked dictionary — every glyph earns its slot via game mechanic.
// Units (outer in composites): geometric base + class shapes
// Modifier sources (inner in composites): elemental + status sources
// Some shapes (arrow, plusSign, shield, tear, bolt) play both roles depending
// on nesting depth in the composite parser.
export type ShapeName =
  // Geometric units (polygons)
  | 'triangle' | 'circle' | 'square' | 'rectangle' | 'rhombus' | 'diamond' | 'trapezoid'
  | 'pentagon' | 'hexagon' | 'heptagon' | 'octagon' | 'nonagon' | 'decagon'
  // Symbol units / dual-role (also modifier sources)
  | 'plusSign' | 'arrow' | 'arrowDown' | 'bolt' | 'tear' | 'shield' | 'star' | 'boomerang'
  // Class units
  | 'shuriken' | 'flask' | 'eye' | 'hammer' | 'crown' | 'bell'
  // B-direction additions (v4.2 dictionary)
  | 'sword' | 'bow' | 'axe' | 'dagger' | 'fang' | 'claw' | 'wing'
  | 'scroll' | 'orb' | 'lantern' | 'gem' | 'boot' | 'helmet'
  // Modifier sources (inner-only)
  | 'flame' | 'wave' | 'feather' | 'snowflake' | 'crescent' | 'sun' | 'skull'
  | 'hourglass' | 'anchor' | 'heart' | 'spiral';

export interface RecognitionResult {
  shape: ShapeName | null; // null = below threshold / unrecognized
  confidence: number; // 0..1
  features: ShapeFeatures;
  alternativeMatches?: { shape: ShapeName | null; confidence: number }[];
}

// ===== Tuning constants =====
// Spec §7. Initial values; expect to tune against real player data.

export const SRE_TUNING = {
  RESAMPLE_POINTS: 64,

  ONE_EURO_PEN_MIN_CUTOFF: 0.5,
  ONE_EURO_PEN_BETA: 0.005,
  ONE_EURO_TOUCH_MIN_CUTOFF: 1.0,
  ONE_EURO_TOUCH_BETA: 0.007,
  ONE_EURO_DERIVATE_CUTOFF: 1.0,

  // Fraction of bbox diagonal allowed between first and last resampled point
  // for a shape to be considered closed. Tuned against real player samples in
  // samples/: human gaps for "intended-closed" shapes ranged 8–13% of bbox
  // diagonal. The previous 0.05 was too tight. Higher values risk classifying
  // intentionally-open shapes (V, arc) as closed; 0.15 is the current balance.
  CLOSURE_DISTANCE_MAX: 0.15,

  // Corner detection (windowed-peak approach, May 2026):
  // - RAW: low single-sample floor — anything below is drawing noise.
  // - WINDOW_SUM: a corner's total turn within ±2 samples must clear this.
  //   Tuned at ~30° (π/6) so a slightly-rounded octagon corner whose turn
  //   distributes across 4-5 samples (each 8-12°) still sums to ≥30°.
  // - MIN_BASELINE_SAMPLES: at least this many of the 4 non-center samples
  //   in the window must lie below half the peak. Real corners sit on a
  //   low-magnitude baseline; sustained-moderate-turn curve segments don't.
  //   Robust to adjacent real corners (only the high-magnitude neighbor
  //   gets excluded; the rest of the baseline still satisfies the count).
  CORNER_ANGLE_THRESHOLD: Math.PI / 12,
  CORNER_WINDOW_SUM_THRESHOLD: Math.PI / 6,
  CORNER_MIN_BASELINE_SAMPLES: 2,
  CORNER_WINDOW_HALF_WIDTH: 2,
  CORNER_MIN_SPACING_FRAC: 1 / 12,
  GAUSSIAN_SMOOTH_SIGMA: 2,

  POLYGON_ANGLE_TOLERANCE: Math.PI / 6,
  POLYGON_SIDE_CV_MAX: 0.2,

  CORNER_90_TOLERANCE: Math.PI / 8,
  SQUARE_ASPECT_TOLERANCE: 0.15,
  RECTANGLE_OPPOSITE_SIDE_TOLERANCE: 0.15,

  // Lowered from 0.6 to 0.5 after seeing real-input recognizers consistently
  // score 0.51–0.59 on correct classifications.
  CONFIDENCE_THRESHOLD: 0.5,
} as const;
