import { describe, expect, it } from 'vitest';
import { CascadeShapeRecognizer, type ShapeRecognizer } from './shape-recognizer.js';
import type { RawPoint, Stroke } from './types.js';

function squareStroke(): Stroke {
  // ~100 points around a closed square, traced CCW from top-left and
  // returning to the start point.
  const verts = [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 200 },
    { x: 100, y: 200 },
    { x: 100, y: 100 }, // close the loop
  ];
  const perSide = 25;
  const pts: RawPoint[] = [];
  let t = 0;
  const dt = 16; // ~60fps
  for (let i = 0; i < verts.length - 1; i++) {
    const a = verts[i]!;
    const b = verts[i + 1]!;
    for (let k = 0; k < perSide; k++) {
      const u = k / perSide;
      pts.push({
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        t: (t += dt),
        pressure: 0.5,
        pointerType: 'mouse',
      });
    }
  }
  // Final closing point.
  pts.push({
    x: verts[0]!.x,
    y: verts[0]!.y,
    t: t + dt,
    pressure: 0.5,
    pointerType: 'mouse',
  });
  return {
    points: pts,
    startTime: 0,
    endTime: pts.length,
    pointerType: 'mouse',
  };
}

describe('ShapeRecognizer (cascade)', () => {
  const r: ShapeRecognizer = new CascadeShapeRecognizer();

  it('identifies itself with id + version', () => {
    expect(r.id).toBe('cascade-rule-q');
    expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('classifies a square stroke through the cascade', () => {
    const result = r.recognize([squareStroke()]);
    expect(result.shape).toBe('square');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('returns the unrecognized result on empty input', () => {
    const result = r.recognize([]);
    expect(result.shape).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('returns the unrecognized result on a single-point stroke', () => {
    const stroke: Stroke = {
      points: [{ x: 0, y: 0, t: 0, pressure: 0.5, pointerType: 'mouse' }],
      startTime: 0,
      endTime: 0,
      pointerType: 'mouse',
    };
    const result = r.recognize([stroke]);
    expect(result.shape).toBeNull();
  });

  it('loadTemplates accepts an empty list without throwing', () => {
    expect(() => r.loadTemplates([])).not.toThrow();
  });
});
