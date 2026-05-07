import { describe, expect, it } from 'vitest';
import {
  CompositionEngine,
  rule,
  UNKNOWN_PATTERN_TOKEN,
} from './composition-engine.js';
import { makeOccurrence, type PrimitiveOccurrence } from './spatial-relations.js';
import type { NormalizedPoint } from './types.js';

function circlePoints(cx: number, cy: number, r: number, n = 32): NormalizedPoint[] {
  const pts: NormalizedPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

function dot(x: number, y: number): NormalizedPoint[] {
  return [
    { x: x - 1, y: y - 1 },
    { x: x + 1, y: y - 1 },
    { x: x + 1, y: y + 1 },
    { x: x - 1, y: y + 1 },
  ];
}

function horizontalLine(x1: number, x2: number, y: number, n = 16): NormalizedPoint[] {
  const pts: NormalizedPoint[] = [];
  for (let i = 0; i <= n; i++) {
    pts.push({ x: x1 + ((x2 - x1) * i) / n, y });
  }
  return pts;
}

function trianglePoints(cx: number, cy: number, r: number): NormalizedPoint[] {
  const pts: NormalizedPoint[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    let v0: { x: number; y: number };
    let v1: { x: number; y: number };
    if (t < 1 / 3) {
      v0 = { x: cx, y: cy - r };
      v1 = { x: cx + r * 0.866, y: cy + r * 0.5 };
    } else if (t < 2 / 3) {
      v0 = { x: cx + r * 0.866, y: cy + r * 0.5 };
      v1 = { x: cx - r * 0.866, y: cy + r * 0.5 };
    } else {
      v0 = { x: cx - r * 0.866, y: cy + r * 0.5 };
      v1 = { x: cx, y: cy - r };
    }
    const segT = (t * 3) % 1;
    pts.push({ x: v0.x + (v1.x - v0.x) * segT, y: v0.y + (v1.y - v0.y) * segT });
  }
  return pts;
}

describe('CompositionEngine', () => {
  // A tiny grammar covering three sample compositions.
  const grammar = [
    rule('summon-base', ['circle', 'plusSign'], {
      plusSign: { inside: 'circle' },
    }),
    rule('split-cast', ['circle', 'arrow'], {
      arrow: { bisecting: 'circle' },
    }),
    rule('amplify', ['triangle@0', 'triangle@1'], {
      'triangle@1': { concentric: 'triangle@0' },
    }),
  ];
  const engine = new CompositionEngine(grammar);

  it('emits summon-base when a plusSign is inside a circle', () => {
    const circle = makeOccurrence('circle', circlePoints(100, 100, 50), 0);
    const plus = makeOccurrence('plusSign', dot(100, 100), 1);
    const result = engine.evaluate([circle, plus]);
    expect(result.token).toBe('summon-base');
    expect(result.evidence).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('emits unknown-pattern when the plusSign is OUTSIDE the circle', () => {
    const circle = makeOccurrence('circle', circlePoints(100, 100, 50), 0);
    const plus = makeOccurrence('plusSign', dot(300, 100), 1); // far away
    const result = engine.evaluate([circle, plus]);
    expect(result.token).toBe(UNKNOWN_PATTERN_TOKEN);
    expect(result.evidence).toBeNull();
  });

  it('emits split-cast when an arrow bisects a circle', () => {
    const circle = makeOccurrence('circle', circlePoints(100, 100, 50), 0);
    const arrow = makeOccurrence('arrow', horizontalLine(20, 180, 100), 1);
    const result = engine.evaluate([circle, arrow]);
    expect(result.token).toBe('split-cast');
  });

  it('emits amplify with two concentric triangles via classId@N refs', () => {
    const t0 = makeOccurrence('triangle', trianglePoints(100, 100, 50), 0);
    const t1 = makeOccurrence('triangle', trianglePoints(100, 100, 35), 1);
    const result = engine.evaluate([t0, t1]);
    expect(result.token).toBe('amplify');
  });

  it('emits unknown-pattern with a single primitive that no rule matches alone', () => {
    const circle = makeOccurrence('circle', circlePoints(100, 100, 50), 0);
    const result = engine.evaluate([circle]);
    expect(result.token).toBe(UNKNOWN_PATTERN_TOKEN);
  });

  it('emits unknown-pattern on empty input', () => {
    const result = engine.evaluate([]);
    expect(result.token).toBe(UNKNOWN_PATTERN_TOKEN);
  });

  it('prefers higher-priority rule when two could match', () => {
    // A rule that REQUIRES a specific token at lower priority than the
    // generic one. Make a high-priority rule that requires bisecting AND
    // confirm it wins over a low-priority "any combination" rule.
    const hi = rule(
      'specific',
      ['circle', 'arrow'],
      { arrow: { bisecting: 'circle' } },
      99,
    );
    const lo = rule('generic', ['circle', 'arrow'], {}, 1);
    const e = new CompositionEngine([lo, hi]);
    const circle = makeOccurrence('circle', circlePoints(100, 100, 50), 0);
    const arrow = makeOccurrence('arrow', horizontalLine(20, 180, 100), 1);
    const result = e.evaluate([circle, arrow]);
    expect(result.token).toBe('specific');
  });
});
