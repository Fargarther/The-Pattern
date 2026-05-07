// Feature extraction: turn a NormalizedStroke into a ShapeFeatures object.
// Spec: sre-phase1-geometric-recognizer-spec.md §3.

import type { NormalizedStroke, ShapeFeatures } from './types.js';
import { SRE_TUNING } from './types.js';
import {
  computeBbox,
  distance,
  findCornerPeaks,
  mean,
  reflectionError,
  rotationalError,
  stdev,
  turningAngles,
} from './geometry.js';

export function extractFeatures(stroke: NormalizedStroke): ShapeFeatures {
  const pts = stroke.points;
  const n = pts.length;

  // ===== Bounding box =====
  const bb = computeBbox(pts);
  const bboxAspectRatio = bb.height > 0 ? bb.width / bb.height : 0;

  // ===== Closure =====
  const firstLastDist = n >= 2 ? distance(pts[0]!, pts[n - 1]!) : 0;
  const closureDistance = bb.diagonal > 0 ? firstLastDist / bb.diagonal : 0;
  const isClosed = closureDistance < SRE_TUNING.CLOSURE_DISTANCE_MAX;

  // ===== Turning angles =====
  // For closed shapes, use circular indexing so wraparound corners count.
  // angles[i] is the turn at pts[i] (one-to-one with the cloud).
  const angles = turningAngles(pts, isClosed);
  let totalAbsoluteAngle = 0;
  let totalSignedAngle = 0;
  for (const a of angles) {
    totalAbsoluteAngle += Math.abs(a);
    totalSignedAngle += a;
  }

  // ===== Corner detection =====
  // Windowed-peak detection: a candidate sample must be a local max above
  // a low single-sample floor, then pass two more gates — total |angle|
  // within ±2 samples ≥ ~30°, and peak/window-average concentration ≥ 2.0.
  // This catches both sharp single-sample corners AND slightly-rounded
  // corners (where the same total turn spreads across 4-5 samples) while
  // rejecting sustained-moderate-turn curve segments. See findCornerPeaks
  // in geometry.ts for the full rationale.
  //
  // For open shapes, suppress the first/last k samples — a stylus touching
  // down or lifting produces erratic direction in the first/last few samples
  // even after 1€ smoothing, which otherwise reads as spurious corners.
  const absAngles = angles.map(Math.abs);
  const minSpacing = Math.max(1, Math.floor(n * SRE_TUNING.CORNER_MIN_SPACING_FRAC));

  let cornerInputAngles: number[] = absAngles;
  if (!isClosed) {
    const endpointSuppressK = Math.max(2, Math.floor(n / 16));
    cornerInputAngles = absAngles.map((v, i) =>
      i < endpointSuppressK || i >= n - endpointSuppressK ? 0 : v,
    );
  }

  const cornerIndices = findCornerPeaks(cornerInputAngles, {
    rawThreshold: SRE_TUNING.CORNER_ANGLE_THRESHOLD,
    windowSumThreshold: SRE_TUNING.CORNER_WINDOW_SUM_THRESHOLD,
    minBaselineSamples: SRE_TUNING.CORNER_MIN_BASELINE_SAMPLES,
    minSpacing,
    isClosed,
    windowHalfWidth: SRE_TUNING.CORNER_WINDOW_HALF_WIDTH,
  });
  const cornerAngles = cornerIndices.map((i) => absAngles[i]!);
  const cornerSignedAngles = cornerIndices.map((i) => angles[i]!);
  const cornerCount = cornerIndices.length;

  // Fraction of total turn that lives at detected corners. Polygons → ~1.0;
  // smooth curves with kinks → ~0.3. Used by the circle vs polygon test.
  const sumCornerAngles = cornerAngles.reduce((s, a) => s + a, 0);
  const cornerTurnRatio = totalAbsoluteAngle > 0 ? sumCornerAngles / totalAbsoluteAngle : 0;

  // Corner positions and side direction vectors (unit-normalized) for the
  // quadrilateral-family recognizers (rectangle, rhombus, diamond, trapezoid)
  // which need to test parallelism and perpendicularity between sides.
  const cornerPoints = cornerIndices.map((i) => pts[i]!);
  const sideVectors: typeof cornerPoints = [];
  for (let i = 0; i < cornerPoints.length; i++) {
    const a = cornerPoints[i]!;
    const b = cornerPoints[(i + 1) % cornerPoints.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    sideVectors.push(len > 0 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 });
  }

  // ===== Side lengths (between consecutive detected corners) =====
  const sideLengths: number[] = [];
  if (cornerCount >= 2) {
    for (let i = 0; i < cornerCount; i++) {
      const a = pts[cornerIndices[i]!]!;
      const b = pts[cornerIndices[(i + 1) % cornerCount]!]!;
      sideLengths.push(distance(a, b));
    }
  }
  const sideLengthMean = mean(sideLengths);
  const sideLengthStdev = stdev(sideLengths, sideLengthMean);
  const sideLengthCV = sideLengthMean > 0 ? sideLengthStdev / sideLengthMean : 0;

  // ===== Direction Change Ratio =====
  // PaleoSketch-style. High DCR = sharp polygon; low DCR = smooth curve.
  const meanAbsAngle = mean(absAngles);
  const maxAbsAngle = absAngles.length > 0 ? Math.max(...absAngles) : 0;
  const dcr = meanAbsAngle > 0 ? maxAbsAngle / meanAbsAngle : 0;

  // ===== Symmetry scores =====
  const horizontalSymmetry = reflectionError(pts, 'horizontal');
  const verticalSymmetry = reflectionError(pts, 'vertical');
  const rotationalSymmetry4 = rotationalError(pts, Math.PI / 2);

  return {
    cornerCount,
    cornerAngles,
    cornerSignedAngles,
    cornerIndices,
    cornerPoints,
    sideVectors,
    cornerTurnRatio,
    totalAbsoluteAngle,
    totalSignedAngle,
    closureDistance,
    isClosed,
    bboxWidth: bb.width,
    bboxHeight: bb.height,
    bboxAspectRatio,
    bboxDiagonal: bb.diagonal,
    sideLengths,
    sideLengthMean,
    sideLengthStdev,
    sideLengthCV,
    dcr,
    horizontalSymmetry,
    verticalSymmetry,
    rotationalSymmetry4,
  };
}
