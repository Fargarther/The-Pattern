// Multistroke recognition: shapes drawn with multiple separate strokes that
// concatenation can't reconstruct geometrically.
//
// The canonical case: a plus sign drawn as a horizontal line + a vertical
// line. Concatenating them produces a polyline with a virtual jump between
// strokes, which doesn't match the 12-vertex plus silhouette my single-
// stroke recognizer expects. So multistroke recognition operates on the
// strokes individually — detect each as a line, then test whether they
// form a recognized cross-pattern.
//
// Wired into composite.ts: when a stroke group has multiple strokes, the
// composite parser tries multistroke recognizers first; if none fire, it
// falls back to concatenate-and-run-single-stroke-recognition.

import type { NormalizedPoint, Stroke } from './types.js';

export interface LineInfo {
  start: NormalizedPoint;
  end: NormalizedPoint;
  /** Unit vector along the line direction (start → end). */
  dir: NormalizedPoint;
  /** Distance from start to end. */
  length: number;
  /** Midpoint of the line segment. */
  mid: NormalizedPoint;
}

/** Determine whether a stroke is "approximately a straight line" by checking
 * how far each interior point deviates from the line connecting the
 * endpoints. Returns null if not straight enough.
 *
 * `straightnessTolerance` is the max-allowed perpendicular deviation as a
 * fraction of the line length. 0.08 = points within 8% of the length on
 * either side of the endpoint-to-endpoint line; loose enough for hand-drawn
 * variation, tight enough to reject curves and arcs.
 */
export function analyzeStrokeAsLine(
  stroke: Stroke,
  straightnessTolerance = 0.1,
): LineInfo | null {
  const pts = stroke.points;
  if (pts.length < 2) return null;
  const start = { x: pts[0]!.x, y: pts[0]!.y };
  const end = { x: pts[pts.length - 1]!.x, y: pts[pts.length - 1]!.y };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 5) return null;
  const dir: NormalizedPoint = { x: dx / length, y: dy / length };

  // Max perpendicular deviation from the start-end line.
  let maxDev = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const px = pts[i]!.x - start.x;
    const py = pts[i]!.y - start.y;
    // Perpendicular distance = |cross of (point - start) and dir|
    const dev = Math.abs(px * dir.y - py * dir.x);
    if (dev > maxDev) maxDev = dev;
  }
  if (maxDev / length > straightnessTolerance) return null;

  return {
    start,
    end,
    dir,
    length,
    mid: { x: start.x + dx / 2, y: start.y + dy / 2 },
  };
}

export interface SegmentIntersection {
  point: NormalizedPoint;
  /** Parameter along segment a (0 = a.start, 1 = a.end). */
  tA: number;
  /** Parameter along segment b. */
  tB: number;
}

/** Test whether two line segments cross within their bounds. Returns the
 * intersection point + parametric positions on each segment, or null if
 * they don't cross (parallel, or only meet outside one segment's range).
 */
export function segmentIntersection(
  a0: NormalizedPoint,
  a1: NormalizedPoint,
  b0: NormalizedPoint,
  b1: NormalizedPoint,
): SegmentIntersection | null {
  const adx = a1.x - a0.x;
  const ady = a1.y - a0.y;
  const bdx = b1.x - b0.x;
  const bdy = b1.y - b0.y;
  const denom = adx * bdy - ady * bdx;
  if (Math.abs(denom) < 1e-9) return null; // parallel

  const sx = b0.x - a0.x;
  const sy = b0.y - a0.y;
  const tA = (sx * bdy - sy * bdx) / denom;
  const tB = (sx * ady - sy * adx) / denom;
  if (tA < 0 || tA > 1 || tB < 0 || tB > 1) return null;

  return {
    point: { x: a0.x + tA * adx, y: a0.y + tA * ady },
    tA,
    tB,
  };
}

/** Angle (in radians) between two unit vectors, in [0, π]. */
function angleBetween(a: NormalizedPoint, b: NormalizedPoint): number {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y));
  return Math.acos(Math.abs(dot)); // |dot| folds direction reversal
}

