// One-shot importer: turn samples/*.json into templates-runtime/*.json
// for $Q. Parses the label to find the canonical ShapeName (with typo
// aliases), pulls out the stroke points, and writes the minimal template
// JSON the runtime loader expects: { shape, points: [{x,y}] }.
//
// Usage: node scripts/import-samples-as-templates.mjs
//
// Re-runnable. Outputs a per-shape count summary.

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\//, ''), '..');
const SAMPLES_DIR = path.join(ROOT, 'samples');
const TEMPLATES_DIR = path.join(ROOT, 'templates-runtime');

const KNOWN_SHAPES = new Set([
  'triangle', 'circle', 'square', 'rectangle', 'rhombus', 'diamond', 'trapezoid',
  'pentagon', 'hexagon', 'heptagon', 'octagon', 'nonagon', 'decagon',
  'plusSign', 'arrow', 'arrowDown', 'bolt', 'tear', 'shield', 'star', 'boomerang',
  'shuriken', 'flask', 'eye', 'hammer', 'crown', 'bell',
  'sword', 'bow', 'axe', 'dagger', 'fang', 'claw', 'wing',
  'scroll', 'orb', 'lantern', 'gem', 'boot', 'helmet',
  'flame', 'wave', 'feather', 'snowflake', 'crescent', 'sun', 'skull',
  'hourglass', 'anchor', 'heart', 'spiral',
]);

// label-token → canonical ShapeName.
const ALIASES = new Map([
  ['octogon', 'octagon'],
  ['trapazoid', 'trapezoid'],
  ['dianomd', 'diamond'],
  ['downarrow', 'arrowDown'],
  ['plus', 'plusSign'],
  ['run', 'sun'],
  ['ron', 'sun'],
]);

/** Pull the first known shape token out of a sample label. */
function shapeFromLabel(rawLabel) {
  if (typeof rawLabel !== 'string') return null;
  const tokens = rawLabel
    .toLowerCase()
    .split(/[\s_\-]+/)
    .filter(Boolean);
  for (const t of tokens) {
    if (t === 'misread' || t === 'midread' || t === 'missread') return null;
    if (ALIASES.has(t)) return ALIASES.get(t);
    if (KNOWN_SHAPES.has(t)) return t;
  }
  return null;
}

/** Pull a flat point cloud out of either old (`stroke`) or new (`strokes`)
 *  sample formats. */
function pointsFromSample(s) {
  if (Array.isArray(s.strokes) && s.strokes.length > 0) {
    return s.strokes.flatMap((st) =>
      (st.points ?? []).map((p) => ({ x: p.x, y: p.y })),
    );
  }
  if (s.stroke && Array.isArray(s.stroke.points)) {
    return s.stroke.points.map((p) => ({ x: p.x, y: p.y }));
  }
  return [];
}

async function main() {
  await fs.mkdir(TEMPLATES_DIR, { recursive: true });
  const files = (await fs.readdir(SAMPLES_DIR)).filter((f) => f.endsWith('.json'));
  const counts = new Map();
  const skipped = [];
  let written = 0;
  for (const f of files) {
    let raw;
    try {
      raw = await fs.readFile(path.join(SAMPLES_DIR, f), 'utf8');
    } catch (err) {
      skipped.push([f, `read: ${err.message}`]);
      continue;
    }
    let s;
    try {
      s = JSON.parse(raw);
    } catch (err) {
      skipped.push([f, `parse: ${err.message}`]);
      continue;
    }
    const shape = shapeFromLabel(s.label);
    if (!shape) {
      skipped.push([f, `no shape match in "${s.label}"`]);
      continue;
    }
    const points = pointsFromSample(s);
    if (points.length < 4) {
      skipped.push([f, `too few points (${points.length})`]);
      continue;
    }
    const ts = f.replace(/^(\d{4}-\d{2}-\d{2}T[^.]+).*$/, '$1');
    const outName = `${shape}-${ts}.json`;
    const outPath = path.join(TEMPLATES_DIR, outName);
    const out = {
      savedAt: s.savedAt ?? new Date().toISOString(),
      shape,
      points,
      stroke: s.stroke ?? (s.strokes && s.strokes[0]) ?? null,
      importedFrom: f,
    };
    await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
    counts.set(shape, (counts.get(shape) ?? 0) + 1);
    written++;
  }
  console.log(`\nImported ${written} templates from ${files.length} samples.`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`\nPer-shape counts:`);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [s, c] of sorted) console.log(`  ${s.padEnd(12)} ${c}`);
  if (skipped.length > 0) {
    console.log(`\nSkipped reasons (first 20):`);
    for (const [f, why] of skipped.slice(0, 20)) {
      console.log(`  ${f}: ${why}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
