import { describe, expect, it } from 'vitest';
import { buildTemplate, qScale, recognizeQ } from './qdollar.js';
import { recognize } from './recognize.js';
import { getQTemplates } from './templates.js';
import type { NormalizedPoint, NormalizedStroke } from './types.js';

function center(pts: NormalizedPoint[]): NormalizedPoint[] {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  return pts.map((p) => ({ x: p.x - cx, y: p.y - cy }));
}

describe('$Q template matcher', () => {
  it('a template matches itself with very high confidence', () => {
    const tmpls = getQTemplates();
    for (const t of tmpls) {
      // The template's own scaled cloud is the candidate; should match itself
      // with near-zero distance and confidence ~1.
      const match = recognizeQ(t.points, [t]);
      expect(match).not.toBeNull();
      expect(match!.distance).toBeLessThan(1);
      expect(match!.confidence).toBeGreaterThan(0.99);
    }
  });

  it('a heart cloud matches the heart template (not other glyphs)', () => {
    const heartTemplate = getQTemplates().find((t) => t.name === 'heart');
    expect(heartTemplate).toBeDefined();
    // Build a fresh heart-shape cloud and run it against ALL templates
    const heartPoints: NormalizedPoint[] = [];
    for (let i = 0; i <= 200; i++) {
      const t = (i / 200) * 2 * Math.PI;
      heartPoints.push({
        x: 16 * Math.sin(t) ** 3,
        y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
      });
    }
    const candidate = qScale(center(heartPoints));
    const match = recognizeQ(candidate, getQTemplates());
    expect(match).not.toBeNull();
    expect(match!.template.name).toBe('heart');
  });

  it('a spiral cloud matches the spiral template', () => {
    const spiralPoints: NormalizedPoint[] = [];
    for (let i = 0; i <= 200; i++) {
      const t = (i / 200) * 4 * Math.PI;
      const r = 5 + t * 8;
      spiralPoints.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
    }
    const candidate = qScale(center(spiralPoints));
    const match = recognizeQ(candidate, getQTemplates());
    expect(match).not.toBeNull();
    expect(match!.template.name).toBe('spiral');
  });

  it('buildTemplate produces a usable scaled cloud', () => {
    const verts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
      { x: 0, y: 0 },
    ];
    const t = buildTemplate('test', verts);
    expect(t.points).toHaveLength(64);
    // After scaling, points should fit in [0, ~64] grid
    for (const p of t.points) {
      expect(p.x).toBeGreaterThanOrEqual(-1);
      expect(p.x).toBeLessThanOrEqual(65);
      expect(p.y).toBeGreaterThanOrEqual(-1);
      expect(p.y).toBeLessThanOrEqual(65);
    }
  });
});

describe('recognize cascade — $Q fallback', () => {
  function makeStroke(pts: NormalizedPoint[]): NormalizedStroke {
    return { points: center(pts), raw: [] };
  }

  function fillSamples(verts: NormalizedPoint[], pointsPerSegment = 30): NormalizedPoint[] {
    // Walk each segment WITHOUT duplicating boundary vertices — appending
    // the final vertex once at the end. Duplicates make turning-angle
    // calculation fail at the duplicate (zero-length vector → angle = 0).
    const out: NormalizedPoint[] = [];
    for (let i = 0; i < verts.length - 1; i++) {
      const a = verts[i]!;
      const b = verts[i + 1]!;
      for (let s = 0; s < pointsPerSegment; s++) {
        const u = s / pointsPerSegment;
        out.push({ x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y) });
      }
    }
    out.push({ x: verts[verts.length - 1]!.x, y: verts[verts.length - 1]!.y });
    return out;
  }

  it('a heart-shaped stroke classifies as heart via $Q (rule-based misses it)', () => {
    const verts: NormalizedPoint[] = [];
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * 2 * Math.PI;
      verts.push({
        x: 16 * Math.sin(t) ** 3,
        y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
      });
    }
    const stroke = makeStroke(verts);
    const r = recognize(stroke);
    expect(r.shape).toBe('heart');
  });

  it('a clean triangle still goes through the rule-based path (not $Q)', () => {
    const verts = fillSamples([
      { x: 0, y: -50 },
      { x: 50, y: 50 },
      { x: -50, y: 50 },
      { x: 0, y: -50 },
    ]);
    const stroke = makeStroke(verts);
    const r = recognize(stroke);
    expect(r.shape).toBe('triangle');
  });

  it('a clean circle still goes through the rule-based path (not $Q)', () => {
    const verts: NormalizedPoint[] = [];
    for (let i = 0; i < 64; i++) {
      const t = (i / 63) * 2 * Math.PI;
      verts.push({ x: 50 * Math.cos(t), y: 50 * Math.sin(t) });
    }
    const stroke = makeStroke(verts);
    const r = recognize(stroke);
    expect(r.shape).toBe('circle');
  });
});
