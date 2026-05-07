// Composite parser. Given a list of strokes drawn within one gesture window,
// determine which strokes belong to the same shape, detect nesting between
// shapes, and run recognition on each layer.
//
// This is the layer that enables the dictionary's modifier system:
// shape-inside-shape produces unit + adjective.
//
// Spec reference: sre-phase1-geometric-recognizer-spec.md is silent on
// composites (Phase 2 territory in the original plan), but the modifier
// system is core to the game design so we build a Phase-1-flavored
// composite parser now: pure geometric tests, no template matching.

import { extractFeatures } from './features.js';
import { computeBbox, type BBox } from './geometry.js';
import { recognizeMultistroke } from './multistroke.js';
import { preprocessStrokes } from './preprocessing.js';
import { recognize } from './recognize.js';
import type { NormalizedPoint, RecognitionResult, Stroke } from './types.js';

export interface StrokeGroup {
  /** Strokes belonging to this group (a single shape). */
  strokes: Stroke[];
  /** Bounding box of all points in the group, in raw input coords. */
  bbox: BBox;
}

export interface CompositeResult {
  /** All shape groups found, ordered outermost-first (largest bbox first).
   * Single-shape drawings produce a length-1 array. */
  groups: Array<{
    group: StrokeGroup;
    recognition: RecognitionResult;
  }>;
  /** True if exactly two groups were found AND one is contained in the other. */
  isNested: boolean;
  /** Index of the outer group (in `groups`) when nested. */
  outerIndex: number | null;
  /** Index of the inner group when nested. */
  innerIndex: number | null;
}

// ============================================================================
// Spatial grouping
// ============================================================================

function strokeBbox(s: Stroke): BBox {
  return computeBbox(s.points);
}

function bboxArea(b: BBox): number {
  return Math.max(0, b.width * b.height);
}

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
}

/** True if `inner` is strictly inside `outer` (with a small margin). Used by
 * the grouper to distinguish "overlapping = same shape drawn multistroke"
 * from "contained = inner glyph nested in outer container". Nested pairs
 * should NOT be merged into one group. */
function bboxStrictlyContains(outer: BBox, inner: BBox, marginRatio = 0.02): boolean {
  const m = marginRatio * outer.diagonal;
  return (
    inner.minX > outer.minX + m &&
    inner.maxX < outer.maxX - m &&
    inner.minY > outer.minY + m &&
    inner.maxY < outer.maxY - m
  );
}

function unionBbox(a: BBox, b: BBox): BBox {
  const minX = Math.min(a.minX, b.minX);
  const maxX = Math.max(a.maxX, b.maxX);
  const minY = Math.min(a.minY, b.minY);
  const maxY = Math.max(a.maxY, b.maxY);
  const width = maxX - minX;
  const height = maxY - minY;
  return { minX, maxX, minY, maxY, width, height, diagonal: Math.hypot(width, height) };
}

/** Group strokes that belong to the same shape.
 *
 * Heuristic: two strokes belong to the same shape if their bboxes are
 * "close" — overlapping OR within `proximityRatio × max(diag_a, diag_b)`
 * of each other. This handles both:
 *   - multistroke shapes (a triangle drawn as 3 lines that connect end-to-end)
 *   - drawing-pause artifacts (lifting the pen briefly during one shape)
 *
 * Strokes whose bboxes are clearly separated form distinct groups — that's
 * the composite case (an arrow drawn inside a shield, two separate clusters).
 */
export function groupStrokes(strokes: readonly Stroke[], proximityRatio = 0.15): StrokeGroup[] {
  if (strokes.length === 0) return [];

  const items = strokes.map((s) => ({ stroke: s, bbox: strokeBbox(s) }));

  // Union-find over strokes — merge any two whose bboxes are "close".
  const parent: number[] = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i]! !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const merge = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!.bbox;
      const b = items[j]!.bbox;
      // If one bbox strictly contains the other, treat as a nested composite —
      // do NOT merge. The bigger one is the outer container, the smaller is
      // the inner glyph. They're distinct shapes.
      if (bboxStrictlyContains(a, b) || bboxStrictlyContains(b, a)) continue;
      if (bboxesOverlap(a, b)) {
        merge(i, j);
        continue;
      }
      const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
      const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
      const gap = Math.hypot(dx, dy);
      const tolerance = proximityRatio * Math.max(a.diagonal, b.diagonal);
      if (gap < tolerance) merge(i, j);
    }
  }

  // Collect groups by root
  const buckets = new Map<number, StrokeGroup>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    const existing = buckets.get(root);
    if (existing) {
      existing.strokes.push(items[i]!.stroke);
      existing.bbox = unionBbox(existing.bbox, items[i]!.bbox);
    } else {
      buckets.set(root, {
        strokes: [items[i]!.stroke],
        bbox: items[i]!.bbox,
      });
    }
  }

  return [...buckets.values()];
}

