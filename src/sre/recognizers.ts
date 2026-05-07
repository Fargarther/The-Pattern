// Per-shape recognizers. Each takes a ShapeFeatures and returns confidence ∈ [0, 1].
//
// Thresholds are tuned against the saved sample corpus in samples/, NOT the
// spec's defaults. The spec was written for clean stylus input; real human
// drawings (especially mouse-drawn) have:
//   - more corners than expected (seam artifacts where start ≠ a geometric corner)
//   - high DCR even on smooth shapes (occasional kinks contrast with smooth arcs)
//   - over-tracing (drawing a circle twice → total turn ≈ 2 × 2π)
//
// Where the spec said "hard gate," we either soften the gate or remove it and
// let the score reflect the deviation.

import type { ShapeFeatures, ShapeName } from './types.js';

export interface Recognizer {
  name: ShapeName;
  match: (f: ShapeFeatures) => number;
}

// Helper: triangle-shaped score curve. Returns 1 at center, 0 at the edges,
// linear in between. Used for "this feature should be roughly X" tests.
function triangleScore(value: number, center: number, halfWidth: number): number {
  const deviation = Math.abs(value - center);
  if (deviation >= halfWidth) return 0;
  return 1 - deviation / halfWidth;
}

// Helper: bounded score around an expected total-turn value, allowing extra
// turn from over-tracing (drawing twice around a closed loop).
function turnScore(totalAbsAngle: number, expectedTurns: number): number {
  const turns = totalAbsAngle / (2 * Math.PI);
  if (turns < expectedTurns * 0.7) return 0;
  if (turns <= expectedTurns * 1.15) return 1;
  if (turns <= expectedTurns + 1.2) return 0.7;
  return 0.3;
}

export function recognizeTriangle(f: ShapeFeatures): number {
  if (!f.isClosed) return 0;

  // Triangles drawn by hand typically read as 3 corners; sometimes 4 if the
  // start point sits on a side and creates a seam artifact.
  if (f.cornerCount < 3 || f.cornerCount > 4) return 0;

  // Polygon-like (turn concentrated at corners). Rejects circles whose
  // 3 detected kinks happen to look like triangle corners by count alone.
  if (f.cornerTurnRatio < 0.40) return 0;

  // Cap on aspect ratio — extremely elongated shapes (rectangles, lozenges)
  // shouldn't pass through the triangle recognizer.
  if (f.bboxAspectRatio < 0.4 || f.bboxAspectRatio > 2.5) return 0;

  // Total turn must be near 1×2π. Reject heavily over-traced shapes — those
  // are usually circles drawn twice, not triangles. Real human triangles
  // drift up to ~1.7× from drawing wobble; double-traced circles run 1.95+.
  const turns = f.totalAbsoluteAngle / (2 * Math.PI);
  if (turns > 1.75) return 0;

  const turn = turnScore(f.totalAbsoluteAngle, 1);
  if (turn === 0) return 0;

  // If 4 corners, one MUST be much weaker than the others (a true seam
  // artifact). Three checks together:
  //   1. smallest < 40% of strongest (rejects most quadrilaterals)
  //   2. top-3 corner-angle sum ≈ 2π (a true triangle's three real corners
  //      account for almost all the closed-shape exterior turn; a rhombus
  //      misclassified as 4-corner has top-3 sum well below 2π).
  //   3. smallest must be much weaker than 2nd-smallest (the seam is a
  //      *unique* artifact). Wide pointy rhombi can otherwise sneak through
  //      because their two obtuse interior angles produce two similar-sized
  //      small turns — pattern [151°, 127°, 32°, 28°] has 28/151 = 0.185
  //      (passes #1) but 28/32 = 0.875 (rhombus, not triangle).
  let extraCornerPenalty = 0;
  if (f.cornerCount === 4) {
    const sorted = [...f.cornerAngles].sort((a, b) => b - a);
    if (sorted[3]! >= sorted[0]! * 0.4) return 0;
    const top3Sum = sorted[0]! + sorted[1]! + sorted[2]!;
    if (top3Sum < 2 * Math.PI * 0.85) return 0; // rhombus / parallelogram territory
    // Smallest must be much weaker than 2nd-smallest (true seam artifact).
    if (sorted[2]! > 0 && sorted[3]! / sorted[2]! > 0.6) return 0;
    extraCornerPenalty = 0.15;
  }

  const dcrBonus = Math.min(0.1, Math.max(0, (f.dcr - 5) * 0.01));
  const equilateralBonus = f.sideLengthCV < 0.2 ? 0.1 : 0;

  return Math.max(
    0,
    Math.min(1, 0.7 * turn + 0.15 + equilateralBonus + dcrBonus - extraCornerPenalty),
  );
}

