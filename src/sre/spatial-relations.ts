// Spatial relation predicates for the compositional grammar layer.
//
// The recognizer answers "what shape is this stroke." This module answers
// "what is the spatial relationship between two recognized primitives."
// The composition engine (one layer up) takes these relations and matches
// them against declarative grammar rules to emit game tokens.
//
// Per the recognition-engine-roadmap §E.3, every predicate is a pure
// function over bounding-box geometry plus, for `bisecting`, line-segment
// checks against the resampled point list. Each relate() call returns
// EXACTLY ONE relation (the most specific that fits) plus a 0..1
// confidence so callers can rank near-misses.

import type { NormalizedPoint } from './types.js';

/** Standard 2D bounding box. (x, y) is the top-left corner. */
export interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A single recognized primitive that participated in a gesture. */
export interface PrimitiveOccurrence {
  /** Canonical class label (`ShapeName`), e.g. `circle`, `plusSign`. */
  classId: string;
  bbox: Bbox;
  centroid: { x: number; y: number };
  /** Unscaled resampled points in canvas space — used by `bisecting` and
   *  any future predicate that needs the actual stroke geometry. */
  resampledPoints: readonly NormalizedPoint[];
  /** Order drawn (0-indexed) — lets rules reference "the second triangle". */
  index: number;
}

export type Relation =
  | 'inside'
  | 'concentric'
  | 'bisecting'
  | 'adjacent-above'
  | 'adjacent-below'
  | 'adjacent-left'
  | 'adjacent-right'
  | 'intersecting'
  | 'disjoint';

export interface RelationResult {
  relation: Relation;
  confidence: number;
}

// ============================================================================
// Bbox helpers
// ============================================================================

function bboxArea(b: Bbox): number {
  return b.w * b.h;
}

function bboxRight(b: Bbox): number {
  return b.x + b.w;
}

function bboxBottom(b: Bbox): number {
  return b.y + b.h;
}

/** Does outer fully contain inner? Allows a small `epsilon` slop fraction
 *  so a hand-drawn outer doesn't reject a hand-drawn inner that just
 *  brushes its edge. */
function fullyContains(outer: Bbox, inner: Bbox, epsilon = 0.05): boolean {
  const slopX = outer.w * epsilon;
  const slopY = outer.h * epsilon;
  return (
    inner.x >= outer.x - slopX &&
    inner.y >= outer.y - slopY &&
    bboxRight(inner) <= bboxRight(outer) + slopX &&
    bboxBottom(inner) <= bboxBottom(outer) + slopY
  );
}

/** "How fully contained is inner within outer", 1.0 = fully inside the
 *  inner 95% of outer; 0 = fully outside. */
function containmentScore(outer: Bbox, inner: Bbox): number {
  // Compute how far outside the outer's edges the inner bbox extends, as
  // a fraction of the outer's dimensions. Sum the four overhangs.
  const leftOverhang = Math.max(0, outer.x - inner.x);
  const topOverhang = Math.max(0, outer.y - inner.y);
  const rightOverhang = Math.max(0, bboxRight(inner) - bboxRight(outer));
  const bottomOverhang = Math.max(0, bboxBottom(inner) - bboxBottom(outer));
  const totalHorizontal = (leftOverhang + rightOverhang) / Math.max(outer.w, 1);
  const totalVertical = (topOverhang + bottomOverhang) / Math.max(outer.h, 1);
  // Each axis can contribute up to 0.5 of the score's loss; clamp.
  const loss = Math.min(1, totalHorizontal + totalVertical);
  return 1 - loss;
}

