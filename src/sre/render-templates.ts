// Render the locked dictionary as a single SVG cheat sheet.
// Open the output file in a browser; use it as a reference while drawing
// real templates via the 📌 button on the canvas UI.
//
// Three sections, color-coded by role:
//   - Geometric units (silver)
//   - Symbol / dual-role units (orange)
//   - Modifier sources (cyan)

import fs from 'node:fs';
import path from 'node:path';
import {
  anchorOutline,
  bellOutline,
  boomerangOutline,
  crescentOutline,
  crownOutline,
  eyeOutline,
  featherOutline,
  flameOutline,
  flaskOutline,
  hammerOutline,
  heartOutline,
  shieldOutline,
  skullOutline,
  snowflakeOutline,
  spiralOutline,
  starOutline,
  tearOutline,
  waveOutline,
} from './templates.js';
import {
  canonicalize,
  type Bbox,
  type CanonicalForm,
} from './canonicalize.js';
import type { NormalizedPoint, ShapeName } from './types.js';

interface Glyph {
  name: string;
  shape: ShapeName | null; // null when only used for visual reference (e.g., shuriken from starOutline)
  outline: NormalizedPoint[];
  closed: boolean;
  group: 'unit' | 'symbol' | 'modifier';
}

// Use canonicalize.ts to get clean polygon outlines at a unit bbox.
const UNIT_BBOX: Bbox = { minX: -50, minY: -50, maxX: 50, maxY: 50 };
function canon(name: ShapeName): CanonicalForm | null {
  return canonicalize(name, UNIT_BBOX, { rotation: 0 });
}
function canonOutline(name: ShapeName): { outline: NormalizedPoint[]; closed: boolean } {
  const c = canon(name);
  if (!c) return { outline: [], closed: true };
  return { outline: c.points, closed: c.closed };
}

const GLYPHS: Glyph[] = [
  // Geometric units
  { name: 'triangle', shape: 'triangle', ...canonOutline('triangle'), group: 'unit' },
  { name: 'circle', shape: 'circle', ...canonOutline('circle'), group: 'unit' },
  { name: 'square', shape: 'square', ...canonOutline('square'), group: 'unit' },
  { name: 'rectangle', shape: 'rectangle', ...canonOutline('rectangle'), group: 'unit' },
  { name: 'rhombus (monk)', shape: 'rhombus', ...canonOutline('rhombus'), group: 'unit' },
  { name: 'diamond (charger)', shape: 'diamond', ...canonOutline('diamond'), group: 'unit' },
  { name: 'trapezoid (net)', shape: 'trapezoid', ...canonOutline('trapezoid'), group: 'unit' },
  { name: 'pentagon', shape: 'pentagon', ...canonOutline('pentagon'), group: 'unit' },
  { name: 'hexagon', shape: 'hexagon', ...canonOutline('hexagon'), group: 'unit' },
  { name: 'heptagon', shape: 'heptagon', ...canonOutline('heptagon'), group: 'unit' },
  { name: 'octagon', shape: 'octagon', ...canonOutline('octagon'), group: 'unit' },
  { name: 'nonagon', shape: 'nonagon', ...canonOutline('nonagon'), group: 'unit' },
  { name: 'decagon', shape: 'decagon', ...canonOutline('decagon'), group: 'unit' },

  // Symbol / dual-role units
  { name: 'plusSign (heal)', shape: 'plusSign', ...canonOutline('plusSign'), group: 'symbol' },
  { name: 'arrow (spear)', shape: 'arrow', ...canonOutline('arrow'), group: 'symbol' },
  { name: 'arrowDown (debuff)', shape: 'arrowDown', ...canonOutline('arrowDown'), group: 'symbol' },
  { name: 'bolt (scout)', shape: 'bolt', ...canonOutline('bolt'), group: 'symbol' },
  { name: 'tear (alchemist)', shape: 'tear', outline: tearOutline(), closed: true, group: 'symbol' },
  { name: 'shield (paladin)', shape: 'shield', outline: shieldOutline(), closed: true, group: 'symbol' },
  { name: 'star (mage, 6-pt)', shape: 'star', outline: starOutline(6), closed: true, group: 'symbol' },
  { name: 'boomerang', shape: 'boomerang', outline: boomerangOutline(), closed: false, group: 'symbol' },

  // Class units (newly added — synthetic seeds)
  { name: 'shuriken (ninja)', shape: 'shuriken', outline: starOutline(4), closed: true, group: 'symbol' },
  { name: 'flask (alchemist)', shape: 'flask', outline: flaskOutline(), closed: true, group: 'symbol' },
  { name: 'eye (seer)', shape: 'eye', outline: eyeOutline(), closed: true, group: 'symbol' },
  { name: 'hammer (siege)', shape: 'hammer', outline: hammerOutline(), closed: true, group: 'symbol' },
  { name: 'crown (commander)', shape: 'crown', outline: crownOutline(), closed: true, group: 'symbol' },
  { name: 'bell (bard)', shape: 'bell', outline: bellOutline(), closed: true, group: 'symbol' },

  // Modifier sources (inner-only)
  { name: 'flame (fire mod)', shape: 'flame', outline: flameOutline(), closed: true, group: 'modifier' },
  { name: 'wave (water mod)', shape: 'wave', outline: waveOutline(), closed: false, group: 'modifier' },
  { name: 'feather (wind mod)', shape: 'feather', outline: featherOutline(), closed: true, group: 'modifier' },
  { name: 'snowflake (ice mod)', shape: 'snowflake', outline: snowflakeOutline(), closed: true, group: 'modifier' },
  { name: 'crescent (shadow)', shape: 'crescent', outline: crescentOutline(), closed: false, group: 'modifier' },
  { name: 'sun (holy mod)', shape: 'sun', ...canonOutline('sun'), group: 'modifier' },
  { name: 'skull (necro mod)', shape: 'skull', outline: skullOutline(), closed: true, group: 'modifier' },
  { name: 'hourglass (time)', shape: 'hourglass', ...canonOutline('hourglass'), group: 'modifier' },
  { name: 'anchor (root mod)', shape: 'anchor', outline: anchorOutline(), closed: true, group: 'modifier' },
  { name: 'heart (lifesteal)', shape: 'heart', outline: heartOutline(), closed: true, group: 'modifier' },
  { name: 'spiral (confusion)', shape: 'spiral', outline: spiralOutline(), closed: false, group: 'modifier' },
];

