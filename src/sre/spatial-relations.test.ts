import { describe, expect, it } from 'vitest';
import {
  makeOccurrence,
  relate,
  type PrimitiveOccurrence,
} from './spatial-relations.js';
import type { NormalizedPoint } from './types.js';

// ============================================================================
// Builders
// ============================================================================

/** Sample N points around a circle of given centre+radius. */
function circlePoints(cx: number, cy: number, r: number, n = 32): NormalizedPoint[] {
  const pts: NormalizedPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/** A horizontal line stroke from (x1, y) to (x2, y). */
function horizontalLine(x1: number, x2: number, y: number, n = 16): NormalizedPoint[] {
  const pts: NormalizedPoint[] = [];
  for (let i = 0; i <= n; i++) {
    pts.push({ x: x1 + ((x2 - x1) * i) / n, y });
  }
  return pts;
}

function dot(x: number, y: number): NormalizedPoint[] {
  // 4-point cluster for a "dot" — bbox has finite area so containment
  // logic doesn't divide by zero.
  return [
    { x: x - 1, y: y - 1 },
    { x: x + 1, y: y - 1 },
    { x: x + 1, y: y + 1 },
    { x: x - 1, y: y + 1 },
  ];
}

function circleOcc(cx: number, cy: number, r: number, index = 0): PrimitiveOccurrence {
  return makeOccurrence('circle', circlePoints(cx, cy, r), index);
}

// ============================================================================
// Tests
// ============================================================================

describe('relate', () => {
  it('reports inside when small dot is centered in a big circle', () => {
    const big = circleOcc(100, 100, 50);
    const small = makeOccurrence('dot', dot(100, 100), 1);
    // Smaller dot (~2px wide) inside big circle (~100px wide) — area
    // ratio is well under the 0.5 concentric floor, so `inside` wins.
    const r = relate(big, small);
    expect(r.relation).toBe('inside');
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it('reports concentric when two similar-sized circles share a center', () => {
    const outer = circleOcc(100, 100, 50);
    const inner = circleOcc(100, 100, 35); // ~50% area, centroids identical
    const r = relate(outer, inner);
    expect(r.relation).toBe('concentric');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('reports inside (not concentric) when off-center despite similar size', () => {
    const outer = circleOcc(100, 100, 50);
    const inner = circleOcc(120, 120, 30); // shifted
    const r = relate(outer, inner);
    expect(r.relation).toBe('inside');
  });

  it('reports bisecting when a horizontal line crosses through a circle', () => {
    const circle = circleOcc(100, 100, 50);
    const line = makeOccurrence('arrow', horizontalLine(20, 180, 100), 1);
    // line arg first — the relation is asymmetric, "line bisects circle".
    const r = relate(line, circle);
    expect(r.relation).toBe('bisecting');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('does NOT report bisecting when the line stops inside the circle', () => {
    const circle = circleOcc(100, 100, 50);
    const stub = makeOccurrence('arrow', horizontalLine(20, 100, 100), 1); // ends at center
    const r = relate(stub, circle);
    expect(r.relation).not.toBe('bisecting');
  });

  it('reports intersecting when bboxes overlap but neither contains the other', () => {
    const a = circleOcc(100, 100, 40); // bbox 60..140 × 60..140
    const b = circleOcc(160, 100, 40); // bbox 120..200 × 60..140 — overlaps in x 120..140
    const r = relate(a, b);
    expect(r.relation).toBe('intersecting');
  });

  it('reports adjacent-right when B sits to the right of A with vertical overlap', () => {
    const a = circleOcc(100, 100, 30); // bbox 70..130 × 70..130
    const b = circleOcc(180, 100, 30); // bbox 150..210 × 70..130 — gap 20, vertical overlap full
    const r = relate(a, b);
    expect(r.relation).toBe('adjacent-right');
    expect(r.confidence).toBeGreaterThan(0.3);
  });

  it('reports adjacent-above when B sits above A with horizontal overlap', () => {
    const a = circleOcc(100, 200, 30); // bbox 70..130 × 170..230
    const b = circleOcc(100, 100, 30); // bbox 70..130 × 70..130 — gap 40 above
    const r = relate(a, b);
    expect(r.relation).toBe('adjacent-above');
  });

  it('reports disjoint when shapes are far apart with no axis alignment', () => {
    const a = circleOcc(100, 100, 20);
    const b = circleOcc(500, 500, 20);
    const r = relate(a, b);
    expect(r.relation).toBe('disjoint');
  });

  it('makeOccurrence computes a sensible bbox + centroid', () => {
    const occ = makeOccurrence('square', [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ], 0);
    expect(occ.bbox).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(occ.centroid).toEqual({ x: 50, y: 25 });
  });
});
