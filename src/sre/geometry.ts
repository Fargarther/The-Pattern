// Pure geometry / math helpers for feature extraction.
// No dependencies on the rest of the SRE — these are reusable primitives.

import type { NormalizedPoint } from './types.js';

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  diagonal: number;
}

export function distance(a: NormalizedPoint, b: NormalizedPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function pathLength(points: readonly NormalizedPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1]!, points[i]!);
  }
  return total;
}

export function computeBbox(points: readonly NormalizedPoint[]): BBox {
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
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, diagonal: 0 };
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return { minX, minY, maxX, maxY, width, height, diagonal: Math.hypot(width, height) };
}

/**
 * Signed turning angle from vector v1 to vector v2, in radians, in (-π, π].
 * Positive = counter-clockwise (in screen space where +y is down, this is visually
 * clockwise; the recognizer doesn't care about handedness, only magnitudes).
 */
export function signedAngleBetween(
  v1: { x: number; y: number },
  v2: { x: number; y: number },
): number {
  const dot = v1.x * v2.x + v1.y * v2.y;
  const cross = v1.x * v2.y - v1.y * v2.x;
  return Math.atan2(cross, dot);
}

/**
 * Compute the per-vertex turning angle for a polyline.
 *
 * Returns an array of the same length as `points`, where `out[i]` is the signed
 * turning angle at `points[i]`. For a smooth curve this is small; at a corner
 * it spikes.
 *
 * If `treatAsClosed` is true, the array uses circular indexing — `out[0]` and
 * `out[n-1]` measure the wraparound turn between the last and first segments
 * (so a closed triangle contributes turn at all three corners).
 *
 * If `treatAsClosed` is false, `out[0]` and `out[n-1]` are 0 (those points only
 * have one neighbour, no turn defined).
 */
export function turningAngles(
  points: readonly NormalizedPoint[],
  treatAsClosed = false,
): number[] {
  const n = points.length;
  const out: number[] = new Array(n).fill(0);
  if (n < 3) return out;

  // In closed mode, drop the last point. This handles two cases uniformly:
  //   - Exact seam (cloud[n-1] == cloud[0], from resampleToN on an exactly
  //     closed stroke): drop the duplicate; the wraparound corner is then
  //     correctly computed at workingPoints[0].
  //   - Approximate seam (cloud[n-1] near cloud[0], a real player who didn't
  //     close perfectly): drop the seam-offset point. The closing chord
  //     becomes workingPoints[n-2] → workingPoints[0], which is roughly
  //     tangent and doesn't create a spurious corner the way the original
  //     short closure chord did.
  let workingPoints: readonly NormalizedPoint[] = points;
  let workingN = n;
  if (treatAsClosed && n >= 4) {
    workingPoints = points.slice(0, -1);
    workingN = n - 1;
  }

  for (let i = 0; i < workingN; i++) {
    let aIdx: number;
    let cIdx: number;

    if (treatAsClosed) {
      aIdx = (i - 1 + workingN) % workingN;
      cIdx = (i + 1) % workingN;
    } else {
      if (i === 0 || i === workingN - 1) continue;
      aIdx = i - 1;
      cIdx = i + 1;
    }

    const a = workingPoints[aIdx]!;
    const b = workingPoints[i]!;
    const c = workingPoints[cIdx]!;
    const v1 = { x: b.x - a.x, y: b.y - a.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    if ((v1.x === 0 && v1.y === 0) || (v2.x === 0 && v2.y === 0)) {
      out[i] = 0;
    } else {
      out[i] = signedAngleBetween(v1, v2);
    }
  }
  return out;
}

/**
 * Sum each value with its `radius` neighbours on either side.
 *
 * Split-corner artifacts (a 36° turn divided 18/18 across adjacent samples
 * because the corner falls between resampling points) get reunified by
 * windowSum: the 3-sample window around the split sums to the original
 * 36°, crossing the corner-detection threshold again.
 *
 * `wrap = true` walks circularly across the seam — appropriate for closed
 * shapes. `wrap = false` clamps at the boundaries (open shapes).
 */
export function windowSum(
  values: readonly number[],
  radius: number,
  wrap: boolean,
): number[] {
  const n = values.length;
  if (n === 0) return [];
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -radius; k <= radius; k++) {
      let idx = i + k;
      if (wrap) {
        idx = ((idx % n) + n) % n;
      } else {
        if (idx < 0 || idx >= n) continue;
      }
      s += values[idx]!;
    }
    out[i] = s;
  }
  return out;
}

/**
 * 1D Gaussian smoothing with reflective boundary handling.
 *
 * Kernel half-width is ⌈3σ⌉ (captures ~99.7% of the Gaussian's mass).
 * For very short input arrays we shrink the kernel to fit.
 */
