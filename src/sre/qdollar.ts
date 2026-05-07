// $Q: Super-Quick Articulation-Invariant Stroke-Gesture Recognizer.
// Vatavu, Anthony, Wobbrock — MobileHCI 2018.
// https://depts.washington.edu/acelab/proj/dollar/qdollar.html
//
// What this gives us beyond rule-based recognition:
//   - Iconic glyphs that don't have clean geometric definitions (heart,
//     star, tear, crescent, spiral, key, anchor, skull) — we recognize
//     them by template-matching against canonical examples.
//   - Articulation invariance: stroke order, direction, and count don't
//     matter. A heart drawn from the top vs. the bottom matches the same
//     template.
//
// Our cascade puts the rule-based geometric recognizers first; $Q is the
// fallback for shapes that the rules can't classify. That keeps geometric
// shapes (triangle, square, hexagon, etc.) deterministic and fast, and
// uses template matching only where it adds value.
//
// Implementation notes vs. the canonical paper:
//   - We use N=64 sample points (paper default is 32; 64 gives more
//     resolution for our iconic glyphs at minor cost — < 5 ms even with
//     50 templates on mid-range hardware).
//   - We omit the LUT lower-bound optimization. At our scale (10s of
//     templates) the basic O(N^2.5) cloud-match runs in under a frame
//     budget without it.

import type { NormalizedPoint } from './types.js';

/** Number of sample points per template / candidate. */
export const Q_N = 64;

/** Grid size for scaling normalized points before cloud-matching. */
const Q_M = 64;

/** Confidence-decay scale: distance at which `Math.exp(-d / SCALE)` ≈ 0.37.
 * Tuned so a perfect match (distance ≈ 0) → ~1.0, a typical wrong match
 * (distance > 100k) → ~0, a borderline match (distance ≈ 30k) → ~0.37. */
const CONFIDENCE_SCALE = 30000;

export interface QTemplate {
  /** Canonical name returned when this template matches. Maps to a
   * `ShapeName` in the SRE's type system. */
  name: string;
  /** Human-readable label for debugging. */
  label?: string;
  /** N points, already resampled + scaled to a Q_M × Q_M grid. */
  points: NormalizedPoint[];
}

export interface QMatch {
  template: QTemplate;
  /** Lower = better. A perfect self-match is 0. */
  distance: number;
  /** Mapped to [0, 1] via exponential decay so callers can treat it like
   * other recognizers' confidence values. */
  confidence: number;
}

// ============================================================================
// Preprocessing — turn a raw normalized cloud into the grid-scaled form $Q
// expects. Templates and candidates both run through this.
// ============================================================================

/** Scale a point cloud non-uniformly into a Q_M × Q_M grid. After this
 * step the cloud's bbox occupies the full grid, which is what $Q's cloud
 * distance assumes. The non-uniform scaling discards aspect ratio
 * deliberately — that's part of what makes $Q articulation-invariant.
 */
export function qScale(points: readonly NormalizedPoint[]): NormalizedPoint[] {
  if (points.length === 0) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const sx = w > 0 ? Q_M / w : 1;
  const sy = h > 0 ? Q_M / h : 1;
  return points.map((p) => ({ x: (p.x - minX) * sx, y: (p.y - minY) * sy }));
}

// ============================================================================
// Cloud distance — the heart of $Q. Greedy 1-to-1 assignment of candidate
// points to template points, weighted to emphasize the start of the walk.
// ============================================================================

function cloudDistance(
  cand: readonly NormalizedPoint[],
  tmpl: readonly NormalizedPoint[],
  start: number,
  minSoFar: number,
): number {
  const n = cand.length;
  const matched = new Array(n).fill(false);
  let i = start;
  let weight = n;
  let sum = 0;
  for (let k = 0; k < n; k++) {
    let bestJ = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue;
      const dx = cand[i]!.x - tmpl[j]!.x;
      const dy = cand[i]!.y - tmpl[j]!.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    if (bestJ < 0) break;
    matched[bestJ] = true;
    sum += weight * bestD;
    if (sum >= minSoFar) return sum; // early abandonment
    weight -= 1;
    i = (i + 1) % n;
  }
  return sum;
}

/** Match a candidate cloud against a single template. Tries ⌈√N⌉
 * starting indices spread evenly around the cycle (the paper's "Greedy-5"
 * trick) and returns the minimum cloud distance found. Bidirectional —
 * we also try the reverse pairing to catch direction-mirrored matches.
 */
