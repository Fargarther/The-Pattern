// Preprocessing pipeline: 1€ filter -> resample -> translate-to-origin.
// Spec: sre-phase1-geometric-recognizer-spec.md §2.
//
// Note: we do NOT scale-normalize here. Aspect ratio is a discriminator
// (square vs. rectangle, rhombus vs. diamond), so the recognizer needs
// the raw geometry preserved.

import type { NormalizedPoint, NormalizedStroke, RawPoint, Stroke } from './types.js';
import { SRE_TUNING } from './types.js';
import { applyOneEuroFilter, pickOneEuroPreset } from './one-euro-filter.js';

function distance(a: NormalizedPoint, b: NormalizedPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pathLength(points: readonly NormalizedPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1]!, points[i]!);
  }
  return total;
}

/**
 * Resample a polyline to exactly N evenly-spaced points along its arc length.
 *
 * Walks the polyline, dropping a sample every `interval = totalLength / (N - 1)` units.
 * The first sample is always the first input point; the last is always the last input
 * point (or padded with the last point if floating-point error leaves us short).
 *
 * Degenerate cases:
 *   - Empty input: returns N copies of {0, 0}.
 *   - Single point or zero-length path: returns N copies of that point.
 */
export function resampleToN(
  points: readonly NormalizedPoint[],
  n: number,
): NormalizedPoint[] {
  if (n < 2) throw new Error(`resampleToN requires n >= 2 (got ${n})`);

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

  // `cursor` is the current position along the path — starts as the first input point
  // and advances as we walk segments. When we've accumulated `interval` units since the
  // last emitted sample, we drop a new sample at `cursor` and continue from there.
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
      // Don't advance i; the rest of the original segment still remains.
    } else {
      accumulated += segLen;
      cursor = { x: next.x, y: next.y };
      i++;
    }

    if (out.length >= n) break;
  }

  // Pad with the last input point in case of floating-point shortfall.
  const last = points[points.length - 1]!;
  while (out.length < n) {
    out.push({ x: last.x, y: last.y });
  }

  return out.slice(0, n);
}

function rawToNormalized(p: RawPoint): NormalizedPoint {
  return { x: p.x, y: p.y };
}

function centroid(points: readonly NormalizedPoint[]): NormalizedPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

/**
 * Translate a point cloud so its centroid sits at the origin. No scaling.
 */
export function translateToOrigin(
  points: readonly NormalizedPoint[],
): NormalizedPoint[] {
  const c = centroid(points);
  return points.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
}

/**
 * End-to-end preprocessing for one or more strokes:
 *
 *   1. Concatenate strokes into one polyline (Phase 1 treats multistroke shapes
 *      as one virtual stroke; the rule-based recognizers don't care about stroke
 *      boundaries).
 *   2. Apply 1€ filter for jitter smoothing.
 *   3. Resample to N points along arc length (default N=64).
 *   4. Translate so the centroid sits at the origin. NO scaling — aspect ratio
 *      must survive into feature extraction.
 *
 * `raw` is the smoothed-but-not-resampled stream, kept around for the Phase 2
 * $Q fallback which needs richer point data.
 */
export function preprocessStrokes(strokes: readonly Stroke[]): NormalizedStroke {
  if (strokes.length === 0) {
    throw new Error('preprocessStrokes requires at least one stroke');
  }

  const concatenatedRaw: RawPoint[] = strokes.flatMap((s) => s.points);
  if (concatenatedRaw.length === 0) {
    throw new Error('preprocessStrokes requires at least one point across all strokes');
  }

  const config = pickOneEuroPreset(strokes[0]!.pointerType);
  const smoothedRaw = applyOneEuroFilter(concatenatedRaw, config);

  const polyline = smoothedRaw.map(rawToNormalized);
  const resampled = resampleToN(polyline, SRE_TUNING.RESAMPLE_POINTS);
  const centered = translateToOrigin(resampled);

  return { points: centered, raw: smoothedRaw };
}
