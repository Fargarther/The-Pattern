// Tests for the feature extractor, against ideal point clouds (bypass preprocessing).
// preprocessing.test.ts covers the pipeline; this file isolates extractFeatures
// from 1€ filter / resampling effects so we test the math, not the smoothing.

import { describe, expect, it } from 'vitest';
import type { NormalizedPoint, NormalizedStroke } from './types.js';
import { extractFeatures } from './features.js';

/**
 * Walk a polygon's perimeter and emit `n` evenly-spaced points.
 *
 * For closed shapes (last vertex == first), out[0] and out[n-1] are at the
 * same physical location, mirroring what `preprocessStrokes` produces from a
 * cleanly-drawn closed stroke.
 */
function idealPolygonCloud(
  verts: { x: number; y: number }[],
  n = 64,
): NormalizedPoint[] {
  if (verts.length < 2) throw new Error('need at least 2 vertices');

  const segments: { from: { x: number; y: number }; to: { x: number; y: number }; len: number }[] = [];
  let total = 0;
  for (let i = 0; i < verts.length - 1; i++) {
    const a = verts[i]!;
    const b = verts[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segments.push({ from: a, to: b, len });
    total += len;
  }

  const interval = total / (n - 1);
  const out: NormalizedPoint[] = [{ x: verts[0]!.x, y: verts[0]!.y }];
  let segIdx = 0;
  let segPos = 0;

  for (let k = 1; k < n; k++) {
    let want = interval;
    while (want > 0 && segIdx < segments.length) {
      const seg = segments[segIdx]!;
      const remain = seg.len - segPos;
      if (remain >= want) {
        segPos += want;
        want = 0;
      } else {
        want -= remain;
        segIdx++;
        segPos = 0;
      }
    }
    if (segIdx >= segments.length) {
      const lastVert = verts[verts.length - 1]!;
      out.push({ x: lastVert.x, y: lastVert.y });
    } else {
      const seg = segments[segIdx]!;
      const t = seg.len > 0 ? segPos / seg.len : 0;
      out.push({
        x: seg.from.x + t * (seg.to.x - seg.from.x),
        y: seg.from.y + t * (seg.to.y - seg.from.y),
      });
    }
  }

  return out;
}

function centerOnOrigin(points: NormalizedPoint[]): NormalizedPoint[] {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / points.length;
  const cy = sy / points.length;
  return points.map((p) => ({ x: p.x - cx, y: p.y - cy }));
}

function makeNormalized(points: NormalizedPoint[]): NormalizedStroke {
  return { points: centerOnOrigin(points), raw: [] };
}

function idealEquilateralTriangle(): NormalizedStroke {
  return makeNormalized(
    idealPolygonCloud([
      { x: 100, y: 200 },
      { x: 200, y: 200 },
      { x: 150, y: 113 },
      { x: 100, y: 200 },
    ]),
  );
}

function idealSquare(): NormalizedStroke {
  return makeNormalized(
    idealPolygonCloud([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 200 },
      { x: 100, y: 100 },
    ]),
  );
}

function idealRegularPolygon(sides: number, radius = 60): NormalizedStroke {
  const verts: { x: number; y: number }[] = [];
  for (let i = 0; i <= sides; i++) {
    const a = -Math.PI / 2 + (i / sides) * 2 * Math.PI;
    verts.push({ x: 150 + radius * Math.cos(a), y: 150 + radius * Math.sin(a) });
  }
  return makeNormalized(idealPolygonCloud(verts));
}

function idealCircle(radius = 60, n = 64): NormalizedStroke {
  const out: NormalizedPoint[] = [];
  for (let i = 0; i < n; i++) {
    const theta = (i / (n - 1)) * 2 * Math.PI;
    out.push({ x: 150 + radius * Math.cos(theta), y: 150 + radius * Math.sin(theta) });
  }
  return makeNormalized(out);
}

