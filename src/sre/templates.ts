// $Q template registry for iconic glyphs.
//
// These are SYNTHETIC seed templates — hand-defined parametric outlines
// approximating each glyph's canonical form. They're enough to bootstrap
// the recognizer; in production we'd augment with real human drawings
// (Quick Draw dataset has clean human samples for most of these glyphs).
//
// Each glyph has 1–3 templates (variants) so $Q can match against the
// closest representation regardless of how the user drew it.

import { buildTemplate, type QTemplate } from './qdollar.js';
import type { NormalizedPoint, ShapeName } from './types.js';

// ============================================================================
// Parametric helpers — sample each glyph's canonical curve at many points
// for the resampler to consume.
// ============================================================================

function sampleParametric(
  fn: (t: number) => NormalizedPoint,
  start: number,
  end: number,
  count = 200,
): NormalizedPoint[] {
  const pts: NormalizedPoint[] = [];
  for (let i = 0; i <= count; i++) {
    const t = start + ((end - start) * i) / count;
    pts.push(fn(t));
  }
  return pts;
}

// ============================================================================
// Glyph definitions — parametric outlines.
// ============================================================================

/** Heart (cardioid-flavored). Standard parametric heart curve. */
export function heartOutline(): NormalizedPoint[] {
  return sampleParametric(
    (t) => ({
      x: 16 * Math.sin(t) ** 3,
      y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
    }),
    0,
    2 * Math.PI,
  );
}

/** N-pointed star outline as a closed polygon. Default 4-point per the
 * dictionary's "avoid 5-point" cultural-sensitivity rule. */