export function gaussianSmooth(values: readonly number[], sigma: number): number[] {
  if (values.length === 0) return [];
  if (sigma <= 0) return values.slice();

  const half = Math.max(1, Math.ceil(sigma * 3));
  const kernel: number[] = [];
  let kSum = 0;
  for (let i = -half; i <= half; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(w);
    kSum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] = kernel[i]! / kSum;

  const out: number[] = new Array(values.length);
  const n = values.length;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -half; k <= half; k++) {
      let idx = i + k;
      // Reflect at boundaries.
      if (idx < 0) idx = -idx;
      if (idx >= n) idx = 2 * n - idx - 2;
      idx = Math.max(0, Math.min(n - 1, idx));
      s += values[idx]! * kernel[k + half]!;
    }
    out[i] = s;
  }
  return out;
}

/**
 * Find polygon-vertex corners on a turning-angle signal using three gates:
 *
 *   1. **Local max** — the candidate must equal-or-exceed both immediate
 *      neighbors. Filters out monotonic ramps (curves) where every sample
 *      contributes some turn but no individual sample is locally distinct.
 *
 *   2. **Windowed sum ≥ windowSumThreshold** — the total |angle| within a
 *      (2·windowHalfWidth+1)-sample window must exceed `windowSumThreshold`.
 *      A sharp corner concentrates ~one corner-angle worth of turn (45°
 *      for an octagon, 60° for a hexagon) into 1–3 samples; a slightly-
 *      rounded corner spreads the same total across 4–5 samples. The
 *      windowed sum catches both, while a stand-alone wobble of 25° within
 *      otherwise-smooth turn falls below this gate.
 *
 *   3. **Baseline-sample count ≥ minBaselineSamples** — at least this many
 *      samples in the window must lie below `peak / 2`. Real corners sit
 *      in a low-magnitude baseline (≥2 of the 4 non-center samples are
 *      well below the peak); sustained-moderate-turn curve segments don't
 *      have that baseline (most window samples are close to the peak).
 *      Robust to ADJACENT real corners — only the high-magnitude neighbor
 *      gets excluded from the baseline count, the rest of the baseline
 *      remains. (Earlier "peak/window-mean" formulation double-counted
 *      adjacent corners as background, dragging down legitimate corners.)
 *
 * Candidates ranked by windowed sum desc; greedy NMS within `minSpacing`.
 *
 * Replaces the older single-sample threshold approach (May 2026 tuning):
 * a slightly-rounded octagon corner whose peak landed at 22° was being
 * missed by the old 22.5° threshold. The windowed sum on that same corner
 * is 39° and the concentration ratio is 2.8, so it now passes cleanly.
 */
export function findCornerPeaks(
  values: readonly number[],
  options: {
    rawThreshold: number;
    windowSumThreshold: number;
    minBaselineSamples: number;
    minSpacing: number;
    isClosed: boolean;
    windowHalfWidth?: number;
  },
): number[] {
  const {
    rawThreshold,
    windowSumThreshold,
    minBaselineSamples,
    minSpacing,
    isClosed,
    windowHalfWidth = 2,
  } = options;
  const n = values.length;
  if (n === 0) return [];

  const wrap = (i: number) => ((i % n) + n) % n;

  const candidates: { idx: number; mag: number }[] = [];
  for (let i = 0; i < n; i++) {
    const v = Math.abs(values[i]!);
    if (v < rawThreshold) continue;

    // Local-max check (>= so flat ties don't drop both samples).
    let prev: number;
    let next: number;
    if (isClosed) {
      prev = Math.abs(values[wrap(i - 1)]!);
      next = Math.abs(values[wrap(i + 1)]!);
    } else {
      prev = i > 0 ? Math.abs(values[i - 1]!) : 0;
      next = i < n - 1 ? Math.abs(values[i + 1]!) : 0;
    }
    if (v < prev || v < next) continue;

    // Windowed sum + baseline-sample count. We want both the total turn
    // within the window and confirmation that the peak sits above an
    // identifiable LOW-magnitude baseline (real corners have one), rather
    // than in the middle of a sustained-moderate-turn region (curves).
    let sum = 0;
    let baselineCount = 0;
    const halfPeak = v / 2;
    for (let k = -windowHalfWidth; k <= windowHalfWidth; k++) {
      let idx = i + k;
      if (isClosed) {
        idx = wrap(idx);
      } else if (idx < 0 || idx >= n) {
        continue;
      }
      const sample = Math.abs(values[idx]!);
      sum += sample;
      if (k !== 0 && sample < halfPeak) baselineCount++;
    }
    if (sum < windowSumThreshold) continue;
    if (baselineCount < minBaselineSamples) continue;

    // Rank by single-sample peak (NOT windowed sum). Adjacent corners
    // share their windows, so windowed-sum ties between very-different
    // peak strengths happen often (e.g., a 176° spike next to a 53° corner
    // both sum to ~234° because each window includes the other corner).
    // Ranking by peak ensures the genuinely-sharper corner wins NMS.
    candidates.push({ idx: i, mag: v });
  }

  // Rank by single-sample peak descending, with idx tiebreak.
  candidates.sort((a, b) => {
    const diff = b.mag - a.mag;
    if (Math.abs(diff) < 1e-9) return a.idx - b.idx;
    return diff;
  });

  const accepted: number[] = [];
  const taken = new Array(n).fill(false);
  for (const c of candidates) {
    let blocked = false;
    // For closed shapes also check wraparound spacing — corners at i=0 and
    // i=n-1 are adjacent on the closed contour, not far apart.
    for (let off = -minSpacing; off <= minSpacing; off++) {
      const j = isClosed ? wrap(c.idx + off) : c.idx + off;
      if (j < 0 || j >= n) continue;
      if (taken[j]) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      accepted.push(c.idx);
      taken[c.idx] = true;
    }
  }
  accepted.sort((a, b) => a - b);
  return accepted;
}