const CELL_SIZE = 200;
const CELL_PAD = 30;
const COLS = 5;
const ROWS = Math.ceil(GLYPHS.length / COLS);
const SHEET_W = COLS * CELL_SIZE;
const SHEET_H = ROWS * CELL_SIZE;

const STROKE_BY_GROUP: Record<Glyph['group'], string> = {
  unit: '#e8e8ea',
  symbol: '#e8a13a',
  modifier: '#6fb5c9',
};

function fitToCell(outline: NormalizedPoint[]): NormalizedPoint[] {
  if (outline.length === 0) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of outline) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const inner = CELL_SIZE - 2 * CELL_PAD;
  const scale = Math.min(inner / Math.max(w, 1), inner / Math.max(h, 1));
  const cx = CELL_SIZE / 2;
  const cy = CELL_SIZE / 2;
  return outline.map((p) => ({
    x: cx + (p.x - (minX + maxX) / 2) * scale,
    y: cy + (p.y - (minY + maxY) / 2) * scale,
  }));
}

function pathFromOutline(pts: NormalizedPoint[], closed: boolean): string {
  if (pts.length === 0) return '';
  let d = `M${pts[0]!.x.toFixed(1)},${pts[0]!.y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L${pts[i]!.x.toFixed(1)},${pts[i]!.y.toFixed(1)}`;
  }
  if (closed) d += ' Z';
  return d;
}

const svgParts: string[] = [];
svgParts.push(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}" width="${SHEET_W}" height="${SHEET_H}">`,
);
svgParts.push(`<rect width="${SHEET_W}" height="${SHEET_H}" fill="#0a0a12"/>`);
svgParts.push(
  `<style>text { font-family: ui-monospace, monospace; font-size: 11px; fill: #c4c4c8; } .border { stroke: #2a2a36; fill: none; }</style>`,
);

for (let i = 0; i < GLYPHS.length; i++) {
  const g = GLYPHS[i]!;
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const ox = col * CELL_SIZE;
  const oy = row * CELL_SIZE;

  svgParts.push(
    `<rect class="border" x="${ox + 0.5}" y="${oy + 0.5}" width="${CELL_SIZE - 1}" height="${CELL_SIZE - 1}"/>`,
  );

  const fitted = fitToCell(g.outline);
  const translated = fitted.map((p) => ({ x: p.x + ox, y: p.y + oy }));
  svgParts.push(
    `<path d="${pathFromOutline(translated, g.closed)}" stroke="${STROKE_BY_GROUP[g.group]}" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`,
  );

  svgParts.push(`<text x="${ox + 8}" y="${oy + CELL_SIZE - 8}">${g.name}</text>`);
}

// Legend strip at the bottom
const legendY = SHEET_H - 18;
svgParts.push(
  `<rect x="0" y="${SHEET_H - 32}" width="${SHEET_W}" height="32" fill="#15151e"/>`,
);
svgParts.push(
  `<text x="20" y="${legendY}" fill="${STROKE_BY_GROUP.unit}">■ geometric unit</text>`,
);
svgParts.push(
  `<text x="200" y="${legendY}" fill="${STROKE_BY_GROUP.symbol}">■ symbol / dual-role unit</text>`,
);
svgParts.push(
  `<text x="430" y="${legendY}" fill="${STROKE_BY_GROUP.modifier}">■ modifier source (inner-only)</text>`,
);

svgParts.push('</svg>');

const out = svgParts.join('\n');
const outPath = path.resolve('samples/templates-reference.svg');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out, 'utf8');
console.log(`wrote ${outPath} (${out.length} bytes, ${GLYPHS.length} glyphs)`);
