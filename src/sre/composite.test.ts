import { describe, expect, it } from 'vitest';
import type { RawPoint, Stroke } from './types.js';
import { groupStrokes, isContainedIn, recognizeComposite } from './composite.js';

function makeStroke(verts: { x: number; y: number }[]): Stroke {
  // Walk a polyline at small steps so the stroke has dense points (mimics real input).
  const points: RawPoint[] = [];
  let t = 1000;
  for (let i = 0; i < verts.length - 1; i++) {
    const a = verts[i]!;
    const b = verts[i + 1]!;
    const steps = 30;
    for (let s = 0; s < steps; s++) {
      const u = s / steps;
      points.push({ x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y), t });
      t += 10;
    }
  }
  points.push({ x: verts[verts.length - 1]!.x, y: verts[verts.length - 1]!.y, t });
  return {
    points,
    startTime: points[0]!.t,
    endTime: points[points.length - 1]!.t,
    pointerType: 'pen',
  };
}

function squareStroke(cx: number, cy: number, half: number): Stroke {
  return makeStroke([
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
    { x: cx - half, y: cy - half },
  ]);
}

function triangleStroke(cx: number, cy: number, half: number): Stroke {
  return makeStroke([
    { x: cx, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
    { x: cx, y: cy - half },
  ]);
}

describe('groupStrokes', () => {
  it('keeps a single stroke as one group', () => {
    const groups = groupStrokes([squareStroke(0, 0, 50)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.strokes).toHaveLength(1);
  });

  it('clusters two overlapping strokes into one group', () => {
    // Two strokes whose bboxes overlap — same shape drawn in 2 strokes
    const a = makeStroke([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    const b = makeStroke([
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ]);
    const groups = groupStrokes([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.strokes).toHaveLength(2);
  });

  it('separates two strokes far apart into distinct groups', () => {
    const a = squareStroke(0, 0, 50);
    const b = squareStroke(500, 500, 50);
    const groups = groupStrokes([a, b]);
    expect(groups).toHaveLength(2);
  });

  it('clusters near-but-not-overlapping strokes (small gap)', () => {
    // Strokes 5 px apart on a 100-diag — within proximityRatio default 0.15
    const a = squareStroke(0, 0, 50);
    const b = squareStroke(110, 0, 50);
    const groups = groupStrokes([a, b]);
    expect(groups).toHaveLength(1);
  });
});

describe('isContainedIn', () => {
  it('detects a small triangle contained in a larger square', () => {
    const outer = { strokes: [squareStroke(100, 100, 80)], bbox: { minX: 20, maxX: 180, minY: 20, maxY: 180, width: 160, height: 160, diagonal: Math.hypot(160, 160) } };
    const inner = { strokes: [triangleStroke(100, 100, 25)], bbox: { minX: 75, maxX: 125, minY: 75, maxY: 125, width: 50, height: 50, diagonal: Math.hypot(50, 50) } };
    expect(isContainedIn(inner, outer)).toBe(true);
  });

  it('rejects two adjacent shapes (not nested)', () => {
    const a = { strokes: [squareStroke(0, 0, 50)], bbox: { minX: -50, maxX: 50, minY: -50, maxY: 50, width: 100, height: 100, diagonal: Math.hypot(100, 100) } };
    const b = { strokes: [squareStroke(150, 0, 50)], bbox: { minX: 100, maxX: 200, minY: -50, maxY: 50, width: 100, height: 100, diagonal: Math.hypot(100, 100) } };
    expect(isContainedIn(a, b)).toBe(false);
  });

  it('rejects nesting when inner is too large (>55% of outer)', () => {
    const outer = { strokes: [squareStroke(0, 0, 100)], bbox: { minX: -100, maxX: 100, minY: -100, maxY: 100, width: 200, height: 200, diagonal: Math.hypot(200, 200) } };
    const inner = { strokes: [squareStroke(0, 0, 90)], bbox: { minX: -90, maxX: 90, minY: -90, maxY: 90, width: 180, height: 180, diagonal: Math.hypot(180, 180) } };
    expect(isContainedIn(inner, outer)).toBe(false);
  });
});

describe('recognizeComposite', () => {
  it('identifies a single shape as one group, not nested', () => {
    const r = recognizeComposite([squareStroke(0, 0, 80)]);
    expect(r.groups).toHaveLength(1);
    expect(r.isNested).toBe(false);
    expect(r.groups[0]!.recognition.shape).toBe('square');
  });

  it('identifies a triangle inside a square as nested with correct outer/inner', () => {
    const square = squareStroke(0, 0, 100); // outer
    const triangle = triangleStroke(0, 0, 30); // inner
    const r = recognizeComposite([square, triangle]);
    expect(r.isNested).toBe(true);
    expect(r.outerIndex).toBe(0);
    expect(r.innerIndex).toBe(1);
    expect(r.groups[0]!.recognition.shape).toBe('square');
    expect(r.groups[1]!.recognition.shape).toBe('triangle');
  });

  it('handles two separated shapes (both standalone, not nested)', () => {
    const left = squareStroke(-200, 0, 50);
    const right = triangleStroke(200, 0, 50);
    const r = recognizeComposite([left, right]);
    expect(r.groups).toHaveLength(2);
    expect(r.isNested).toBe(false);
  });
});

describe('Composition (3-deep contract)', () => {
  it('classifies an empty input as kind "empty"', () => {
    const r = recognizeComposite([]);
    expect(r.composition.kind).toBe('empty');
  });

  it('classifies a single shape as kind "unit-only"', () => {
    const r = recognizeComposite([squareStroke(0, 0, 80)]);
    expect(r.composition.kind).toBe('unit-only');
    expect(r.composition.unitIndex).toBe(0);
    expect(r.composition.wrapperIndex).toBeUndefined();
    expect(r.composition.modifierIndex).toBeUndefined();
  });

  it('classifies "shape inside shape" as kind "invalid-2-deep" (modifier without wrapper)', () => {
    const square = squareStroke(0, 0, 100);
    const triangle = triangleStroke(0, 0, 30);
    const r = recognizeComposite([square, triangle]);
    expect(r.composition.kind).toBe('invalid-2-deep');
    expect(r.composition.unitIndex).toBe(0);
    expect(r.composition.modifierIndex).toBe(1);
    expect(r.composition.wrapperIndex).toBeUndefined();
  });

  it('classifies a 3-deep chain as kind "unit-wrapper-modifier"', () => {
    const outer = squareStroke(0, 0, 200);   // unit
    const middle = squareStroke(0, 0, 100);  // wrapper
    const inner = triangleStroke(0, 0, 30);  // modifier
    const r = recognizeComposite([outer, middle, inner]);
    expect(r.composition.kind).toBe('unit-wrapper-modifier');
    expect(r.composition.unitIndex).toBe(0);
    expect(r.composition.wrapperIndex).toBe(1);
    expect(r.composition.modifierIndex).toBe(2);
  });

  it('classifies branching (one outer with two inners) as "multi-shape"', () => {
    const outer = squareStroke(0, 0, 200);
    const innerA = triangleStroke(-60, 0, 25); // left inner
    const innerB = triangleStroke(60, 0, 25);  // right inner — same level as A
    const r = recognizeComposite([outer, innerA, innerB]);
    expect(r.composition.kind).toBe('multi-shape');
  });

  it('classifies multiple disjoint roots as "multi-shape"', () => {
    const left = squareStroke(-200, 0, 50);
    const right = triangleStroke(200, 0, 50);
    const r = recognizeComposite([left, right]);
    expect(r.composition.kind).toBe('multi-shape');
  });

  it('classifies a 4-deep chain as "over-nested"', () => {
    const a = squareStroke(0, 0, 400);
    const b = squareStroke(0, 0, 200);
    const c = squareStroke(0, 0, 100);
    const d = triangleStroke(0, 0, 25);
    const r = recognizeComposite([a, b, c, d]);
    expect(r.composition.kind).toBe('over-nested');
    // Legacy fields still populated.
    expect(r.isNested).toBe(true);
  });
});

describe('toPrimitiveOccurrences', () => {
  it('produces an occurrence per recognized group', async () => {
    const { toPrimitiveOccurrences } = await import('./composite.js');
    const square = squareStroke(0, 0, 100);
    const triangle = triangleStroke(0, 0, 30);
    const r = recognizeComposite([square, triangle]);
    const occurrences = toPrimitiveOccurrences(r);
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0]!.classId).toBe('square');
    expect(occurrences[1]!.classId).toBe('triangle');
    // bbox + centroid in canvas coords (not normalized).
    expect(occurrences[0]!.bbox.w).toBeGreaterThan(0);
    expect(occurrences[1]!.bbox.w).toBeGreaterThan(0);
    expect(occurrences[0]!.index).toBe(0);
    expect(occurrences[1]!.index).toBe(1);
  });

  it('skips groups with no recognized shape', async () => {
    const { toPrimitiveOccurrences } = await import('./composite.js');
    const r = recognizeComposite([]);
    expect(toPrimitiveOccurrences(r)).toEqual([]);
  });
});
