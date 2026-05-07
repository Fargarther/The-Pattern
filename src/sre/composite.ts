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
import { makeOccurrence, type PrimitiveOccurrence } from './spatial-relations.js';
import type { NormalizedPoint, RecognitionResult, Stroke } from './types.js';

export interface StrokeGroup {
  /** Strokes belonging to this group (a single shape). */
  strokes: Stroke[];
  /** Bounding box of all points in the group, in raw input coords. */
  bbox: BBox;
}

/** Classification of a gesture's composite structure per the locked
 *  Pattern composite contract (memory: project_pattern_composite.md):
 *    - 1 level (unit alone)               → vanilla unit, no modifier
 *    - 2 levels (unit + modifier directly) → invalid; modifier needs a wrapper
 *    - 3 levels (unit + wrapper + modifier) → modifier applied with bonus
 *
 *  Plus two structural failure modes:
 *    - 4+ levels of nesting → over-nested (currently treated as invalid)
 *    - multiple disjoint roots, or branching at any level → multi-shape
 */
export type CompositionKind =
  | 'unit-only'
  | 'invalid-2-deep'
  | 'unit-wrapper-modifier'
  | 'over-nested'
  | 'multi-shape'
  | 'empty';

export interface Composition {
  kind: CompositionKind;
  /** Index into `groups` of the outermost shape (the unit), when applicable. */
  unitIndex?: number;
  /** Index of the wrapper polygon (3-deep only). */
  wrapperIndex?: number;
  /** Index of the innermost modifier source (2-deep or 3-deep). */
  modifierIndex?: number;
}

export interface CompositeResult {
  /** All shape groups found, ordered outermost-first (largest bbox first).
   * Single-shape drawings produce a length-1 array. */
  groups: Array<{
    group: StrokeGroup;
    recognition: RecognitionResult;
  }>;
  /** Structured classification per the 3-deep contract. */
  composition: Composition;
  /** Legacy field. True if any nesting was detected (1- vs 2/3-deep).
   *  Maintained for backward compatibility with the original 2-deep UI. */
  isNested: boolean;
  /** Legacy. Index of the outermost (unit) group when nested; null otherwise. */
  outerIndex: number | null;
  /** Legacy. Index of the innermost (modifier) group when nested; null otherwise. */
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

/** Build the containment hierarchy across the recognized groups.
 *
 *  Returns a `parentOf` array: parentOf[i] is the index of the SMALLEST
 *  other group that contains group i, or `null` if i has no container
 *  ("root"). Smallest-container parenting ensures we get a clean nesting
 *  chain when multiple ancestors exist (e.g., grandparent contains both
 *  child and grandchild — child should be parent of grandchild, not the
 *  grandparent).
 */
function buildContainmentParents(
  groups: readonly { group: StrokeGroup }[],
): Array<number | null> {
  const n = groups.length;
  const parentOf: Array<number | null> = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    let bestParent: number | null = null;
    let bestParentArea = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (!isContainedIn(groups[i]!.group, groups[j]!.group)) continue;
      const area = bboxArea(groups[j]!.group.bbox);
      if (area < bestParentArea) {
        bestParentArea = area;
        bestParent = j;
      }
    }
    parentOf[i] = bestParent;
  }
  return parentOf;
}

/** Classify the recognized groups into a single Composition per the
 *  3-deep contract. Returns `multi-shape` for any branching or multiple-
 *  root configurations (handled in a future pass). */
function classifyComposition(
  groups: readonly { group: StrokeGroup }[],
): Composition {
  if (groups.length === 0) return { kind: 'empty' };
  if (groups.length === 1) return { kind: 'unit-only', unitIndex: 0 };

  const parentOf = buildContainmentParents(groups);

  // Roots: groups with no parent.
  const roots: number[] = [];
  for (let i = 0; i < groups.length; i++) {
    if (parentOf[i] === null) roots.push(i);
  }

  // Children of each group.
  const childrenOf: number[][] = groups.map(() => []);
  for (let i = 0; i < parentOf.length; i++) {
    const p = parentOf[i];
    if (p !== null && p !== undefined) childrenOf[p]!.push(i);
  }

  // Multiple roots → multi-shape (e.g., two units side by side).
  if (roots.length !== 1) return { kind: 'multi-shape' };
  const root = roots[0]!;

  // Walk the chain from root downward. If any node has more than one
  // child, that's branching — also `multi-shape` for now.
  const chain: number[] = [root];
  let cur = root;
  while (true) {
    const kids = childrenOf[cur]!;
    if (kids.length === 0) break;
    if (kids.length > 1) return { kind: 'multi-shape' };
    cur = kids[0]!;
    chain.push(cur);
  }

  switch (chain.length) {
    case 1:
      return { kind: 'unit-only', unitIndex: chain[0] };
    case 2:
      return {
        kind: 'invalid-2-deep',
        unitIndex: chain[0],
        modifierIndex: chain[1],
      };
    case 3:
      return {
        kind: 'unit-wrapper-modifier',
        unitIndex: chain[0],
        wrapperIndex: chain[1],
        modifierIndex: chain[2],
      };
    default:
      return { kind: 'over-nested' };
  }
}

/** Run the full composite pipeline on a list of strokes drawn within one
 * gesture window. Returns recognition results for each detected shape group
 * plus the structured composition classification. */
export function recognizeComposite(strokes: readonly Stroke[]): CompositeResult {
  if (strokes.length === 0) {
    return {
      groups: [],
      composition: { kind: 'empty' },
      isNested: false,
      outerIndex: null,
      innerIndex: null,
    };
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

  // Sort largest bbox first so groups[0] is the natural "outer" candidate.
  recognized.sort((a, b) => bboxArea(b.group.bbox) - bboxArea(a.group.bbox));

  // Build the structured composition.
  const composition = classifyComposition(recognized);

  // Legacy back-compat fields. `isNested` fires for any of the nested
  // kinds (2-deep, 3-deep, over-nested) so existing UI code that just
  // checks isNested keeps working. outerIndex/innerIndex map to
  // unit/modifier ends of the chain when applicable.
  let isNested = false;
  let outerIndex: number | null = null;
  let innerIndex: number | null = null;
  if (
    composition.kind === 'invalid-2-deep' ||
    composition.kind === 'unit-wrapper-modifier' ||
    composition.kind === 'over-nested'
  ) {
    isNested = true;
    outerIndex = composition.unitIndex ?? null;
    innerIndex = composition.modifierIndex ?? null;
  }

  return { groups: recognized, composition, isNested, outerIndex, innerIndex };
}

/** Convert a CompositeResult into PrimitiveOccurrence[] suitable for the
 *  composition engine. Skips groups whose recognition returned no shape.
 *  Each occurrence's bbox + centroid + resampledPoints come from the raw
 *  stroke points (canvas space) so spatial relations across primitives
 *  share a common coordinate system. */
export function toPrimitiveOccurrences(
  result: CompositeResult,
): PrimitiveOccurrence[] {
  const out: PrimitiveOccurrence[] = [];
  for (let i = 0; i < result.groups.length; i++) {
    const g = result.groups[i]!;
    const shape = g.recognition.shape;
    if (!shape) continue;
    const points: NormalizedPoint[] = [];
    for (const s of g.group.strokes) {
      for (const p of s.points) points.push({ x: p.x, y: p.y });
    }
    out.push(makeOccurrence(shape, points, i));
  }
  return out;
}

// Re-export BBox for convenience to UI code.
export type { BBox } from './geometry.js';