export function starOutline(points = 4, outerR = 80, innerR = 30): NormalizedPoint[] {
  const verts: NormalizedPoint[] = [];
  const total = points * 2;
  for (let i = 0; i <= total; i++) {
    const a = -Math.PI / 2 + (i / total) * 2 * Math.PI;
    const r = i % 2 === 0 ? outerR : innerR;
    verts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return verts;
}

/** Teardrop / water-drop. Closed outline: pointy at top, rounded at bottom. */
export function tearOutline(): NormalizedPoint[] {
  return sampleParametric(
    (t) => ({
      x: 30 * Math.sin(t) * Math.sin(t / 2),
      y: -50 + 50 * (1 - Math.cos(t)),
    }),
    0,
    2 * Math.PI,
  );
}

/** Crescent moon. Open arc with a notch — the outer curve traces a circle,
 * the inner curve traces a smaller offset circle, joining at the tips. */
export function crescentOutline(): NormalizedPoint[] {
  // Outer arc: upper half of a circle, opening down-right
  const outer = sampleParametric(
    (t) => ({ x: 50 * Math.cos(t), y: 50 * Math.sin(t) }),
    Math.PI * 0.25,
    Math.PI * 1.75,
    100,
  );
  // Inner arc back (offset right + smaller)
  const inner = sampleParametric(
    (t) => ({ x: 20 + 40 * Math.cos(t), y: 40 * Math.sin(t) }),
    Math.PI * 1.75,
    Math.PI * 0.25,
    100,
  );
  return [...outer, ...inner];
}

/** Equiangular spiral. Open curve growing outward from center. */
export function spiralOutline(): NormalizedPoint[] {
  return sampleParametric(
    (t) => {
      const r = 5 + t * 8;
      return { x: r * Math.cos(t), y: r * Math.sin(t) };
    },
    0,
    Math.PI * 4,
    200,
  );
}

/** Key — simplified silhouette. Bow (round handle) on the left, shaft + bit
 * on the right with a single tooth. Closed outline. */
export function keyOutline(): NormalizedPoint[] {
  // Bow: arc on the left
  const bow = sampleParametric(
    (t) => ({ x: -50 + 25 * Math.cos(t), y: 25 * Math.sin(t) }),
    Math.PI * 0.25,
    Math.PI * 1.75,
    50,
  );
  // Shaft top, then tooth jut, then shaft bottom — in walk order
  const teeth: NormalizedPoint[] = [
    { x: -32, y: -8 },
    { x: 50, y: -8 },
    { x: 50, y: -16 },
    { x: 60, y: -16 },
    { x: 60, y: 8 },
    { x: 50, y: 8 },
    { x: 50, y: 4 },
    { x: 40, y: 4 },
    { x: 40, y: 8 },
    { x: -32, y: 8 },
  ];
  return [...bow, ...teeth];
}

/** Anchor — simplified silhouette. Vertical stem with a horizontal crossbar
 * near the top, ring at the very top, curve at the bottom. Closed outline. */
export function anchorOutline(): NormalizedPoint[] {
  // Top ring (small circle)
  const ring = sampleParametric(
    (t) => ({ x: 8 * Math.cos(t), y: -50 + 8 * Math.sin(t) }),
    -Math.PI / 2,
    Math.PI * 1.5,
    40,
  );
  // Crossbar + stem + curved bottom (right side, then back up the left)
  const body: NormalizedPoint[] = [
    { x: 0, y: -42 },
    { x: 0, y: -30 },
    { x: 25, y: -30 },
    { x: 25, y: -22 },
    { x: 4, y: -22 },
    { x: 4, y: 30 },
    { x: 30, y: 35 },
    { x: 35, y: 50 },
    { x: 25, y: 55 },
    { x: 5, y: 50 },
    { x: -5, y: 50 },
    { x: -25, y: 55 },
    { x: -35, y: 50 },
    { x: -30, y: 35 },
    { x: -4, y: 30 },
    { x: -4, y: -22 },
    { x: -25, y: -22 },
    { x: -25, y: -30 },
    { x: 0, y: -30 },
  ];
  return [...ring, ...body];
}

/** Skull — simplified peanut-ish silhouette with two eye-socket indents and
 * a jaw notch. Single closed outline. */
export function skullOutline(): NormalizedPoint[] {
  // Top half: rounded cranium
  const top = sampleParametric(
    (t) => ({ x: 35 * Math.cos(t), y: -10 + 35 * Math.sin(t) }),
    Math.PI,
    2 * Math.PI,
    60,
  );
  // Eye socket indents and jaw
  const lower: NormalizedPoint[] = [
    { x: 35, y: -10 },
    { x: 35, y: 15 },
    { x: 22, y: 18 }, // right socket inner
    { x: 18, y: 12 }, // dip (eye)
    { x: 22, y: 8 },
    { x: 12, y: 22 }, // cheek
    { x: 12, y: 30 },
    { x: 8, y: 35 }, // jaw
    { x: 4, y: 30 }, // chin notch
    { x: 0, y: 35 },
    { x: -4, y: 30 },
    { x: -8, y: 35 },
    { x: -12, y: 30 },
    { x: -12, y: 22 },
    { x: -22, y: 8 },
    { x: -18, y: 12 },
    { x: -22, y: 18 },
    { x: -35, y: 15 },
    { x: -35, y: -10 },
  ];
  return [...top, ...lower];
}

/** Boomerang — half-circle arc, concave-up. Open. */
export function boomerangOutline(): NormalizedPoint[] {
  return sampleParametric(
    (t) => ({ x: 50 * Math.cos(t), y: 25 * Math.sin(t) }),
    Math.PI,
    2 * Math.PI,
    100,
  );
}

/** Shield — heater silhouette, broad end up, narrow point at the bottom. */
export function shieldOutline(): NormalizedPoint[] {
  // Top edge: gentle convex curve from upper-left to upper-right
  const top = sampleParametric(
    (t) => ({ x: 35 * Math.cos(t), y: -45 + 6 * Math.sin(t) }),
    Math.PI,
    2 * Math.PI,
    50,
  );
  // Right side curving down to the bottom point
  const rightDown = sampleParametric(
    (t) => ({ x: 35 * Math.cos(t), y: -45 + 90 * Math.sin(t) }),
    0,
    Math.PI / 2,
    50,
  );
  // Bottom point — single vertex
  const bottom: NormalizedPoint[] = [{ x: 0, y: 50 }];
  // Left side back up
  const leftUp = sampleParametric(
    (t) => ({ x: 35 * Math.cos(t), y: -45 + 90 * Math.sin(t) }),
    Math.PI / 2,
    Math.PI,
    50,
  );
  return [...top, ...rightDown, ...bottom, ...leftUp];
}

// ============================================================================
// New-shape outlines (locked dictionary additions). Quick parametric
// silhouettes — recognizable enough to seed $Q until real templates land.
// ============================================================================

/** Flame — teardrop with a wavy edge. Pointy at top, rounded at bottom. */
export function flameOutline(): NormalizedPoint[] {
  const pts: NormalizedPoint[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const w = 28 * Math.sin(Math.PI * t) ** 1.4;
    const wobble = Math.sin(t * 7) * 3 * t;
    pts.push({ x: w + wobble, y: -50 + 100 * t });
  }
  for (let i = 0; i <= 60; i++) {
    const t = 1 - i / 60;
    const w = -28 * Math.sin(Math.PI * t) ** 1.4;
    const wobble = -Math.sin(t * 7) * 3 * t;
    pts.push({ x: w + wobble, y: -50 + 100 * t });
  }
  return pts;
}

/** Wave — open sine, three crests. Single stroke. */
export function waveOutline(): NormalizedPoint[] {
  return sampleParametric(
    (t) => ({ x: -50 + 100 * t, y: 18 * Math.sin(t * 3 * Math.PI) }),
    0,
    1,
    100,
  );
}

/** Feather — symmetric leaf silhouette, pointy top, slightly tapered base. */
export function featherOutline(): NormalizedPoint[] {
  const pts: NormalizedPoint[] = [];
  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    const w = 20 * Math.sin(Math.PI * Math.pow(t, 0.65));
    pts.push({ x: w, y: -50 + 100 * t });
  }
  for (let i = 0; i <= 50; i++) {
    const t = 1 - i / 50;
    const w = -20 * Math.sin(Math.PI * Math.pow(t, 0.65));
    pts.push({ x: w, y: -50 + 100 * t });
  }
  return pts;
}

