// End-to-end integration: raw strokes → composite parser → primitive
// occurrences → composition engine → game token.
//
// This validates the seam between the recognition layer (composite.ts)
// and the grammar layer (composition-engine.ts) for the locked 3-deep
// composite contract.

import { describe, expect, it } from 'vitest';
import { recognizeComposite, toPrimitiveOccurrences } from './composite.js';
import { CompositionEngine, rule, UNKNOWN_PATTERN_TOKEN } from './composition-engine.js';
import type { RawPoint, Stroke } from './types.js';

function makeStroke(verts: { x: number; y: number }[]): Stroke {
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
  points.push({
    x: verts[verts.length - 1]!.x,
    y: verts[verts.length - 1]!.y,
    t,
  });
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

describe('grammar integration: composite → occurrences → engine', () => {
  // Layered grammar: a 3-deep nesting (unit + wrapper + modifier source)
  // matches "regen-buff" via two `inside` relations in a chain.
  const grammar = [
    // 3-deep: unit > wrapper-square > modifier-triangle
    rule(
      'regen-buff',
      ['square@0', 'square@1', 'triangle'],
      {
        'square@1': { inside: 'square@0' },
        triangle: { inside: 'square@1' },
      },
    ),
  ];
  const engine = new CompositionEngine(grammar);

  it('runs a full 3-deep gesture through and emits the layered token', () => {
    const outer = squareStroke(0, 0, 200); // unit
    const middle = squareStroke(0, 0, 100); // wrapper
    const inner = triangleStroke(0, 0, 30); // modifier

    const composite = recognizeComposite([outer, middle, inner]);
    expect(composite.composition.kind).toBe('unit-wrapper-modifier');

    const occurrences = toPrimitiveOccurrences(composite);
    expect(occurrences).toHaveLength(3);
    // Outermost first per composite ordering.
    expect(occurrences[0]!.classId).toBe('square');
    expect(occurrences[1]!.classId).toBe('square');
    expect(occurrences[2]!.classId).toBe('triangle');

    const result = engine.evaluate(occurrences);
    expect(result.token).toBe('regen-buff');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.evidence).not.toBeNull();
  });

  it('a 2-deep gesture (unit + modifier without wrapper) is invalid by composite contract', () => {
    const outer = squareStroke(0, 0, 100);
    const inner = triangleStroke(0, 0, 30);

    const composite = recognizeComposite([outer, inner]);
    expect(composite.composition.kind).toBe('invalid-2-deep');

    // The composition engine doesn't enforce the wrapper contract — that's
    // the composite parser's job. Engine just sees square + triangle with
    // no rule matching → unknown.
    const occurrences = toPrimitiveOccurrences(composite);
    const result = engine.evaluate(occurrences);
    expect(result.token).toBe(UNKNOWN_PATTERN_TOKEN);
  });

  it('a vanilla single-shape gesture has no rule match (unit-only)', () => {
    const composite = recognizeComposite([squareStroke(0, 0, 80)]);
    expect(composite.composition.kind).toBe('unit-only');

    const occurrences = toPrimitiveOccurrences(composite);
    expect(occurrences).toHaveLength(1);
    const result = engine.evaluate(occurrences);
    expect(result.token).toBe(UNKNOWN_PATTERN_TOKEN);
  });
});