export function recognizeCircle(f: ShapeFeatures): number {
  if (!f.isClosed) return 0;

  // The cleanest discriminator between curve and polygon: how much of the
  // total turn lives at detected corners. Real circles have ~30–60%. Above
  // 0.6 it really is polygon territory.
  if (f.cornerTurnRatio > 0.6) return 0;

  // Allow up to 4 spurious kinks. Over-traced circles (drawn twice around)
  // tend to accumulate one or two extra kinks on the second lap.
  if (f.cornerCount > 4) return 0;

  // Aspect ratio close to 1 (loose — hand-drawn ovals still classify)
  const aspectScore = triangleScore(f.bboxAspectRatio, 1, 0.6);
  if (aspectScore === 0) return 0;

  // Circles can be traced 1×, 2×, or even 3×. Accept any total turn that's
  // close to a positive integer multiple of 2π.
  const turns = f.totalAbsoluteAngle / (2 * Math.PI);
  const nearestLap = Math.max(1, Math.round(turns));
  const lapDev = Math.abs(turns - nearestLap);
  if (lapDev > 0.4) return 0;
  const turnScoreCircle = 1 - lapDev / 0.4;

  const ratioScore = 1 - Math.max(0, (f.cornerTurnRatio - 0.2) / 0.35);

  const score = 0.4 + 0.2 * aspectScore + 0.2 * turnScoreCircle + 0.2 * ratioScore;
  return Math.max(0, Math.min(1, score));
}

/** Pick the 4 corners with the highest combined turn-magnitude — real
 * polygon corners contribute most of the turn, artifacts (seam wobbles or
 * over-rotations split into multiple samples) contribute less. Returns the
 * INDICES into the original array so callers can extract any per-corner
 * field consistently. */
function pickFourLargestSumIdx(angles: number[]): number[] {
  if (angles.length <= 4) return angles.map((_, i) => i);
  let bestIdxs: number[] = [0, 1, 2, 3];
  let bestSum = bestIdxs.reduce((s, i) => s + angles[i]!, 0);
  for (let drop = 0; drop < angles.length; drop++) {
    const idxs = angles.map((_, i) => i).filter((i) => i !== drop);
    if (idxs.length !== 4) continue;
    const sum = idxs.reduce((s, i) => s + angles[i]!, 0);
    if (sum > bestSum) {
      bestSum = sum;
      bestIdxs = idxs;
    }
  }
  return bestIdxs;
}

export function recognizeSquare(f: ShapeFeatures): number {
  if (!f.isClosed) return 0;
  if (f.cornerCount < 4 || f.cornerCount > 5) return 0;
  if (f.cornerTurnRatio < 0.40) return 0; // polygon-like, not a curve

  // Reject hourglass-style X-cross: 2+ strong positive AND 2+ strong negative
  // corners. A real square has all 4 corners same rotational sign.
  const sharpThresh = Math.PI / 3;
  const positives = f.cornerSignedAngles.filter((a) => a > sharpThresh).length;
  const negatives = f.cornerSignedAngles.filter((a) => a < -sharpThresh).length;
  if (positives >= 2 && negatives >= 2) return 0;

  // Square = aspect ≈ 1. Tolerance widened to 0.4 after validation: real
  // human squares drift up to aspect 1.23 routinely.
  const aspectScore = triangleScore(f.bboxAspectRatio, 1, 0.4);
  if (aspectScore === 0) return 0;

  // For 5-corner case, the 4 "real" corners are the 4 with the highest
  // combined turn — over-rotation at start can manifest as one corner
  // 2–3× larger than the others, and dropping IT would leave 4 small
  // corners that don't sum to a quad. Pick by largest sum instead.
  const realIdxs =
    f.cornerCount === 5
      ? pickFourLargestSumIdx(f.cornerAngles)
      : f.cornerAngles.map((_, i) => i);
  const real4 = realIdxs.map((i) => f.cornerAngles[i]!);

  const sortedReal = [...real4].sort((a, b) => b - a);
  if (sortedReal.length < 4 || sortedReal[3]! < sortedReal[0]! * 0.25) return 0;

  // The two largest corners shouldn't dwarf the two smallest. Triangles drawn
  // with an over-rotated start produce 4 detected corners with the pattern
  // [very-strong, strong, weak, weak] — top2/bottom2 ratio above ~2.5.
  // Real squares (even uneven ones) stay below 2.4. Reject otherwise.
  const top2Avg = (sortedReal[0]! + sortedReal[1]!) / 2;
  const bot2Avg = (sortedReal[2]! + sortedReal[3]!) / 2;
  if (bot2Avg > 0 && top2Avg / bot2Avg > 2.5) return 0;

  // Sum of the 4 real corners should be in the ballpark of 2π
  const sum4 = sortedReal.reduce((s, a) => s + a, 0);
  if (sum4 < Math.PI * 1.0) return 0;

  const extraCornerPenalty = f.cornerCount === 5 ? 0.1 : 0;
  const turn = turnScore(f.totalAbsoluteAngle, 1);
  const sym4Score = 1 - Math.min(1, f.rotationalSymmetry4 * 5);

  const score =
    0.35 * aspectScore + 0.25 * sym4Score + 0.2 * turn + 0.2 - extraCornerPenalty;

  return Math.max(0, Math.min(1, score));
}

// ============================================================================
// Quadrilateral helpers (Day 4)
// ============================================================================

interface Quad {
  angles: number[]; // length 4, in walk-order around the shape
  points: { x: number; y: number }[]; // length 4, walk-order
  sides: { x: number; y: number }[]; // length 4, unit vectors. side[i]: point[i]→point[i+1]
  sideLengths: number[]; // length 4
}

function makeQuad(f: ShapeFeatures, idxs: number[]): Quad {
  const points = idxs.map((i) => f.cornerPoints[i]!);
  const sides: { x: number; y: number }[] = [];
  const sideLengths: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % 4]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    sides.push(len > 0 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 });
    sideLengths.push(len);
  }
  return {
    angles: idxs.map((i) => f.cornerAngles[i]!),
    points,
    sides,
    sideLengths,
  };
}