// ============================================================================
// Containment detection
// ============================================================================

/** Standard ray-casting point-in-polygon test. Counts intersections of a
 * ray going +x from the point against the polygon edges; odd = inside. */
function pointInPolygon(p: NormalizedPoint, polygon: readonly NormalizedPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersects =
      pi.y > p.y !== pj.y > p.y &&
      p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y || 1e-9) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function bboxOf(b: BBox): { minX: number; minY: number; maxX: number; maxY: number } {
  return { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
}

function bboxContains(outer: BBox, inner: BBox, marginRatio = 0.05): boolean {
  const m = marginRatio * outer.diagonal;
  return (
    inner.minX >= outer.minX - m &&
    inner.maxX <= outer.maxX + m &&
    inner.minY >= outer.minY - m &&
    inner.maxY <= outer.maxY + m
  );
}

/** Test whether `inner` is geometrically nested inside `outer`.
 *
 * Uses a layered test:
 *   1. Bbox containment (cheap reject) — outer's bbox must enclose inner's.
 *   2. Area ratio gate — inner must be 5–55% the area of outer (excludes
 *      adjacent-but-not-nested and barely-different-size pairs).
 *   3. Centroid-in-polygon — inner's centroid must lie inside the polygon
 *      formed by all outer points (handles non-convex outer containers).
 */
export function isContainedIn(inner: StrokeGroup, outer: StrokeGroup): boolean {
  if (!bboxContains(outer.bbox, inner.bbox)) return false;

  const innerArea = bboxArea(inner.bbox);
  const outerArea = bboxArea(outer.bbox);
  if (outerArea === 0) return false;
  const ratio = innerArea / outerArea;
  if (ratio < 0.03 || ratio > 0.55) return false;

  const innerCentroid = strokeGroupCentroid(inner);
  const outerOutline = collectAllPoints(outer);
  return pointInPolygon(innerCentroid, outerOutline);
}

function strokeGroupCentroid(g: StrokeGroup): NormalizedPoint {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const s of g.strokes) {
    for (const p of s.points) {
      sx += p.x;
      sy += p.y;
      n++;
    }
  }
  if (n === 0) return { x: 0, y: 0 };
  return { x: sx / n, y: sy / n };
}

function collectAllPoints(g: StrokeGroup): NormalizedPoint[] {
  const out: NormalizedPoint[] = [];
  for (const s of g.strokes) for (const p of s.points) out.push({ x: p.x, y: p.y });
  return out;
}

// ============================================================================
// Composite recognition
// ============================================================================

/** Run the full composite pipeline on a list of strokes drawn within one
 * gesture window. Returns recognition results for each detected shape group
 * plus nesting information. */
export function recognizeComposite(strokes: readonly Stroke[]): CompositeResult {
  if (strokes.length === 0) {
    return { groups: [], isNested: false, outerIndex: null, innerIndex: null };
  }

  const groups = groupStrokes(strokes);

  // Recognize each group. Multistroke groups (2+ strokes that the grouper
  // kept together as one shape) try multistroke recognition FIRST — for
  // patterns like a plus sign drawn as two crossed lines, where
  // concatenate-and-run-single-stroke wouldn't work.
  const recognized = groups.map((group) => {
    if (group.strokes.length === 0) {
      return {
        group,
        recognition: { shape: null, confidence: 0, features: undefined as never },
      };
    }
    if (group.strokes.length >= 2) {
      const ms = recognizeMultistroke(group.strokes);
      if (ms) {
        const minimalFeatures = extractFeatures(preprocessStrokes(group.strokes));
        return {
          group,
          recognition: {
            shape: ms.shape,
            confidence: ms.confidence,
            features: minimalFeatures,
          } as RecognitionResult,
        };
      }
    }
    const norm = preprocessStrokes(group.strokes);
    const features = extractFeatures(norm);
    // Pass the cloud so the recognize() cascade can hand off to $Q for
    // iconic glyphs that don't match any rule-based recognizer.
    return { group, recognition: recognize(features, { cloud: norm.points }) };
  });

  // Sort largest bbox first so groups[0] is the natural "outer" candidate
  recognized.sort((a, b) => bboxArea(b.group.bbox) - bboxArea(a.group.bbox));

  // Detect nesting only for the simplest case: exactly 2 groups, smaller
  // contained in larger. The full hierarchical case (multiple inner glyphs)
  // is later work.
  let isNested = false;
  let outerIndex: number | null = null;
  let innerIndex: number | null = null;
  if (recognized.length === 2 && isContainedIn(recognized[1]!.group, recognized[0]!.group)) {
    isNested = true;
    outerIndex = 0;
    innerIndex = 1;
  }

  return { groups: recognized, isNested, outerIndex, innerIndex };
}

// Re-export BBox for convenience to UI code.
export type { BBox } from './geometry.js';