/**
 * Find peaks in a 1D signal: indices where |values[i]| exceeds threshold AND is
 * a local maximum within a window of ±minSpacing samples (non-max suppression).
 *
 * Used on the smoothed turning-angle signal to detect corners.
 *
 * @deprecated Use `findCornerPeaks` for shape-recognition corner detection.
 * Retained for callers that need the simpler magnitude-only peak finder.
 */
export function findPeaks(
  values: readonly number[],
  threshold: number,
  minSpacing: number,
): number[] {
  const candidates: { idx: number; mag: number }[] = [];
  for (let i = 0; i < values.length; i++) {
    if (Math.abs(values[i]!) >= threshold) {
      candidates.push({ idx: i, mag: Math.abs(values[i]!) });
    }
  }
  // Sort by magnitude descending. For near-ties (FP epsilon differences when
  // window-sums of equal corners differ in the last bit), prefer the EARLIER
  // index — otherwise NMS can suppress two real corners adjacent to the
  // arbitrarily-picked tie-winner.
  candidates.sort((a, b) => {
    const diff = b.mag - a.mag;
    if (Math.abs(diff) < 1e-9) return a.idx - b.idx;
    return diff;
  });

  const accepted: number[] = [];
  const taken = new Array(values.length).fill(false);
  for (const c of candidates) {
    let blocked = false;
    for (let j = Math.max(0, c.idx - minSpacing); j <= Math.min(values.length - 1, c.idx + minSpacing); j++) {
      if (taken[j]) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      accepted.push(c.idx);
      taken[c.idx] = true;
    }
  }
  accepted.sort((a, b) => a - b);
  return accepted;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function stdev(values: readonly number[], precomputedMean?: number): number {
  if (values.length === 0) return 0;
  const m = precomputedMean ?? mean(values);
  let s = 0;
  for (const v of values) {
    const d = v - m;
    s += d * d;
  }
  return Math.sqrt(s / values.length);
}

/**
 * Reflect a point cloud across a horizontal (y = mean_y) or vertical (x = mean_x)
 * axis through the centroid, then return the average nearest-neighbour distance
 * between original and reflected points, normalized by bbox diagonal. 0 = perfect
 * mirror symmetry; higher values mean less symmetric.
 *
 * Uses brute-force O(n²) nearest-neighbour matching — fine for n=64.
 */
export function reflectionError(
  points: readonly NormalizedPoint[],
  axis: 'horizontal' | 'vertical',
): number {
  if (points.length === 0) return 0;
  const bb = computeBbox(points);
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;

  const reflected = points.map((p) =>
    axis === 'horizontal' ? { x: p.x, y: 2 * cy - p.y } : { x: 2 * cx - p.x, y: p.y },
  );

  let totalNN = 0;
  for (const r of reflected) {
    let best = Infinity;
    for (const p of points) {
      const d = distance(r, p);
      if (d < best) best = d;
    }
    totalNN += best;
  }
  const avg = totalNN / points.length;
  return bb.diagonal > 0 ? avg / bb.diagonal : 0;
}

/**
 * Rotate a point cloud by `angleRad` around the bbox center, then return the
 * average nearest-neighbour distance to the original. Used to test rotational
 * symmetry — for example, π/2 (90°) checks 4-fold symmetry; π/3 checks 6-fold.
 */
export function rotationalError(
  points: readonly NormalizedPoint[],
  angleRad: number,
): number {
  if (points.length === 0) return 0;
  const bb = computeBbox(points);
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  const rotated = points.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  });

  let totalNN = 0;
  for (const r of rotated) {
    let best = Infinity;
    for (const p of points) {
      const d = distance(r, p);
      if (d < best) best = d;
    }
    totalNN += best;
  }
  const avg = totalNN / points.length;
  return bb.diagonal > 0 ? avg / bb.diagonal : 0;
}
