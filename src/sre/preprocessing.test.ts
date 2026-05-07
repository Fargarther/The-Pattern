import { describe, expect, it } from 'vitest';
import type { RawPoint, Stroke } from './types.js';
import { SRE_TUNING } from './types.js';
import {
  preprocessStrokes,
  resampleToN,
  translateToOrigin,
} from './preprocessing.js';
import { applyOneEuroFilter } from './one-euro-filter.js';

function makeStroke(points: RawPoint[], pointerType: Stroke['pointerType'] = 'pen'): Stroke {
  return {
    points,
    startTime: points[0]?.t ?? 0,
    endTime: points[points.length - 1]?.t ?? 0,
    pointerType,
  };
}

function syntheticTriangle(): RawPoint[] {
  // Equilateral-ish triangle drawn as a single closed stroke at 100 Hz.
  const verts = [
    { x: 100, y: 200 },
    { x: 200, y: 200 },
    { x: 150, y: 113 },
    { x: 100, y: 200 },
  ];
  const out: RawPoint[] = [];
  let t = 1000;
  for (let i = 0; i < verts.length - 1; i++) {
    const a = verts[i]!;
    const b = verts[i + 1]!;
    const steps = 30;
    for (let s = 0; s < steps; s++) {
      const u = s / steps;
      out.push({ x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y), t });
      t += 10;
    }
  }
  out.push({ x: verts[verts.length - 1]!.x, y: verts[verts.length - 1]!.y, t });
  return out;
}

function bbox(points: { x: number; y: number }[]): { w: number; h: number } {
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
  return { w: maxX - minX, h: maxY - minY };
}

describe('resampleToN', () => {
  it('resamples a straight line to evenly spaced points', () => {
    const line = Array.from({ length: 11 }, (_, i) => ({ x: i, y: 0 }));
    const out = resampleToN(line, 5);
    expect(out).toHaveLength(5);
    expect(out[0]!.x).toBeCloseTo(0);
    expect(out[4]!.x).toBeCloseTo(10);
    // Mid-points should be at 2.5, 5, 7.5
    expect(out[1]!.x).toBeCloseTo(2.5, 5);
    expect(out[2]!.x).toBeCloseTo(5, 5);
    expect(out[3]!.x).toBeCloseTo(7.5, 5);
  });

  it('handles a degenerate single-point input by duplicating', () => {
    const out = resampleToN([{ x: 5, y: 7 }], 64);
    expect(out).toHaveLength(64);
    expect(out.every((p) => p.x === 5 && p.y === 7)).toBe(true);
  });

  it('handles a zero-length path (all-identical points)', () => {
    const pts = Array.from({ length: 10 }, () => ({ x: 3, y: 4 }));
    const out = resampleToN(pts, 64);
    expect(out).toHaveLength(64);
    expect(out.every((p) => p.x === 3 && p.y === 4)).toBe(true);
  });

  it('returns N points even with fractional totalLength rounding', () => {
    // Many small segments — checks the floating-point-shortfall padding path.
    const pts = Array.from({ length: 1000 }, (_, i) => ({ x: i * 0.1, y: 0 }));
    const out = resampleToN(pts, 64);
    expect(out).toHaveLength(64);
  });
});

describe('translateToOrigin', () => {
  it('moves the centroid to (0, 0)', () => {
    const pts = [
      { x: 10, y: 20 },
      { x: 20, y: 30 },
      { x: 30, y: 40 },
    ];
    const out = translateToOrigin(pts);
    const cx = out.reduce((s, p) => s + p.x, 0) / out.length;
    const cy = out.reduce((s, p) => s + p.y, 0) / out.length;
    expect(cx).toBeCloseTo(0, 10);
    expect(cy).toBeCloseTo(0, 10);
  });

  it('preserves aspect ratio (no scaling applied)', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ];
    const out = translateToOrigin(pts);
    const before = bbox(pts);
    const after = bbox(out);
    expect(after.w).toBeCloseTo(before.w);
    expect(after.h).toBeCloseTo(before.h);
    expect(after.w / after.h).toBeCloseTo(before.w / before.h);
  });
});

describe('applyOneEuroFilter', () => {
  it('passes through empty / single-point input', () => {
    expect(applyOneEuroFilter([], { mincutoff: 1, beta: 0.007 })).toEqual([]);
    const single = [{ x: 1, y: 2, t: 0 }];
    expect(applyOneEuroFilter(single, { mincutoff: 1, beta: 0.007 })).toEqual(single);
  });

  it('reduces high-frequency jitter on a noisy straight line', () => {
    const clean: RawPoint[] = Array.from({ length: 60 }, (_, i) => ({
      x: i,
      y: 0,
      t: i * 16,
    }));
    const noisy: RawPoint[] = clean.map((p, i) => ({
      ...p,
      y: p.y + ((i % 2 === 0 ? 1 : -1) * 0.5),
    }));
    const smoothed = applyOneEuroFilter(noisy, { mincutoff: 0.5, beta: 0.005 });

    const noiseEnergy = (pts: RawPoint[]): number => {
      let s = 0;
      for (let i = 1; i < pts.length; i++) {
        const dy = pts[i]!.y - pts[i - 1]!.y;
        s += dy * dy;
      }
      return s;
    };

    expect(noiseEnergy(smoothed)).toBeLessThan(noiseEnergy(noisy) * 0.5);
  });
});

describe('preprocessStrokes (end-to-end)', () => {
  it('produces exactly RESAMPLE_POINTS points centered at origin', () => {
    const stroke = makeStroke(syntheticTriangle());
    const result = preprocessStrokes([stroke]);

    expect(result.points).toHaveLength(SRE_TUNING.RESAMPLE_POINTS);

    const cx = result.points.reduce((s, p) => s + p.x, 0) / result.points.length;
    const cy = result.points.reduce((s, p) => s + p.y, 0) / result.points.length;
    expect(cx).toBeCloseTo(0, 5);
    expect(cy).toBeCloseTo(0, 5);
  });

  it('preserves bounding-box aspect ratio of the original shape', () => {
    // Wide rectangle — aspect should survive end-to-end.
    const widePoints: RawPoint[] = [];
    let t = 0;
    const rect = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 50 },
      { x: 0, y: 50 },
      { x: 0, y: 0 },
    ];
    for (let i = 0; i < rect.length - 1; i++) {
      const a = rect[i]!;
      const b = rect[i + 1]!;
      for (let s = 0; s < 25; s++) {
        const u = s / 25;
        widePoints.push({ x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y), t });
        t += 10;
      }
    }
    const result = preprocessStrokes([makeStroke(widePoints)]);
    const bb = bbox(result.points);

    // Original aspect is 200/50 = 4.0. Allow some 1€-filter rounding.
    expect(bb.w / bb.h).toBeGreaterThan(3.5);
    expect(bb.w / bb.h).toBeLessThan(4.5);
  });

  it('throws on empty stroke list', () => {
    expect(() => preprocessStrokes([])).toThrow();
  });

  it('handles multiple strokes by concatenation', () => {
    // Two strokes of half a triangle each — should still preprocess.
    const tri = syntheticTriangle();
    const half = Math.floor(tri.length / 2);
    const s1 = makeStroke(tri.slice(0, half));
    const s2 = makeStroke(tri.slice(half));
    const result = preprocessStrokes([s1, s2]);
    expect(result.points).toHaveLength(SRE_TUNING.RESAMPLE_POINTS);
  });
});