/** Score a candidate quad on how "cleanly quadrilateral" it is — at least one
 * pair of opposite sides parallel + corner-angle sum near 2π. Higher = better. */
function scoreQuadFit(q: Quad): number {
  const par1 = parallelism(q.sides[0]!, q.sides[2]!);
  const par2 = parallelism(q.sides[1]!, q.sides[3]!);
  const maxPar = Math.max(par1, par2);
  const cornerSum = q.angles.reduce((s, a) => s + a, 0);
  // Triangle-shaped score around 2π (the closed-shape exterior-angle total).
  // Allow up to π over (the over-tracing we've seen) without full penalty.
  const sumDev = Math.abs(cornerSum - 2 * Math.PI);
  const sumScore = sumDev < Math.PI ? 1 - sumDev / Math.PI : 0;
  return maxPar * 2 + sumScore;
}

/** Build a Quad from features. For 5-corner inputs, evaluates all 5 ways to
 * drop one corner and keeps the subset whose 4 remaining corners form the
 * cleanest quad. Fixes the rhombus failure mode where the previous "drop
 * smallest" heuristic picked the wrong corner, causing the resulting sides
 * to jump across an actual vertex and breaking parallelism. */
function selectQuad(f: ShapeFeatures): Quad | null {
  if (f.cornerCount < 4 || f.cornerCount > 5) return null;
  if (f.cornerCount === 4) {
    return makeQuad(f, [0, 1, 2, 3]);
  }
  // 5 corners — try every drop, score each, keep the best.
  let best: Quad | null = null;
  let bestScore = -Infinity;
  for (let drop = 0; drop < 5; drop++) {
    const idxs = [0, 1, 2, 3, 4].filter((i) => i !== drop);
    const q = makeQuad(f, idxs);
    const score = scoreQuadFit(q);
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best;
}

/** 1.0 = perfectly parallel (same OR opposite direction), 0.0 = perpendicular. */
function parallelism(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dot = a.x * b.x + a.y * b.y;
  return Math.abs(dot);
}

/** 1.0 = perpendicular, 0.0 = parallel. */
function perpendicularity(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const cross = a.x * b.y - a.y * b.x;
  return Math.abs(cross);
}

function quadParallelisms(q: Quad): { topBottom: number; leftRight: number } {
  return {
    topBottom: parallelism(q.sides[0]!, q.sides[2]!),
    leftRight: parallelism(q.sides[1]!, q.sides[3]!),
  };
}

function quadPerpendicularity(q: Quad): number {
  // Average perpendicularity of adjacent side pairs. ~1.0 for rectangles.
  const p1 = perpendicularity(q.sides[0]!, q.sides[1]!);
  const p2 = perpendicularity(q.sides[1]!, q.sides[2]!);
  const p3 = perpendicularity(q.sides[2]!, q.sides[3]!);
  const p4 = perpendicularity(q.sides[3]!, q.sides[0]!);
  return (p1 + p2 + p3 + p4) / 4;
}

/** Standard CV (stdev/mean) for the 4 side lengths. Low = sides are equal. */
function quadSideCV(q: Quad): number {
  const m = q.sideLengths.reduce((s, a) => s + a, 0) / 4;
  if (m === 0) return Infinity;
  const v = q.sideLengths.reduce((s, a) => s + (a - m) * (a - m), 0) / 4;
  return Math.sqrt(v) / m;
}

// ============================================================================
// Quadrilateral recognizers
// ============================================================================

export function recognizeRectangle(f: ShapeFeatures): number {
  if (!f.isClosed) return 0;
  if (f.cornerCount < 4 || f.cornerCount > 5) return 0;
  if (f.cornerTurnRatio < 0.40) return 0; // polygon-like, not a curve
  const q = selectQuad(f);
  if (!q) return 0;

  // Aspect ratio NOT ≈ 1 — that would be a square.
  if (f.bboxAspectRatio > 0.7 && f.bboxAspectRatio < 1.3) return 0;

  // Total turn approx 2π
  const turn = turnScore(f.totalAbsoluteAngle, 1);
  if (turn === 0) return 0;

  // Both pairs of opposite sides should be parallel
  const par = quadParallelisms(q);
  if (par.topBottom < 0.7 || par.leftRight < 0.7) return 0;

  // Adjacent sides should be perpendicular (≈ 90° corners). Tightened to
  // 0.85 to keep wide rhombuses (perp ≈ 0.66) out of the rectangle bucket.
  const perp = quadPerpendicularity(q);
  if (perp < 0.85) return 0;

  // Opposite sides should be approximately equal length (rectangle: w/h pairs)
  const lenRatioH = Math.min(q.sideLengths[0]!, q.sideLengths[2]!) / Math.max(q.sideLengths[0]!, q.sideLengths[2]!);
  const lenRatioV = Math.min(q.sideLengths[1]!, q.sideLengths[3]!) / Math.max(q.sideLengths[1]!, q.sideLengths[3]!);
  if (lenRatioH < 0.5 || lenRatioV < 0.5) return 0;

  const extraCornerPenalty = f.cornerCount === 5 ? 0.1 : 0;
  const aspectFromSquare =
    f.bboxAspectRatio > 1 ? f.bboxAspectRatio - 1 : 1 / f.bboxAspectRatio - 1;
  const aspectScore = Math.min(1, aspectFromSquare / 0.5);
  const score = 0.25 * aspectScore + 0.25 * perp + 0.2 * (par.topBottom + par.leftRight) / 2 + 0.2 * turn + 0.1 - extraCornerPenalty;
  return Math.max(0, Math.min(1, score));
}

function recognizeRhombusFamily(f: ShapeFeatures): { score: number; aspectIsHorizontal: boolean } {
  if (!f.isClosed) return { score: 0, aspectIsHorizontal: false };
  if (f.cornerCount < 4 || f.cornerCount > 5) return { score: 0, aspectIsHorizontal: false };
  if (f.cornerTurnRatio < 0.40) return { score: 0, aspectIsHorizontal: false };
  const q = selectQuad(f);
  if (!q) return { score: 0, aspectIsHorizontal: false };

  // Both pairs parallel
  const par = quadParallelisms(q);
  if (par.topBottom < 0.7 || par.leftRight < 0.7) return { score: 0, aspectIsHorizontal: false };

  // Adjacent sides NOT perpendicular (otherwise it's a square/rectangle)
  const perp = quadPerpendicularity(q);
  if (perp > 0.85) return { score: 0, aspectIsHorizontal: false };

  // All four sides equal length
  const cv = quadSideCV(q);
  if (cv > 0.25) return { score: 0, aspectIsHorizontal: false };

  const turn = turnScore(f.totalAbsoluteAngle, 1);
  if (turn === 0) return { score: 0, aspectIsHorizontal: false };

  const extraCornerPenalty = f.cornerCount === 5 ? 0.1 : 0;
  const sideEqualityScore = 1 - Math.min(1, cv / 0.25);
  const obliqueScore = 1 - perp; // higher when farther from 90° (rhombus territory)
  const score =
    0.3 * sideEqualityScore +
    0.25 * (par.topBottom + par.leftRight) / 2 +
    0.2 * obliqueScore +
    0.15 * turn +
    0.1 -
    extraCornerPenalty;
  return {
    score: Math.max(0, Math.min(1, score)),
    aspectIsHorizontal: f.bboxAspectRatio >= 1,
  };
}

export function recognizeRhombus(f: ShapeFeatures): number {
  const r = recognizeRhombusFamily(f);
  // Rhombus per the dictionary is the WIDE (horizontal) rhombus (aspect > 1).
  return r.aspectIsHorizontal ? r.score : 0;
}

export function recognizeDiamond(f: ShapeFeatures): number {
  const r = recognizeRhombusFamily(f);
  // Diamond is the TALL (vertical) variant (aspect < 1).
  return r.aspectIsHorizontal ? 0 : r.score;
}

export function recognizeTrapezoid(f: ShapeFeatures): number {
  if (!f.isClosed) return 0;
  if (f.cornerCount < 4 || f.cornerCount > 5) return 0;
  // Tighter cR floor than other quads — trapezoid is "the shape with one
  // parallel pair" which makes it dangerously easy to accept wonky 4-corner
  // curves. A real trapezoid has the polygon-typical cR ≥ 0.55.
  // 5-corner case is even pickier: real 5-corner trapezoids run cR ≥ 0.67
  // (the seam adds a sharp split that boosts the ratio), while wonky
  // circles with 5 detected kinks land at cR 0.55–0.60. Use 0.62 as the
  // gate to cleanly reject those circle artifacts.
  if (f.cornerCount === 4 && f.cornerTurnRatio < 0.55) return 0;
  if (f.cornerCount === 5 && f.cornerTurnRatio < 0.62) return 0;

  // Reject hourglass-style X-cross shapes — those have ≥2 strong positive
  // AND ≥2 strong negative corners (alternating direction across the
  // self-intersection). Real trapezoids are convex: all corners same sign.
  const sharpThresh = Math.PI / 3;
  const positives = f.cornerSignedAngles.filter((a) => a > sharpThresh).length;
  const negatives = f.cornerSignedAngles.filter((a) => a < -sharpThresh).length;
  if (positives >= 2 && negatives >= 2) return 0;

  const q = selectQuad(f);
  if (!q) return 0;

  // Trapezoid: ONE pair of opposite sides clearly parallel, the OTHER pair
  // clearly NOT parallel. Tightening the second half — it used to accept
  // anything < 0.85, but rhombuses with par like (0.87, 0.65) snuck in.
  // Now require the non-parallel pair below 0.6 to count as trapezoid.
  const par = quadParallelisms(q);
  const high = Math.max(par.topBottom, par.leftRight);
  const low = Math.min(par.topBottom, par.leftRight);
  if (high < 0.85) return 0;
  if (low > 0.6) return 0;

  const turn = turnScore(f.totalAbsoluteAngle, 1);
  if (turn === 0) return 0;

  const extraCornerPenalty = f.cornerCount === 5 ? 0.1 : 0;
  const nonParallelScore = 1 - low;
  const score = 0.35 * high + 0.25 * nonParallelScore + 0.2 * turn + 0.1 - extraCornerPenalty;
  return Math.max(0, Math.min(0.85, score)); // capped — trapezoid is a fallback class
}

// ============================================================================
// Regular polygons (Day 5): pentagon → decagon
// ============================================================================

/** Recognize a regular n-gon. `n` is the expected number of sides.
 *
 * Tight n-gons (n ≥ 8) at N=64 resampling routinely have one or two corners
 * that fall between samples and get split-detected below threshold, so we
 * allow [n−2, n+1] detected corners for those. Disambiguation between
 * adjacent n-gons (e.g. heptagon vs. decagon-with-3-missed both have 7
 * detected corners) relies on MEAN CORNER ANGLE: the per-corner turn for
 * a regular n-gon is 2π/n, and that average is preserved even when some
 * corners are missed.
 */
function recognizeRegularPolygon(f: ShapeFeatures, n: number): number {
  if (!f.isClosed) return 0;

  // Tolerance for missing corners scales with n. At N=64 resampling, every
  // additional side reduces the per-side sample count, making split-corner
  // detection failures more likely. We allow finer-grained tolerance per n:
  //   n=5,6,7: [n, n+1]
  //   n=8:     [n-1, n+1]
  //   n=9:     [n-2, n+1]
  //   n=10:    [n-3, n+1]
  // Without finer tolerance, octagon (range [n-2, n+1] = [6, 9]) would steal
  // hexagons whose detection split-halves the mean to 45° — exactly octagon's
  // expected 2π/8.
  const looseness = n >= 10 ? 3 : n >= 9 ? 2 : n >= 8 ? 1 : 0;
  const minCorners = Math.max(3, n - looseness);
  const maxCorners = n + 1;
  if (f.cornerCount < minCorners || f.cornerCount > maxCorners) return 0;

  // Polygon-like (turn concentrated at corners), not curve-like. Lowered
  // from 0.55 to 0.50 — real human n-gons have cR 0.48-0.55 because their
  // sides aren't perfectly straight. Circles still rejected (cR 0.32-0.44
  // typical, max ~0.57 on very wonky drawings).
  if (f.cornerTurnRatio < 0.5) return 0;

  // Aspect ratio close to 1. Real hand-drawn n-gons frequently come out
  // stretched (aspect up to 1.5–1.6); loosened from 0.4 to 0.5 after
  // validating against samples.
  const aspectScore = triangleScore(f.bboxAspectRatio, 1, 0.5);
  if (aspectScore === 0) return 0;

  // Total turn ≈ 2π
  const turn = turnScore(f.totalAbsoluteAngle, 1);
  if (turn === 0) return 0;

  // For the n+1 case, the extra detected corner must be much weaker (a seam
  // artifact) — otherwise this is probably an (n+1)-gon, not an n-gon.
  let cornerAnglesUsed: number[];
  let extraCornerPenalty = 0;
  if (f.cornerCount === n + 1) {
    const sorted = [...f.cornerAngles].sort((a, b) => b - a);
    const topNMean = sorted.slice(0, n).reduce((s, a) => s + a, 0) / n;
    if (sorted[n]! >= topNMean * 0.5) return 0;
    cornerAnglesUsed = sorted.slice(0, n);
    extraCornerPenalty = 0.1;
  } else {
    cornerAnglesUsed = [...f.cornerAngles];
  }

  // Reject patterns that don't look like an n-gon's uniform corner distribution:
  // - "(n−1)-gon with weak artifact": n−1 strong + 1 weak (e.g. square-with-seam
  //   would otherwise sneak in as pentagon since the AVERAGE is right).
  // - "(n−1)-gon with one strong over-rotated corner": 1 huge + (n−1) normal
  //   (a square drawn with an over-rotated start has 4 normal corners + 1
  //   large one; the largest is 2×+ the others' mean — not a pentagon pattern).
  if (f.cornerCount === n && n >= 5) {
    const sorted = [...cornerAnglesUsed].sort((a, b) => b - a);
    const topMinusOneMean = sorted.slice(0, n - 1).reduce((s, a) => s + a, 0) / (n - 1);
    if (sorted[n - 1]! < topMinusOneMean * 0.4) return 0;
    const restMean = sorted.slice(1).reduce((s, a) => s + a, 0) / (n - 1);
    // Loosened progressively: 1.8 → 1.9 → 2.05. After windowed corner
    // detection landed (May 2026), real polygons can have one corner
    // hit 1.94–2.0× the rest because rounded corners get merged into a
    // single inflated single-sample reading by NMS. Square-with-true-
    // artifact patterns typically run 2.1+, so the gate still excludes
    // them while admitting these legitimately-merged-corner polygons.
    if (restMean > 0 && sorted[0]! / restMean > 2.05) return 0;
  }

  // Corner-angle uniformity
  const m = cornerAnglesUsed.reduce((s, a) => s + a, 0) / cornerAnglesUsed.length;
  if (m === 0) return 0;
  const v =
    cornerAnglesUsed.reduce((s, a) => s + (a - m) * (a - m), 0) / cornerAnglesUsed.length;
  const cv = Math.sqrt(v) / m;
  if (cv > 0.5) return 0;
  const cvScore = 1 - Math.min(1, cv / 0.5);

  // PRIMARY DISCRIMINATOR: how close is the mean detected corner angle to
  // the expected 2π/n? This is what tells decagon-with-3-missed apart from
  // heptagon-7-corner — both have 7 corners but the means differ (36° vs 51°).
  // We gate at 0.65 (mean within ~35% of expected) — below that, the
  // corners aren't really matching this n-gon's pattern.
  const expectedTurn = (2 * Math.PI) / n;
  const turnFit = 1 - Math.min(1, Math.abs(m - expectedTurn) / expectedTurn);
  if (turnFit < 0.65) return 0;

  const missing = Math.max(0, n - f.cornerCount);
  const missingPenalty = Math.min(0.15, missing * 0.03);

  // Bonus when the detected corner count exactly matches n. Without this,
  // an octagon (8 detected, mean 34°) gets stolen by the decagon recognizer
  // which sees mean 34° as closer to its expected 36° than to octagon's 45°.
  // Exact count match overrides systematic mean-shift from split detection.
  const exactCountBonus = f.cornerCount === n ? 0.15 : 0;

  const score =
    0.4 * turnFit +
    0.15 * cvScore +
    0.1 * aspectScore +
    0.15 * turn +
    0.1 +
    exactCountBonus -
    extraCornerPenalty -
    missingPenalty;
  return Math.max(0, Math.min(1, score));
}

export const recognizePentagon = (f: ShapeFeatures) => recognizeRegularPolygon(f, 5);
export const recognizeHexagon = (f: ShapeFeatures) => recognizeRegularPolygon(f, 6);
export const recognizeHeptagon = (f: ShapeFeatures) => recognizeRegularPolygon(f, 7);
export const recognizeOctagon = (f: ShapeFeatures) => recognizeRegularPolygon(f, 8);
export const recognizeNonagon = (f: ShapeFeatures) => recognizeRegularPolygon(f, 9);
export const recognizeDecagon = (f: ShapeFeatures) => recognizeRegularPolygon(f, 10);

// ============================================================================
// Symbolic shapes (Day 6): bolt, hourglass, plus/cross, arrow, sun
// ============================================================================

/** Bolt = lightning zigzag, OPEN, 2–4 sharp direction reversals. */
export function recognizeBolt(f: ShapeFeatures): number {
  if (f.isClosed) return 0;
  if (f.cornerCount < 2 || f.cornerCount > 4) return 0;

  // Each detected corner must be sharp (real direction reversal, not a
  // shallow curve) — ≥ 60°.
  const sharpCount = f.cornerAngles.filter((a) => a > Math.PI / 3).length;
  if (sharpCount < 2) return 0;

  // Strong directional axis — bolts are tall or wide, not square.
  if (f.bboxAspectRatio > 0.7 && f.bboxAspectRatio < 1.4) return 0;

  // Total turn should reflect the zigzag count: 2–4 sharp turns × ~90–120°
  const turns = f.totalAbsoluteAngle / (2 * Math.PI);
  if (turns < 0.25 || turns > 1.5) return 0;

  // Cleaner = sharper corners. Mean corner angle should be high.
  const meanCorner =
    f.cornerAngles.reduce((s, a) => s + a, 0) / Math.max(1, f.cornerAngles.length);
  const sharpScore = Math.min(1, meanCorner / (Math.PI / 2));

  return Math.max(0, Math.min(0.85, 0.4 + 0.3 * sharpScore + 0.15 * (sharpCount / 4)));
}

/** Hourglass = 4 corners, the path crosses itself in the middle. Signature:
 *   - 4 corners with ALTERNATING signed turn directions (++/-- or similar)
 *   - signed-angle integral cancels (≈ 0)
 *   - elevated absolute total turn
 *   - vertical or square-ish aspect
 *
 * Distinguished from a convex quad with seam-artifact noise (which has
 * mostly same-sign turns). */
export function recognizeHourglass(f: ShapeFeatures): number {
  if (!f.isClosed) return 0;
  if (f.cornerCount < 4 || f.cornerCount > 5) return 0;
  if (f.cornerTurnRatio < 0.55) return 0;

  // Self-intersection: signed angle cancels.
  if (Math.abs(f.totalSignedAngle) > Math.PI * 0.5) return 0;

  // Elevated absolute total turn (~540° for ideal X-cross; real human
  // hourglasses dip as low as ~1.1×2π).
  if (f.totalAbsoluteAngle < 2 * Math.PI * 1.1) return 0;

  // Vertical or square-ish (loosened to 1.6 — real hourglasses sometimes
  // come out a touch wide).
  if (f.bboxAspectRatio > 1.6) return 0;

  // True hourglass has BOTH directions strongly represented — 2+ corners
  // each at ≥60° on each side. Lower bar lets wonky triangles slip in.
  const sharpThresh = Math.PI / 3;
  const positives = f.cornerSignedAngles.filter((a) => a > sharpThresh).length;
  const negatives = f.cornerSignedAngles.filter((a) => a < -sharpThresh).length;
  if (positives < 2 || negatives < 2) return 0;

  return 0.75;
}

/** Plus sign / Greek cross. Single closed outline tracing the 12-vertex
 * silhouette. Real corner detection at N=64 only catches 6–10 of the
 * 12 vertices, so we lean primarily on:
 *   - very high TOTAL turn (~3×2π — the rectilinear plus turns 12×90° = 1080°)
 *   - 4-fold rotational symmetry
 *   - aspect ≈ 1
 *
 * Drawn-as-two-strokes is a separate problem (multistroke; phase 2). */
export function recognizePlusSign(f: ShapeFeatures): number {
  if (!f.isClosed) return 0;
  if (f.cornerCount < 6 || f.cornerCount > 14) return 0;

  // 4-fold rotational symmetry — distinguishes plus from arrows (sym4 0.06+),
  // random scribbles (sym4 0.07+), and other rectilinear-but-asymmetric
  // patterns. Real plus signs have sym4 ≤ 0.04.
  if (f.rotationalSymmetry4 > 0.05) return 0;

  // Aspect ≈ 1 (tighter than 0.25 — arrows hit aspect 0.75-0.92 which is
  // similar enough to slip through a loose tolerance)
  if (Math.abs(f.bboxAspectRatio - 1) > 0.15) return 0;

  // Total turn ≈ 3×2π. Reject ordinary closed shapes (turns ≈ 1).
  const turns = f.totalAbsoluteAngle / (2 * Math.PI);
  if (turns < 2.3 || turns > 3.7) return 0;

  // Outer-corner sharpness — distinguishes plus from shuriken (4-point
  // star). Plus's 4 outer corners are right angles (~90° turn ≈ π/2);
  // shuriken's outer tips are MUCH sharper (~135°+ turn). The 4 strongest
  // corners by magnitude — both shapes' outer corners — should average
  // ≤ ~110° (well under shuriken's typical 130°+).
  const sortedCornerAngles = [...f.cornerAngles].sort((a, b) => b - a);
  const top4 = sortedCornerAngles.slice(0, 4);
  if (top4.length === 4) {
    const avgTop4 = top4.reduce((s, a) => s + a, 0) / 4;
    if (avgTop4 > (110 * Math.PI) / 180) return 0; // 110° in radians
  }

  // Balance check — distinguishes plus from arrows (which also have
  // ~90° corners but unbalanced sign distribution). A real plus has
  // 4 strong positives + 4 strong negatives (one per corner, perfectly
  // balanced). An arrow has ~4-5 strong positives but only 1-2 strong
  // negatives at the head shoulders. Reject when the imbalance is > 1.
  const sharpThresh = Math.PI / 4; // 45°
  const strongPos = f.cornerSignedAngles.filter((a) => a > sharpThresh).length;
  const strongNeg = f.cornerSignedAngles.filter((a) => a < -sharpThresh).length;
  if (Math.abs(strongPos - strongNeg) > 1) return 0;

  return 0.8;
}

/** Find the direction the arrow's tip points by locating the sharpest
 * convex corner and checking its position relative to the bbox center.
 *
 * Returns 'up', 'down', 'left', 'right', or null if no clear tip. The game
 * dictionary distinguishes Arrow (up = movement/attack boost) from Down
 * Arrow (debuff modifier); other directions aren't currently in the
 * dictionary but the same machinery extends to them.
 */
export function arrowTipDirection(
  f: ShapeFeatures,
): 'up' | 'down' | 'left' | 'right' | null {
  if (f.cornerPoints.length === 0) return null;
  // Tip = the corner with the largest CONVEX turn. The shoulders are
  // CONCAVE (opposite sign), so we filter to same-sign-as-dominant.
  const totalSigned = f.totalSignedAngle;
  const dominantSign = totalSigned >= 0 ? 1 : -1;
  let bestIdx = -1;
  let bestMag = 0;
  for (let i = 0; i < f.cornerSignedAngles.length; i++) {
    const a = f.cornerSignedAngles[i]!;
    if (a * dominantSign <= 0) continue; // concave indent — skip
    if (Math.abs(a) > bestMag) {
      bestMag = Math.abs(a);
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  const tip = f.cornerPoints[bestIdx]!;
  // Centroid of all corner points = bbox-ish center
  let cx = 0;
  let cy = 0;
  for (const p of f.cornerPoints) {
    cx += p.x;
    cy += p.y;
  }
  cx /= f.cornerPoints.length;
  cy /= f.cornerPoints.length;
  const dx = tip.x - cx;
  const dy = tip.y - cy;
  // Pick the dominant axis. Note: y is positive downward in canvas coords.
  if (Math.abs(dy) > Math.abs(dx)) {
    return dy < 0 ? 'up' : 'down';
  }
  return dx < 0 ? 'left' : 'right';
}

/** Arrow = closed silhouette with concave head shoulders. Signature:
 *   - 5+ detected corners (head + shoulders + stem corners, even with NMS)
 *   - At least one corner with OPPOSITE-SIGN turn vs the dominant rotation
 *     (the concave indent at the head shoulders)
 *   - Strong directional axis
 *   - Asymmetric (not 4-fold)
 *
 * A convex quad with detection wobble has all turn signs the same. The
 * concave-indent test is what cleanly rules out rhombuses, trapezoids,
 * and rectangles drawn imperfectly. Returns a confidence regardless of
 * tip direction — the up/down split is done by callers (recognizeArrow,
 * recognizeArrowDown).
 */
function recognizeArrowAnyDirection(f: ShapeFeatures): number {
  if (!f.isClosed) return 0;
  if (f.cornerCount < 5 || f.cornerCount > 8) return 0;
  if (f.cornerTurnRatio < 0.45) return 0;

  // Asymmetric (rules out plus, square, etc.). Real arrows have sym4
  // 0.06-0.10 — looser than plus's 0.05 cap.
  if (f.rotationalSymmetry4 < 0.06) return 0;

  // Strong directional axis. Real arrows are typically drawn with aspect
  // 0.7–0.85 (clearly tall) or 1.15–1.4 (clearly wide). Near-square shapes
  // (aspect 0.85–1.15) firing arrow are almost always wonky non-arrow
  // drawings — a square or hourglass with 5 corners and mixed signs.
  if (Math.abs(f.bboxAspectRatio - 1) < 0.15) return 0;

  // Concave-indent signature: at least 2 positive AND 2 negative corners
  // ≥45° each. Real arrows have BOTH head shoulders detected as opposite-
  // sign indents (the head is symmetric). A "1 negative + 4 positive"
  // pattern looks like an over-rotated quad with a single wobble, not an
  // arrow — that exact pattern was misclassifying diamonds, trapezoids,
  // and pentagons as arrows in the regression corpus (May 2026 tuning).
  const sharpThresh = Math.PI / 4; // 45°
  const positives = f.cornerSignedAngles.filter((a) => a > sharpThresh).length;
  const negatives = f.cornerSignedAngles.filter((a) => a < -sharpThresh).length;
  if (positives < 2 || negatives < 2) return 0;
  // Plus the dominant-direction count must clearly exceed the opposite
  // (arrow ≠ hourglass): asymmetric distribution, not 2+2 balance.
  if (Math.min(positives, negatives) >= 2 && Math.max(positives, negatives) <= 3) {
    return 0; // X-cross territory
  }

  // Real arrows have concave shoulder indents, which means their absolute
  // total turn includes both the outer convex turns AND the |negative|
  // shoulder turns. For a 7-vertex outline with 2 ~90° concave indents,
  // total absolute is ~720° = 2.0×2π. Allow up to 2.6×2π.
  const turns = f.totalAbsoluteAngle / (2 * Math.PI);
  if (turns < 0.85 || turns > 2.6) return 0;

  return 0.78;
}

/** Up-pointing arrow (or any direction other than down). The game's
 * dictionary lists "Arrow" generically as the movement/attack/damage
 * boost modifier; only Down Arrow is special-cased as a debuff. So we
 * gate the down-pointing direction off and accept everything else. */
export function recognizeArrow(f: ShapeFeatures): number {
  const score = recognizeArrowAnyDirection(f);
  if (score === 0) return 0;
  const dir = arrowTipDirection(f);
  if (dir === 'down') return 0;
  return score;
}

/** Down-pointing arrow — the dictionary's debuff modifier glyph. */
export function recognizeArrowDown(f: ShapeFeatures): number {
  const score = recognizeArrowAnyDirection(f);
  if (score === 0) return 0;
  const dir = arrowTipDirection(f);
  if (dir !== 'down') return 0;
  return score;
}

/** Sun = radial sunburst. The path makes many small direction reversals
 * (one outer tip + one inner valley per ray), producing very elevated
 * total turn (~4–6×2π for an 8-ray sun) plus high rotational symmetry.
 *
 * Corner-count varies wildly with detection: an 8-ray sun's 16 vertices
 * often only register as 8 (the outer tips, which are sharper than the
 * valleys). We use total turn as the primary signal. */
export function recognizeSun(f: ShapeFeatures): number {
  if (!f.isClosed) return 0;
  // 7+ detected corners — real 8-ray suns sometimes lose a tip to NMS.
  if (f.cornerCount < 7) return 0;

  // Aspect ≈ 1
  if (Math.abs(f.bboxAspectRatio - 1) > 0.25) return 0;

  // Elevated total turn. Ideal 8-ray sun is 4–6×2π; real human suns drop
  // to 2.0×2π when many inner valleys aren't detected. We need to stay
  // above hexagons (~1×2π) and pluses (~3×2π only when those fire).
  const turns = f.totalAbsoluteAngle / (2 * Math.PI);
  if (turns < 2.0) return 0;

  // 4-fold rotational symmetry (most ray counts include 4-fold)
  if (f.rotationalSymmetry4 > 0.1) return 0;

  // All detected corners must be same rotational sign (uniform outer tips
  // going around). Mixed signs are arrow-territory (concave indents) and
  // shouldn't fire sun.
  const dominantSign = f.totalSignedAngle >= 0 ? 1 : -1;
  const opposite = f.cornerSignedAngles.filter((a) => a * dominantSign < -Math.PI / 6).length;
  if (opposite > 1) return 0;

  return 0.75;
}

export const RECOGNIZERS: Recognizer[] = [
  // Order is for tie-breaking only — the dispatcher picks the highest score.
  { name: 'sun', match: recognizeSun },
  { name: 'decagon', match: recognizeDecagon },
  { name: 'nonagon', match: recognizeNonagon },
  { name: 'octagon', match: recognizeOctagon },
  { name: 'heptagon', match: recognizeHeptagon },
  { name: 'hexagon', match: recognizeHexagon },
  { name: 'pentagon', match: recognizePentagon },
  { name: 'plusSign', match: recognizePlusSign },
  { name: 'hourglass', match: recognizeHourglass },
  { name: 'arrow', match: recognizeArrow },
  { name: 'arrowDown', match: recognizeArrowDown },
  { name: 'square', match: recognizeSquare },
  { name: 'rectangle', match: recognizeRectangle },
  { name: 'rhombus', match: recognizeRhombus },
  { name: 'diamond', match: recognizeDiamond },
  { name: 'trapezoid', match: recognizeTrapezoid },
  { name: 'triangle', match: recognizeTriangle },
  { name: 'circle', match: recognizeCircle },
  { name: 'bolt', match: recognizeBolt },
];