function bboxesOverlap(a: Bbox, b: Bbox): boolean {
  return !(
    bboxRight(a) <= b.x ||
    bboxRight(b) <= a.x ||
    bboxBottom(a) <= b.y ||
    bboxBottom(b) <= a.y
  );
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// ============================================================================
// Per-relation tests
// ============================================================================

/** A.bbox fully contains B.bbox (with epsilon tolerance). */
function isInside(a: PrimitiveOccurrence, b: PrimitiveOccurrence): boolean {
  return fullyContains(a.bbox, b.bbox, 0.05);
}

/** Concentric is a STRICTER form of inside: centroids close together AND
 *  bbox areas within ~30% of each other. Used for "binding-spell" style
 *  patterns (circle inscribed in pentagram of similar size). */
function concentricCheck(
  a: PrimitiveOccurrence,
  b: PrimitiveOccurrence,
): { ok: boolean; conf: number } {
  const aArea = bboxArea(a.bbox);
  const bArea = bboxArea(b.bbox);
  if (aArea === 0 || bArea === 0) return { ok: false, conf: 0 };
  const ratio = Math.min(aArea, bArea) / Math.max(aArea, bArea);
  // Hand-drawn "concentric" pairs can have area ratios as low as ~0.4
  // (one circle distinctly bigger than the other but both clearly the
  // same intent). Tighter than 0.4 falls into "inside" not "concentric".
  if (ratio < 0.4) return { ok: false, conf: 0 };
  // Centroids within 25% of the smaller bbox's diagonal.
  const minDiag = Math.hypot(
    Math.min(a.bbox.w, b.bbox.w),
    Math.min(a.bbox.h, b.bbox.h),
  );
  const centroidGap = distance(a.centroid, b.centroid);
  const allowedGap = 0.25 * minDiag;
  if (centroidGap > allowedGap) return { ok: false, conf: 0 };
  // Confidence weights size match + centroid match equally.
  const sizeConf = (ratio - 0.4) / 0.6; // 0 at 40%, 1 at 100%
  const centerConf = 1 - centroidGap / allowedGap;
  return { ok: true, conf: 0.5 * sizeConf + 0.5 * centerConf };
}

/** A's stroke passes through B's centroid AND extends to BOTH sides of
 *  B's bbox. Distinguishes "line bisecting circle" from "line that just
 *  ends inside the circle" (still inside, not bisecting). */
function bisectingCheck(
  a: PrimitiveOccurrence,
  b: PrimitiveOccurrence,
): { ok: boolean; conf: number } {
  if (a.resampledPoints.length < 2) return { ok: false, conf: 0 };
  // (1) Some sample of A's stroke must come close to B's centroid.
  const tolerance = 0.15 * Math.min(b.bbox.w, b.bbox.h);
  let minDist = Infinity;
  for (const p of a.resampledPoints) {
    const d = distance(p, b.centroid);
    if (d < minDist) minDist = d;
  }
  if (minDist > tolerance) return { ok: false, conf: 0 };
  const passThroughConf = 1 - minDist / tolerance;
  // (2) A's bbox must extend on BOTH sides of B's bbox along A's primary
  // axis. Pick the axis (h vs v) by A's longer bbox dimension.
  const axisIsHorizontal = a.bbox.w >= a.bbox.h;
  if (axisIsHorizontal) {
    const aMin = a.bbox.x;
    const aMax = bboxRight(a.bbox);
    const bMin = b.bbox.x;
    const bMax = bboxRight(b.bbox);
    if (aMin >= bMin || aMax <= bMax) return { ok: false, conf: 0 };
    // Confidence: how far A extends past B on each side, normalized by B's width.
    const leftExtend = (bMin - aMin) / Math.max(b.bbox.w, 1);
    const rightExtend = (aMax - bMax) / Math.max(b.bbox.w, 1);
    const extendConf = Math.min(1, Math.min(leftExtend, rightExtend) / 0.25);
    return { ok: true, conf: 0.5 * passThroughConf + 0.5 * extendConf };
  } else {
    const aMin = a.bbox.y;
    const aMax = bboxBottom(a.bbox);
    const bMin = b.bbox.y;
    const bMax = bboxBottom(b.bbox);
    if (aMin >= bMin || aMax <= bMax) return { ok: false, conf: 0 };
    const topExtend = (bMin - aMin) / Math.max(b.bbox.h, 1);
    const bottomExtend = (aMax - bMax) / Math.max(b.bbox.h, 1);
    const extendConf = Math.min(1, Math.min(topExtend, bottomExtend) / 0.25);
    return { ok: true, conf: 0.5 * passThroughConf + 0.5 * extendConf };
  }
}

/** Adjacency in a cardinal direction: bboxes don't overlap, B is in the
 *  named direction relative to A, with at least 50% perpendicular range
 *  overlap. */
function adjacencyDirection(
  a: PrimitiveOccurrence,
  b: PrimitiveOccurrence,
): {
  dir: 'above' | 'below' | 'left' | 'right' | null;
  conf: number;
} {
  if (bboxesOverlap(a.bbox, b.bbox)) return { dir: null, conf: 0 };

  const bAbove = bboxBottom(b.bbox) <= a.bbox.y;
  const bBelow = b.bbox.y >= bboxBottom(a.bbox);
  const bLeft = bboxRight(b.bbox) <= a.bbox.x;
  const bRight = b.bbox.x >= bboxRight(a.bbox);

  // Range overlap on the perpendicular axis.
  let dir: 'above' | 'below' | 'left' | 'right' | null = null;
  let perpOverlap = 0;
  let perpDenom = 1;
  let gap = 0;
  let parallel = 1;

  if (bAbove || bBelow) {
    const xLo = Math.max(a.bbox.x, b.bbox.x);
    const xHi = Math.min(bboxRight(a.bbox), bboxRight(b.bbox));
    perpOverlap = Math.max(0, xHi - xLo);
    perpDenom = Math.min(a.bbox.w, b.bbox.w);
    gap = bAbove ? a.bbox.y - bboxBottom(b.bbox) : b.bbox.y - bboxBottom(a.bbox);
    parallel = Math.min(a.bbox.h, b.bbox.h);
    dir = bAbove ? 'above' : 'below';
  } else if (bLeft || bRight) {
    const yLo = Math.max(a.bbox.y, b.bbox.y);
    const yHi = Math.min(bboxBottom(a.bbox), bboxBottom(b.bbox));
    perpOverlap = Math.max(0, yHi - yLo);
    perpDenom = Math.min(a.bbox.h, b.bbox.h);
    gap = bLeft ? a.bbox.x - bboxRight(b.bbox) : b.bbox.x - bboxRight(a.bbox);
    parallel = Math.min(a.bbox.w, b.bbox.w);
    dir = bLeft ? 'left' : 'right';
  }

  if (!dir) return { dir: null, conf: 0 };
  const overlapFrac = perpDenom > 0 ? perpOverlap / perpDenom : 0;
  if (overlapFrac < 0.5) return { dir: null, conf: 0 };
  // Adjacent only if the gap between them is < 1 unit of the perpendicular
  // dimension; bigger gap → call it disjoint.
  if (parallel > 0 && gap > parallel * 1.0) return { dir: null, conf: 0 };
  // Confidence: perpendicular overlap fraction × tightness of adjacency.
  const tightness = parallel > 0 ? 1 - Math.min(1, gap / parallel) : 0;
  return { dir, conf: 0.5 * overlapFrac + 0.5 * tightness };
}

// ============================================================================
// Top-level relation function
// ============================================================================

/** Determine the most specific spatial relation from A to B. The relation
 *  is asymmetric — `relate(a, b)` may differ from `relate(b, a)` (e.g.,
 *  inside is directional). */
export function relate(
  a: PrimitiveOccurrence,
  b: PrimitiveOccurrence,
): RelationResult {
  // Bisecting first: A is a stroke passing through B. This is asymmetric
  // and overrides plain "intersecting" when both bboxes overlap.
  const bisecting = bisectingCheck(a, b);
  if (bisecting.ok) {
    return { relation: 'bisecting', confidence: bisecting.conf };
  }

  // Concentric is a special case of inside — check before plain inside so
  // it wins when both apply.
  if (isInside(a, b) || isInside(b, a)) {
    // Pick the direction (a contains b, or b contains a) for concentric/inside.
    const containerInner = isInside(a, b) ? { o: a, i: b } : { o: b, i: a };
    const conc = concentricCheck(containerInner.o, containerInner.i);
    if (conc.ok) {
      return { relation: 'concentric', confidence: conc.conf };
    }
    // Plain inside — confidence by how cleanly contained.
    const conf = containmentScore(containerInner.o.bbox, containerInner.i.bbox);
    return { relation: 'inside', confidence: conf };
  }

  // Bboxes overlap but neither contains the other → intersecting.
  if (bboxesOverlap(a.bbox, b.bbox)) {
    return { relation: 'intersecting', confidence: 0.7 };
  }

  // Adjacency.
  const adj = adjacencyDirection(a, b);
  if (adj.dir) {
    return {
      relation: `adjacent-${adj.dir}` as Relation,
      confidence: adj.conf,
    };
  }

  // Fallthrough — too far apart for adjacency, no overlap.
  return { relation: 'disjoint', confidence: 1 };
}

// ============================================================================
// Helper: build a PrimitiveOccurrence from raw stroke data
// ============================================================================

/** Convenience constructor — compute bbox + centroid from a point cloud. */
export function makeOccurrence(
  classId: string,
  resampledPoints: readonly NormalizedPoint[],
  index: number,
): PrimitiveOccurrence {
  if (resampledPoints.length === 0) {
    return {
      classId,
      bbox: { x: 0, y: 0, w: 0, h: 0 },
      centroid: { x: 0, y: 0 },
      resampledPoints,
      index,
    };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let sx = 0;
  let sy = 0;
  for (const p of resampledPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    sx += p.x;
    sy += p.y;
  }
  return {
    classId,
    bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    centroid: { x: sx / resampledPoints.length, y: sy / resampledPoints.length },
    resampledPoints,
    index,
  };
}