/** Snowflake — 6-arm radial silhouette traced as a star with deep notches. */
export function snowflakeOutline(): NormalizedPoint[] {
  const verts: NormalizedPoint[] = [];
  const arms = 6;
  const total = arms * 2;
  for (let i = 0; i <= total; i++) {
    const a = -Math.PI / 2 + (i / total) * 2 * Math.PI;
    const r = i % 2 === 0 ? 50 : 12;
    verts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return verts;
}

/** Eye — horizontal almond / vesica piscis. Closed outline. */
export function eyeOutline(): NormalizedPoint[] {
  const pts: NormalizedPoint[] = [];
  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    pts.push({ x: -50 + 100 * t, y: -22 * Math.sin(Math.PI * t) });
  }
  for (let i = 0; i <= 50; i++) {
    const t = 1 - i / 50;
    pts.push({ x: -50 + 100 * t, y: 22 * Math.sin(Math.PI * t) });
  }
  return pts;
}

/** Flask — round bulb + narrow neck. Closed outline. */
export function flaskOutline(): NormalizedPoint[] {
  const verts: NormalizedPoint[] = [
    { x: -8, y: -50 }, // neck top-left
    { x: 8, y: -50 }, // neck top-right
    { x: 8, y: -18 }, // neck bottom-right
  ];
  // Right shoulder + bulb (arc from upper-right around to bottom)
  const right = sampleParametric(
    (t) => ({ x: 32 * Math.cos(t), y: 22 + 28 * Math.sin(t) }),
    -Math.PI / 2,
    Math.PI / 2,
    40,
  );
  verts.push(...right);
  // Left bulb (bottom around to upper-left)
  const left = sampleParametric(
    (t) => ({ x: 32 * Math.cos(t), y: 22 + 28 * Math.sin(t) }),
    Math.PI / 2,
    (3 * Math.PI) / 2,
    40,
  );
  verts.push(...left);
  verts.push({ x: -8, y: -18 }); // neck bottom-left back up
  return verts;
}

/** Hammer — T-silhouette: rectangular head on top, vertical handle below. */
export function hammerOutline(): NormalizedPoint[] {
  return [
    { x: -35, y: -50 }, // head top-left
    { x: 35, y: -50 }, // head top-right
    { x: 35, y: -20 }, // head bottom-right
    { x: 8, y: -20 }, // shoulder right
    { x: 8, y: 50 }, // handle bottom-right
    { x: -8, y: 50 }, // handle bottom-left
    { x: -8, y: -20 }, // shoulder left
    { x: -35, y: -20 }, // head bottom-left
  ];
}

