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