export interface MultistrokeMatch {
  shape: 'plusSign' | 'arrow';
  confidence: number;
  /** Where the strokes cross (for plus/cross). */
  intersection?: NormalizedPoint;
  /** Bounding box of all strokes. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

function strokesBbox(strokes: readonly Stroke[]): MultistrokeMatch['bbox'] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, maxX, minY, maxY };
}

/** Recognize a plus sign drawn as two crossed straight lines. The
 * dictionary's "Plus Sign" and "Cross" are geometrically identical for
 * Phase 1, so we report `plusSign` and let downstream code map the
 * semantic label.
 *
 * Conditions:
 *   - exactly 2 strokes
 *   - each stroke is a straight line
 *   - the lines cross at ~90° (within ±15°)
 *   - the crossing point is near the midpoint of both lines (so it's a +
 *     and not a T-junction or L-shape)
 *   - the lines are roughly equal length (so it's symmetric, not lopsided)
 */
export function recognizeMultistrokePlus(strokes: readonly Stroke[]): MultistrokeMatch | null {
  if (strokes.length !== 2) return null;
  const a = analyzeStrokeAsLine(strokes[0]!);
  const b = analyzeStrokeAsLine(strokes[1]!);
  if (!a || !b) return null;

  // Lines must cross at ~90° (within ±15°)
  const angle = angleBetween(a.dir, b.dir);
  const fromPerp = Math.abs(angle - Math.PI / 2);
  if (fromPerp > Math.PI / 12) return null;

  const cross = segmentIntersection(a.start, a.end, b.start, b.end);
  if (!cross) return null;

  // Cross point should be near each line's midpoint (within 30% of length
  // from center, i.e. tA, tB ∈ [0.2, 0.8]).
  if (cross.tA < 0.2 || cross.tA > 0.8) return null;
  if (cross.tB < 0.2 || cross.tB > 0.8) return null;

  // Lines should be roughly equal length (within 50%)
  const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  if (ratio < 0.5) return null;

  // Confidence rises with how perpendicular and how center-aligned the
  // crossing is.
  const perpScore = 1 - fromPerp / (Math.PI / 12);
  const centerA = 1 - Math.abs(cross.tA - 0.5) * 2;
  const centerB = 1 - Math.abs(cross.tB - 0.5) * 2;
  const centerScore = (centerA + centerB) / 2;
  const lengthScore = ratio;
  const confidence = Math.max(
    0,
    Math.min(0.95, 0.5 + 0.2 * perpScore + 0.15 * centerScore + 0.15 * lengthScore),
  );

  return {
    shape: 'plusSign',
    confidence,
    intersection: cross.point,
    bbox: strokesBbox(strokes),
  };
}

/** Find the point that's an endpoint of the most strokes — useful for
 * detecting "rays from a center" patterns like a 4-arm plus. */
function findCommonEndpoint(
  lines: readonly LineInfo[],
  tolerance: number,
): { center: NormalizedPoint; matchCount: number } | null {
  if (lines.length === 0) return null;
  const candidates: NormalizedPoint[] = [];
  for (const l of lines) {
    candidates.push(l.start, l.end);
  }

  let best: NormalizedPoint | null = null;
  let bestCount = 0;
  for (const c of candidates) {
    let count = 0;
    for (const l of lines) {
      const dStart = Math.hypot(l.start.x - c.x, l.start.y - c.y);
      const dEnd = Math.hypot(l.end.x - c.x, l.end.y - c.y);
      if (Math.min(dStart, dEnd) < tolerance) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best ? { center: best, matchCount: bestCount } : null;
}

/** Recognize a plus drawn as 4 separate "arms" — 4 strokes that each have
 * one endpoint near a common center, with the OTHER endpoint at one of
 * the four cardinal directions (top/right/bottom/left, ~90° apart). */
export function recognizeMultistrokePlusFourArms(
  strokes: readonly Stroke[],
): MultistrokeMatch | null {
  if (strokes.length !== 4) return null;
  const lines = strokes.map((s) => analyzeStrokeAsLine(s));
  if (lines.some((l) => l === null)) return null;
  const validLines = lines as LineInfo[];

  // Common-endpoint tolerance scales with stroke length so a wide plus
  // doesn't fail on a small absolute pixel offset.
  const avgLen = validLines.reduce((s, l) => s + l.length, 0) / 4;
  const centerTolerance = avgLen * 0.2;

  const center = findCommonEndpoint(validLines, centerTolerance);
  if (!center || center.matchCount < 4) return null;

  // For each line, identify the OUTER endpoint (the one farther from center).
  const outerPoints: NormalizedPoint[] = validLines.map((l) => {
    const dStart = Math.hypot(l.start.x - center.center.x, l.start.y - center.center.y);
    const dEnd = Math.hypot(l.end.x - center.center.x, l.end.y - center.center.y);
    return dStart > dEnd ? l.start : l.end;
  });

  // Compute angle of each outer endpoint from center, then check that the
  // 4 angles are evenly distributed at ~90° apart.
  const angles = outerPoints
    .map((p) => Math.atan2(p.y - center.center.y, p.x - center.center.x))
    .sort((a, b) => a - b);
  let maxDiffOff = 0;
  for (let i = 0; i < 4; i++) {
    const next = angles[(i + 1) % 4]!;
    const cur = angles[i]!;
    let diff = next - cur;
    if (i === 3) diff += 2 * Math.PI; // wraparound
    maxDiffOff = Math.max(maxDiffOff, Math.abs(diff - Math.PI / 2));
  }
  if (maxDiffOff > Math.PI / 6) return null; // 30° tolerance per gap

  // Arm lengths roughly equal
  const lengths = validLines.map((l) => l.length);
  const minLen = Math.min(...lengths);
  const maxLen = Math.max(...lengths);
  if (minLen / maxLen < 0.5) return null;

  return {
    shape: 'plusSign',
    confidence: 0.85,
    intersection: center.center,
    bbox: strokesBbox(strokes),
  };
}

/** Try every multistroke recognizer in priority order. Returns the first
 * match. Order matters when multiple could fire — more specific (more
 * strokes, tighter constraints) wins. */
export function recognizeMultistroke(strokes: readonly Stroke[]): MultistrokeMatch | null {
  return (
    recognizeMultistrokePlusFourArms(strokes) ?? recognizeMultistrokePlus(strokes)
  );
}