/** Crown — band with three triangular spikes. Closed outline. */
export function crownOutline(): NormalizedPoint[] {
  return [
    { x: -45, y: 20 }, // band bottom-left
    { x: 45, y: 20 }, // band bottom-right
    { x: 45, y: -10 }, // band top-right
    { x: 30, y: 5 }, // dip 1
    { x: 22, y: -45 }, // spike 1 tip (right)
    { x: 12, y: 0 }, // dip 2
    { x: 0, y: -50 }, // center spike tip
    { x: -12, y: 0 }, // dip 3
    { x: -22, y: -45 }, // spike 3 tip (left)
    { x: -30, y: 5 }, // dip 4
    { x: -45, y: -10 }, // band top-left
  ];
}

/** Bell — domed top, flat bottom rim, tiny clapper hint. Closed outline. */
export function bellOutline(): NormalizedPoint[] {
  const pts: NormalizedPoint[] = [];
  // Tiny crown loop at top
  const top = sampleParametric(
    (t) => ({ x: 6 * Math.cos(t), y: -45 + 6 * Math.sin(t) }),
    -Math.PI / 2,
    Math.PI * 1.5,
    24,
  );
  pts.push(...top);
  // Right shoulder of bell down to flange
  const right = sampleParametric(
    (t) => {
      const w = 8 + 30 * Math.sin(t * 0.8);
      const y = -38 + 80 * t;
      return { x: w, y };
    },
    0,
    1,
    40,
  );
  pts.push(...right);
  // Bottom flange right → left
  pts.push({ x: 38, y: 42 });
  pts.push({ x: -38, y: 42 });
  // Left shoulder back up
  const left = sampleParametric(
    (t) => {
      const w = -(8 + 30 * Math.sin((1 - t) * 0.8));
      const y = -38 + 80 * (1 - t);
      return { x: w, y };
    },
    0,
    1,
    40,
  );
  pts.push(...left);
  return pts;
}

// ============================================================================
// v4.2 B-direction additions — quick parametric silhouettes for the 13
// new units (sword, bow, axe, dagger, fang, claw, wing, scroll, orb,
// lantern, gem, boot, helmet). Real human templates will replace these.
// ============================================================================

/** Sword — vertical blade, crossguard near top, pommel + grip on top. */
export function swordOutline(): NormalizedPoint[] {
  return [
    { x: 0, y: -55 },     // tip of pommel
    { x: 4, y: -48 },     // pommel right
    { x: 4, y: -35 },     // grip top right
    { x: 18, y: -35 },    // crossguard right
    { x: 18, y: -28 },    // crossguard bottom right
    { x: 5, y: -28 },     // blade shoulder right
    { x: 5, y: 50 },      // blade right edge
    { x: 0, y: 60 },      // blade tip
    { x: -5, y: 50 },     // blade left edge
    { x: -5, y: -28 },    // blade shoulder left
    { x: -18, y: -28 },   // crossguard bottom left
    { x: -18, y: -35 },   // crossguard left
    { x: -4, y: -35 },    // grip top left
    { x: -4, y: -48 },    // pommel left
  ];
}

/** Bow — vertical curved arc with a string running between the tips.
 *  Single closed outline traversing the bow's outer curve then the string. */
export function bowOutline(): NormalizedPoint[] {
  // Right curve of the bow (tip top → tip bottom going outward)
  const arc = sampleParametric(
    (t) => ({ x: 28 * Math.sin(t), y: -50 * Math.cos(t) }),
    0,
    Math.PI,
    40,
  );
  // String straight back from tip-bottom to tip-top (goes through middle)
  const string: NormalizedPoint[] = [
    { x: 0, y: 50 },
    { x: 0, y: -50 },
  ];
  return [...arc, ...string];
}

/** Axe — vertical handle + asymmetric blade head at the top. Closed outline. */
export function axeOutline(): NormalizedPoint[] {
  return [
    { x: -2, y: 55 },     // handle bottom-left
    { x: 2, y: 55 },      // handle bottom-right
    { x: 2, y: -25 },     // handle top-right
    { x: 25, y: -25 },    // blade outer-right
    { x: 30, y: -45 },    // blade top-right
    { x: 5, y: -55 },     // blade top-left (curves to the handle)
    { x: -5, y: -55 },    // blade peak-back
    { x: -25, y: -50 },   // blade outer-left
    { x: -28, y: -28 },   // blade bottom-left
    { x: -2, y: -25 },    // handle top-left
  ];
}