describe('extractFeatures — corner detection', () => {
  it('finds 3 corners on an ideal equilateral triangle', () => {
    const f = extractFeatures(idealEquilateralTriangle());
    expect(f.cornerCount).toBe(3);
  });

  it('finds 4 corners on an ideal square', () => {
    const f = extractFeatures(idealSquare());
    expect(f.cornerCount).toBe(4);
    expect(f.bboxAspectRatio).toBeCloseTo(1, 1);
  });

  it('finds 5 corners on an ideal pentagon', () => {
    const f = extractFeatures(idealRegularPolygon(5));
    expect(f.cornerCount).toBe(5);
  });

  it('finds 6 corners on an ideal hexagon', () => {
    const f = extractFeatures(idealRegularPolygon(6));
    expect(f.cornerCount).toBe(6);
  });

  it('finds 8 corners on an ideal octagon', () => {
    const f = extractFeatures(idealRegularPolygon(8));
    expect(f.cornerCount).toBe(8);
  });

  it('finds at most 1 spurious corner on an ideal circle', () => {
    const f = extractFeatures(idealCircle());
    expect(f.cornerCount).toBeLessThanOrEqual(1);
  });

  it('finds zero corners on a near-closed circle (real-input simulation)', () => {
    // Simulates a real circle drawn with a small closure gap — the seam
    // chord's direction differs from the tangent, which used to register
    // as a spurious corner.
    const out: NormalizedPoint[] = [];
    const cx = 150, cy = 150, r = 60;
    // Sweep 350° instead of 360° — closure exists but isn't exact.
    for (let i = 0; i < 64; i++) {
      const theta = (i / 63) * (350 * Math.PI / 180);
      out.push({ x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
    }
    const f = extractFeatures(makeNormalized(out));
    // Closure chord is short relative to bbox, so isClosed should be true,
    // and we should NOT get a spurious corner at the seam.
    expect(f.cornerCount).toBeLessThanOrEqual(1);
  });

  it('does not flag endpoint wobble as corners on an open line', () => {
    // Straight line from (0,0) to (200,0), 64 evenly spaced samples,
    // with small jitter at each end (simulating stylus touch-down/lift).
    const out: NormalizedPoint[] = [];
    for (let i = 0; i < 64; i++) {
      const u = i / 63;
      let y = 0;
      // Small wobble in the first 3 and last 3 samples
      if (i < 3 || i > 60) y = (Math.sin(i * 7.3) * 0.5) * (i < 3 ? 1 : -1);
      out.push({ x: u * 200, y });
    }
    const f = extractFeatures(makeNormalized(out));
    expect(f.isClosed).toBe(false);
    expect(f.cornerCount).toBe(0);
  });
});

describe('extractFeatures — closure', () => {
  it('detects a closed shape', () => {
    const f = extractFeatures(idealSquare());
    expect(f.isClosed).toBe(true);
    expect(f.closureDistance).toBeLessThan(0.05);
  });

  it('detects an open V', () => {
    const v = makeNormalized(
      idealPolygonCloud([
        { x: 100, y: 100 },
        { x: 150, y: 200 },
        { x: 200, y: 100 },
      ]),
    );
    const f = extractFeatures(v);
    expect(f.isClosed).toBe(false);
    expect(f.closureDistance).toBeGreaterThan(0.5);
  });

  it('detects a partially-closed rectangle as closed (~13% gap)', () => {
    // Real player sample from samples/: drew a rectangle, ended ~46 px short
    // of start on a 345 px bbox-diagonal (~13%). Walk all 4 corners then stop
    // short of the start point. Should be classified closed and detect 4
    // corners (the seam corner included via closed-mode wraparound).
    const verts = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 200 },
      { x: 100, y: 200 },
      { x: 100, y: 129 }, // 29 px short of start; bbox diagonal ≈ 223.6 → 13%
    ];
    const f = extractFeatures(makeNormalized(idealPolygonCloud(verts)));
    expect(f.isClosed).toBe(true);
    expect(f.cornerCount).toBeGreaterThanOrEqual(4);
  });

  it('still rejects clearly-open shapes (V with > 50% gap)', () => {
    const v = makeNormalized(
      idealPolygonCloud([
        { x: 100, y: 100 },
        { x: 150, y: 200 },
        { x: 200, y: 100 },
      ]),
    );
    const f = extractFeatures(v);
    expect(f.isClosed).toBe(false);
  });
});