export function cloudMatch(
  cand: readonly NormalizedPoint[],
  tmpl: readonly NormalizedPoint[],
): number {
  const n = cand.length;
  if (n === 0 || tmpl.length !== n) return Infinity;
  const numStarts = Math.max(1, Math.ceil(Math.sqrt(n)));
  const step = Math.max(1, Math.floor(n / numStarts));
  let best = Infinity;
  for (let s = 0; s < n; s += step) {
    const d1 = cloudDistance(cand, tmpl, s, best);
    if (d1 < best) best = d1;
    const d2 = cloudDistance(tmpl, cand, s, best);
    if (d2 < best) best = d2;
  }
  return best;
}

// ============================================================================
// Top-level: match a candidate against a template library.
// ============================================================================

/** Match a candidate cloud against a library of templates. Returns the
 * best-matching template + confidence, or null if the library is empty
 * or the candidate has too few points to be meaningful.
 *
 * The candidate is resampled to exactly Q_N points if it doesn't already
 * match — `cloudMatch` assumes equal-length clouds, so this normalizes
 * input from any source (preprocessed strokes, raw outlines, etc.).
 */
export function recognizeQ(
  candidate: readonly NormalizedPoint[],
  templates: readonly QTemplate[],
): QMatch | null {
  if (templates.length === 0) return null;
  if (candidate.length < 8) return null;
  const candResampled =
    candidate.length === Q_N ? candidate : qResample(candidate, Q_N);
  const candScaled = qScale(candResampled);
  let bestTmpl: QTemplate | null = null;
  let bestDist = Infinity;
  for (const t of templates) {
    const d = cloudMatch(candScaled, t.points);
    if (d < bestDist) {
      bestDist = d;
      bestTmpl = t;
    }
  }
  if (!bestTmpl) return null;
  return {
    template: bestTmpl,
    distance: bestDist,
    confidence: Math.max(0, Math.min(1, Math.exp(-bestDist / CONFIDENCE_SCALE))),
  };
}

// ============================================================================
// Helpers for building templates from raw vertex lists.
// ============================================================================

function distance(a: NormalizedPoint, b: NormalizedPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pathLength(pts: readonly NormalizedPoint[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += distance(pts[i - 1]!, pts[i]!);
  return total;
}

/** Resample a polyline to exactly N evenly-spaced points along arc length.
 * Mirrors the SRE's preprocessing.resampleToN but exposed here so template
 * authors can construct templates from raw vertex lists. */
export function qResample(
  points: readonly NormalizedPoint[],
  n: number = Q_N,
): NormalizedPoint[] {
  if (n < 2) throw new Error(`qResample needs n >= 2 (got ${n})`);
  if (points.length === 0) {
    return new Array(n).fill(null).map(() => ({ x: 0, y: 0 }));
  }
  const total = pathLength(points);
  if (points.length === 1 || total === 0) {
    const p = points[0]!;
    return new Array(n).fill(null).map(() => ({ x: p.x, y: p.y }));
  }
  const interval = total / (n - 1);
  const out: NormalizedPoint[] = [{ x: points[0]!.x, y: points[0]!.y }];
  let cursor: NormalizedPoint = { x: points[0]!.x, y: points[0]!.y };
  let accumulated = 0;
  let i = 1;
  while (i < points.length) {
    const next = points[i]!;
    const segLen = distance(cursor, next);
    if (accumulated + segLen >= interval && segLen > 0) {
      const t = (interval - accumulated) / segLen;
      const newPoint: NormalizedPoint = {
        x: cursor.x + t * (next.x - cursor.x),
        y: cursor.y + t * (next.y - cursor.y),
      };
      out.push(newPoint);
      cursor = newPoint;
      accumulated = 0;
    } else {
      accumulated += segLen;
      cursor = { x: next.x, y: next.y };
      i++;
    }
    if (out.length >= n) break;
  }
  const last = points[points.length - 1]!;
  while (out.length < n) out.push({ x: last.x, y: last.y });
  return out.slice(0, n);
}

/** Build a $Q template from a raw vertex list. Resamples to N points,
 * translates to centroid, then scales to the m×m grid — the same
 * preprocessing the recognizer applies to candidates. */
export function buildTemplate(
  name: string,
  vertices: readonly NormalizedPoint[],
  label?: string,
): QTemplate {
  const resampled = qResample(vertices, Q_N);
  // Translate to centroid (so scaling is symmetric)
  let cx = 0;
  let cy = 0;
  for (const p of resampled) {
    cx += p.x;
    cy += p.y;
  }
  cx /= resampled.length;
  cy /= resampled.length;
  const centered = resampled.map((p) => ({ x: p.x - cx, y: p.y - cy }));
  const scaled = qScale(centered);
  return { name, label, points: scaled };
}