/** Dagger — small bladed silhouette: crossguard + tapered blade. Distinct
 *  from sword by being shorter overall, with a less prominent pommel. */
export function daggerOutline(): NormalizedPoint[] {
  return [
    { x: 0, y: -45 },     // pommel tip
    { x: 3, y: -38 },     // pommel right
    { x: 3, y: -28 },     // grip top right
    { x: 12, y: -28 },    // crossguard right
    { x: 12, y: -22 },    // crossguard bottom right
    { x: 4, y: -22 },     // blade shoulder right
    { x: 0, y: 50 },      // blade tip
    { x: -4, y: -22 },    // blade shoulder left
    { x: -12, y: -22 },   // crossguard bottom left
    { x: -12, y: -28 },   // crossguard left
    { x: -3, y: -28 },    // grip top left
    { x: -3, y: -38 },    // pommel left
  ];
}

/** Fang — single curved tooth: tapers from wide root to a sharp curved point. */
export function fangOutline(): NormalizedPoint[] {
  // Right edge of fang from root (top) curving to tip (bottom-right)
  const right = sampleParametric(
    (t) => ({ x: 18 * (1 - t * t), y: -50 + 100 * t }),
    0,
    1,
    30,
  );
  // Left edge tapering more sharply (the inner curve of the curved tooth)
  const left = sampleParametric(
    (t) => ({ x: -18 + 22 * t * t, y: -50 + 100 * t }),
    0,
    1,
    30,
  );
  return [...right, ...left.reverse()];
}

/** Claw — three curved spikes radiating downward from a top hub. */
export function clawOutline(): NormalizedPoint[] {
  const pts: NormalizedPoint[] = [];
  // Three spikes: each is a thin pointed triangle
  const spikes = [
    { angle: -Math.PI / 3, len: 50 },
    { angle: 0, len: 55 },
    { angle: Math.PI / 3, len: 50 },
  ];
  // Trace top edge across (left-most spike outer-edge then base then right-most)
  const top: NormalizedPoint[] = [{ x: -25, y: -45 }, { x: 25, y: -45 }];
  pts.push(...top);
  // Walk down the rightmost spike (outer right → tip → inner right)
  for (const s of spikes) {
    const tipX = Math.sin(s.angle) * s.len;
    const tipY = Math.cos(s.angle) * s.len;
    pts.push({ x: tipX + 4 * Math.cos(s.angle), y: tipY - 4 * Math.sin(s.angle) });
    pts.push({ x: tipX, y: tipY });
    pts.push({ x: tipX - 4 * Math.cos(s.angle), y: tipY + 4 * Math.sin(s.angle) });
  }
  return pts;
}

/** Wing — feathered wing silhouette. Asymmetric: leading edge on top
 *  is straighter, trailing edge underneath has the feather scallops. */
export function wingOutline(): NormalizedPoint[] {
  // Leading edge: straight line from shoulder to tip
  const leading: NormalizedPoint[] = [
    { x: -45, y: -10 },   // shoulder
    { x: 50, y: -25 },    // wing tip
  ];
  // Trailing edge: scalloped feathers from tip back to shoulder
  const trailing = sampleParametric(
    (t) => {
      const u = 1 - t;
      const baseX = -45 + 95 * u;
      const baseY = -10 + 35 * (1 - u * u); // dips down then rises
      const scallop = Math.sin(t * 12) * 3 * (1 - t); // small wave that fades
      return { x: baseX, y: baseY + scallop };
    },
    0,
    1,
    50,
  );
  return [...leading, ...trailing];
}

/** Scroll — rolled paper silhouette: two curled ends joined by middle. */
export function scrollOutline(): NormalizedPoint[] {
  // Left curl
  const leftCurl = sampleParametric(
    (t) => ({
      x: -45 + 10 * Math.cos(t),
      y: 10 * Math.sin(t),
    }),
    -Math.PI / 2,
    Math.PI * 1.5,
    24,
  );
  // Top edge of scroll
  const topEdge: NormalizedPoint[] = [
    { x: -45, y: -10 },
    { x: 35, y: -10 },
  ];
  // Right curl
  const rightCurl = sampleParametric(
    (t) => ({
      x: 35 + 10 * Math.cos(t),
      y: 10 * Math.sin(t),
    }),
    Math.PI / 2,
    Math.PI * 2.5,
    24,
  );
  // Bottom edge back
  const bottomEdge: NormalizedPoint[] = [
    { x: 35, y: 10 },
    { x: -45, y: 10 },
  ];
  return [...leftCurl, ...topEdge, ...rightCurl, ...bottomEdge];
}