describe('extractFeatures — turning angle integration', () => {
  it('total absolute angle ≈ 2π for an ideal closed circle', () => {
    const f = extractFeatures(idealCircle());
    expect(f.totalAbsoluteAngle).toBeGreaterThan(2 * Math.PI - 0.3);
    expect(f.totalAbsoluteAngle).toBeLessThan(2 * Math.PI + 0.3);
  });

  it('total absolute angle ≈ 2π for an ideal closed triangle', () => {
    const f = extractFeatures(idealEquilateralTriangle());
    expect(f.totalAbsoluteAngle).toBeGreaterThan(2 * Math.PI - 0.5);
    expect(f.totalAbsoluteAngle).toBeLessThan(2 * Math.PI + 0.5);
  });
});

describe('extractFeatures — DCR (Direction Change Ratio)', () => {
  it('high DCR for polygons (sharp corners stand out vs straight sides)', () => {
    const f = extractFeatures(idealEquilateralTriangle());
    expect(f.dcr).toBeGreaterThan(5);
  });

  it('low DCR for circles (uniform curvature)', () => {
    const f = extractFeatures(idealCircle());
    expect(f.dcr).toBeLessThan(2);
  });
});

describe('extractFeatures — bbox & aspect', () => {
  it('reports square aspect ratio ≈ 1', () => {
    const f = extractFeatures(idealSquare());
    expect(f.bboxAspectRatio).toBeGreaterThan(0.95);
    expect(f.bboxAspectRatio).toBeLessThan(1.05);
  });

  it('reports wide rectangle aspect ratio ≈ 4', () => {
    const rect = makeNormalized(
      idealPolygonCloud([
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 150 },
        { x: 100, y: 150 },
        { x: 100, y: 100 },
      ]),
    );
    const f = extractFeatures(rect);
    expect(f.bboxAspectRatio).toBeGreaterThan(3.5);
    expect(f.bboxAspectRatio).toBeLessThan(4.5);
  });
});

describe('extractFeatures — side lengths', () => {
  it('low sideLengthCV for an ideal regular polygon', () => {
    const f = extractFeatures(idealRegularPolygon(6));
    expect(f.sideLengths).toHaveLength(6);
    expect(f.sideLengthCV).toBeLessThan(0.1);
  });

  it('high sideLengthCV for an irregular triangle', () => {
    const tri = makeNormalized(
      idealPolygonCloud([
        { x: 50, y: 200 },
        { x: 250, y: 200 },
        { x: 60, y: 100 },
        { x: 50, y: 200 },
      ]),
    );
    const f = extractFeatures(tri);
    expect(f.sideLengthCV).toBeGreaterThan(0.15);
  });
});

describe('extractFeatures — symmetry', () => {
  it('square is highly symmetric on both axes and 4-fold rotation', () => {
    const f = extractFeatures(idealSquare());
    expect(f.horizontalSymmetry).toBeLessThan(0.05);
    expect(f.verticalSymmetry).toBeLessThan(0.05);
    expect(f.rotationalSymmetry4).toBeLessThan(0.05);
  });

  it('asymmetric scalene triangle is NOT 4-fold symmetric', () => {
    const tri = makeNormalized(
      idealPolygonCloud([
        { x: 100, y: 100 },
        { x: 200, y: 150 },
        { x: 100, y: 200 },
        { x: 100, y: 100 },
      ]),
    );
    const f = extractFeatures(tri);
    expect(f.rotationalSymmetry4).toBeGreaterThan(0.1);
  });
});
