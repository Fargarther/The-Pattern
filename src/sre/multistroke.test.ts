import { describe, expect, it } from 'vitest';
import type { RawPoint, Stroke } from './types.js';
import { recognizeMultistrokePlus } from './multistroke.js';
import { recognizeComposite } from './composite.js';

function lineStroke(a: { x: number; y: number }, b: { x: number; y: number }): Stroke {
  const points: RawPoint[] = [];
  let t = 1000;
  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    points.push({ x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y), t });
    t += 10;
  }
  return {
    points,
    startTime: points[0]!.t,
    endTime: points[points.length - 1]!.t,
    pointerType: 'pen',
  };
}

describe('recognizeMultistrokePlus', () => {
  it('classifies + drawn as horizontal + vertical lines crossing at center', () => {
    const horizontal = lineStroke({ x: -50, y: 0 }, { x: 50, y: 0 });
    const vertical = lineStroke({ x: 0, y: -50 }, { x: 0, y: 50 });
    const r = recognizeMultistrokePlus([horizontal, vertical]);
    expect(r).not.toBeNull();
    expect(r!.shape).toBe('plusSign');
    expect(r!.confidence).toBeGreaterThan(0.7);
  });

  it('rejects two parallel lines', () => {
    const a = lineStroke({ x: -50, y: -10 }, { x: 50, y: -10 });
    const b = lineStroke({ x: -50, y: 10 }, { x: 50, y: 10 });
    expect(recognizeMultistrokePlus([a, b])).toBeNull();
  });

  it('rejects a T-junction (lines meet at end of one)', () => {
    const horizontal = lineStroke({ x: -50, y: 0 }, { x: 50, y: 0 });
    const verticalAtEnd = lineStroke({ x: 50, y: -50 }, { x: 50, y: 50 });
    expect(recognizeMultistrokePlus([horizontal, verticalAtEnd])).toBeNull();
  });

  it('rejects two lines with very different lengths', () => {
    const long = lineStroke({ x: -100, y: 0 }, { x: 100, y: 0 });
    const short = lineStroke({ x: 0, y: -10 }, { x: 0, y: 10 });
    expect(recognizeMultistrokePlus([long, short])).toBeNull();
  });

  it('rejects two diagonal crossing lines (X, not +) — angle off perpendicular', () => {
    // Two lines crossing at ~60° (not perpendicular) — should reject
    const a = lineStroke({ x: -50, y: -50 }, { x: 50, y: 0 });
    const b = lineStroke({ x: -50, y: 0 }, { x: 50, y: -50 });
    expect(recognizeMultistrokePlus([a, b])).toBeNull();
  });

  it('rejects a single curved stroke (not a straight line)', () => {
    const curved: RawPoint[] = [];
    let t = 1000;
    for (let i = 0; i <= 30; i++) {
      const theta = (i / 30) * Math.PI; // half-circle arc
      curved.push({ x: 50 * Math.cos(theta), y: 50 * Math.sin(theta), t });
      t += 10;
    }
    const arc: Stroke = {
      points: curved,
      startTime: curved[0]!.t,
      endTime: curved[curved.length - 1]!.t,
      pointerType: 'pen',
    };
    const horizontal = lineStroke({ x: -50, y: 0 }, { x: 50, y: 0 });
    expect(recognizeMultistrokePlus([horizontal, arc])).toBeNull();
  });
});

describe('recognizeComposite — multistroke integration', () => {
  it('classifies + drawn as 2 strokes via the composite layer', () => {
    const horizontal = lineStroke({ x: -50, y: 0 }, { x: 50, y: 0 });
    const vertical = lineStroke({ x: 0, y: -50 }, { x: 0, y: 50 });
    const r = recognizeComposite([horizontal, vertical]);
    expect(r.groups).toHaveLength(1); // grouper merged them (overlapping bboxes)
    expect(r.groups[0]!.recognition.shape).toBe('plusSign');
  });

  it('classifies + drawn as 4 separate arms (radiating from center)', () => {
    const top = lineStroke({ x: 0, y: 0 }, { x: 0, y: -50 });
    const right = lineStroke({ x: 0, y: 0 }, { x: 50, y: 0 });
    const bottom = lineStroke({ x: 0, y: 0 }, { x: 0, y: 50 });
    const left = lineStroke({ x: 0, y: 0 }, { x: -50, y: 0 });
    const r = recognizeComposite([top, right, bottom, left]);
    expect(r.groups[0]!.recognition.shape).toBe('plusSign');
    expect(r.groups[0]!.recognition.confidence).toBeGreaterThan(0.7);
  });

  it('classifies a triangle drawn as 3 separate strokes (concat path)', () => {
    // Three lines whose endpoints connect to form a triangle outline.
    const a = lineStroke({ x: 0, y: -50 }, { x: 50, y: 50 });
    const b = lineStroke({ x: 50, y: 50 }, { x: -50, y: 50 });
    const c = lineStroke({ x: -50, y: 50 }, { x: 0, y: -50 });
    const r = recognizeComposite([a, b, c]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.recognition.shape).toBe('triangle');
  });

  it('does not interfere with single-stroke triangle recognition', () => {
    // Closed triangle as a single stroke
    const points: RawPoint[] = [];
    let t = 1000;
    const verts = [
      { x: 0, y: -50 },
      { x: 50, y: 50 },
      { x: -50, y: 50 },
      { x: 0, y: -50 },
    ];
    for (let i = 0; i < verts.length - 1; i++) {
      const a = verts[i]!;
      const b = verts[i + 1]!;
      for (let s = 0; s < 30; s++) {
        const u = s / 30;
        points.push({ x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y), t });
        t += 10;
      }
    }
    points.push({ x: verts[verts.length - 1]!.x, y: verts[verts.length - 1]!.y, t });
    const tri: Stroke = {
      points,
      startTime: points[0]!.t,
      endTime: points[points.length - 1]!.t,
      pointerType: 'pen',
    };
    const r = recognizeComposite([tri]);
    expect(r.groups[0]!.recognition.shape).toBe('triangle');
  });
});