/** Orb — circle with an inner highlight crescent. Distinguishes from a
 *  plain `circle` only by an interior accent stroke (multistroke ideal). */
export function orbOutline(): NormalizedPoint[] {
  // Outer circle
  return sampleParametric(
    (t) => ({ x: 45 * Math.cos(t), y: 45 * Math.sin(t) }),
    0,
    2 * Math.PI,
    60,
  );
  // Note: the inner highlight is a multistroke addition at draw time;
  // the synthetic seed is just the outer circle. Real templates will
  // discriminate orb from circle.
}

/** Lantern — boxy body with a hanging loop on top and a flame inside. */
export function lanternOutline(): NormalizedPoint[] {
  // Hanging hook at top
  const hook = sampleParametric(
    (t) => ({ x: 8 * Math.cos(t), y: -55 + 8 * Math.sin(t) }),
    Math.PI,
    2 * Math.PI,
    20,
  );
  // Hook stem down to the body cap
  const body: NormalizedPoint[] = [
    { x: 0, y: -47 }, // hook bottom
    { x: 22, y: -45 }, // top-right cap
    { x: 28, y: -38 }, // body shoulder right
    { x: 28, y: 35 }, // body bottom-right
    { x: 22, y: 50 }, // base-right
    { x: -22, y: 50 }, // base-left
    { x: -28, y: 35 }, // body bottom-left
    { x: -28, y: -38 }, // body shoulder left
    { x: -22, y: -45 }, // top-left cap
  ];
  return [...hook, ...body];
}

/** Gem — multi-faceted cut, like an emerald-cut diamond. Hexagonal
 *  silhouette distinguishes it from the rhombus `diamond` unit. */
export function gemOutline(): NormalizedPoint[] {
  return [
    { x: -22, y: -30 }, // top-left
    { x: 22, y: -30 },  // top-right
    { x: 35, y: -10 },  // upper-right facet
    { x: 22, y: 35 },   // lower-right facet
    { x: 0, y: 50 },    // bottom point
    { x: -22, y: 35 },  // lower-left facet
    { x: -35, y: -10 }, // upper-left facet
  ];
}

/** Boot — L-shaped boot with a heel. Closed outline. */
export function bootOutline(): NormalizedPoint[] {
  return [
    { x: -15, y: -50 }, // top-left of cuff
    { x: 15, y: -50 },  // top-right of cuff
    { x: 15, y: 25 },   // right side down
    { x: 35, y: 25 },   // toe top-right
    { x: 40, y: 35 },   // toe outer-right
    { x: 40, y: 50 },   // sole right
    { x: -15, y: 50 },  // sole left (heel back)
    { x: -15, y: -50 }, // heel back to top
  ];
}

/** Helmet — rounded dome on top with a horizontal visor slot. */
export function helmetOutline(): NormalizedPoint[] {
  // Domed top
  const dome = sampleParametric(
    (t) => ({ x: 35 * Math.cos(t), y: 5 + 45 * Math.sin(t) }),
    Math.PI,
    2 * Math.PI,
    40,
  );
  // Right side down to neck guard, then visor slot, then back up
  const lower: NormalizedPoint[] = [
    { x: 35, y: 5 },     // right brim start
    { x: 35, y: 22 },    // right neck guard
    { x: 25, y: 25 },    // jaw line right
    { x: 25, y: 12 },    // visor slot right
    { x: -25, y: 12 },   // visor slot left
    { x: -25, y: 25 },   // jaw line left
    { x: -35, y: 22 },   // left neck guard
    { x: -35, y: 5 },    // left brim start
  ];
  return [...dome, ...lower];
}

// ============================================================================
// Template registry
// ============================================================================

interface TemplateSeed {
  name: ShapeName;
  label: string;
  vertices: NormalizedPoint[];
}

const SEEDS: TemplateSeed[] = [
  { name: 'heart', label: 'heart', vertices: heartOutline() },
  // Shuriken = the 4-point star (ninja class). Star (mystical magic) is 6-point only.
  { name: 'shuriken', label: 'shuriken (4-point)', vertices: starOutline(4) },
  { name: 'star', label: 'star (6-point)', vertices: starOutline(6) },
  { name: 'tear', label: 'tear', vertices: tearOutline() },
  { name: 'crescent', label: 'crescent', vertices: crescentOutline() },
  { name: 'spiral', label: 'spiral', vertices: spiralOutline() },
  { name: 'anchor', label: 'anchor', vertices: anchorOutline() },
  { name: 'skull', label: 'skull', vertices: skullOutline() },
  { name: 'boomerang', label: 'boomerang', vertices: boomerangOutline() },
  { name: 'shield', label: 'shield', vertices: shieldOutline() },
  // Newly-locked dictionary additions — synthetic seeds. Will be augmented
  // with real human templates as Alex draws them.
  { name: 'flame', label: 'flame', vertices: flameOutline() },
  { name: 'wave', label: 'wave', vertices: waveOutline() },
  { name: 'feather', label: 'feather', vertices: featherOutline() },
  { name: 'snowflake', label: 'snowflake', vertices: snowflakeOutline() },
  { name: 'eye', label: 'eye', vertices: eyeOutline() },
  { name: 'flask', label: 'flask', vertices: flaskOutline() },
  { name: 'hammer', label: 'hammer', vertices: hammerOutline() },
  { name: 'crown', label: 'crown', vertices: crownOutline() },
  { name: 'bell', label: 'bell', vertices: bellOutline() },
  // v4.2 B-direction additions — synthetic seeds, will be augmented with
  // real human templates and Quick Draw imports.
  { name: 'sword', label: 'sword', vertices: swordOutline() },
  { name: 'bow', label: 'bow', vertices: bowOutline() },
  { name: 'axe', label: 'axe', vertices: axeOutline() },
  { name: 'dagger', label: 'dagger', vertices: daggerOutline() },
  { name: 'fang', label: 'fang', vertices: fangOutline() },
  { name: 'claw', label: 'claw', vertices: clawOutline() },
  { name: 'wing', label: 'wing', vertices: wingOutline() },
  { name: 'scroll', label: 'scroll', vertices: scrollOutline() },
  { name: 'orb', label: 'orb', vertices: orbOutline() },
  { name: 'lantern', label: 'lantern', vertices: lanternOutline() },
  { name: 'gem', label: 'gem', vertices: gemOutline() },
  { name: 'boot', label: 'boot', vertices: bootOutline() },
  { name: 'helmet', label: 'helmet', vertices: helmetOutline() },
];

let cachedSyntheticTemplates: QTemplate[] | null = null;
let runtimeTemplates: QTemplate[] = [];

/** Build the synthetic seed templates lazily on first request. */
function getSyntheticTemplates(): QTemplate[] {
  if (cachedSyntheticTemplates === null) {
    cachedSyntheticTemplates = SEEDS.map((s) => buildTemplate(s.name, s.vertices, s.label));
  }
  return cachedSyntheticTemplates;
}

/** Get the full $Q template library — synthetic seeds + runtime templates
 * (real human drawings the user has saved). Runtime templates are appended
 * AFTER seeds so when distances tie, the more-recent (and generally more
 * accurate) human drawing wins (cloud-match picks the lowest distance, so
 * order matters only for exact ties). */
export function getQTemplates(): QTemplate[] {
  return [...getSyntheticTemplates(), ...runtimeTemplates];
}

/** Replace the runtime template library — called by the UI after fetching
 * templates from the server on app load, and after a new save. */
export function setRuntimeTemplates(templates: QTemplate[]): void {
  runtimeTemplates = templates;
}

/** Add a single runtime template (called after the user saves one without
 * re-fetching the whole library). */
export function addRuntimeTemplate(template: QTemplate): void {
  runtimeTemplates = [...runtimeTemplates, template];
}

export function getRuntimeTemplateCount(): number {
  return runtimeTemplates.length;
}

/** Reset both caches — used by tests. */
export function resetTemplateCache(): void {
  cachedSyntheticTemplates = null;
  runtimeTemplates = [];
}
