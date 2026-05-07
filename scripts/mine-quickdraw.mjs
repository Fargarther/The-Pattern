// Quick Draw miner: pull real human drawings from Google's Quick Draw
// dataset, convert each into a $Q template, and drop them into
// templates-runtime/. Skips categories that 404 (some dictionary shapes
// have no QD equivalent — that's fine, they stay synthetic-only).
//
// Re-runnable. Caches downloads in .cache/quickdraw/ so re-runs only
// re-process, not re-download.
//
// Usage:
//   node scripts/mine-quickdraw.mjs
//   node scripts/mine-quickdraw.mjs --per-shape 50    # change sample count
//   node scripts/mine-quickdraw.mjs --only star,heart # filter shapes
//
// Source: https://storage.googleapis.com/quickdraw_dataset/full/simplified/<cat>.ndjson
// License: CC BY 4.0 — usable in shipped product with attribution.

import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\//, ''), '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'quickdraw');
const TEMPLATES_DIR = path.join(ROOT, 'templates-runtime');

// ShapeName → Quick Draw category. Only includes shapes that plausibly map.
// Polygons (rectangle, rhombus, trapezoid, pentagon, heptagon, nonagon,
// decagon) and game-specific shapes (shuriken, plusSign, arrowDown) are
// not in QD — they stay synthetic-only.
// Verified mappings against Quick Draw's 345 categories. Shapes commented
// out have NO QD equivalent — they stay synthetic-only:
//   heart, spiral, arrow, anchor, shield, bell, tear, plusSign, arrowDown,
//   shuriken, rectangle, rhombus, trapezoid, pentagon, heptagon, nonagon,
//   decagon
const SHAPE_TO_QD = {
  triangle: 'triangle',
  circle: 'circle',
  square: 'square',
  hexagon: 'hexagon',
  octagon: 'octagon',
  diamond: 'diamond',
  star: 'star',
  sun: 'sun',
  crescent: 'moon', // crescent ≈ moon in QD
  skull: 'skull',
  crown: 'crown',
  hammer: 'hammer',
  bolt: 'lightning',
  hourglass: 'hourglass',
  boomerang: 'boomerang',
  flame: 'campfire',
  wave: 'ocean',
  feather: 'feather',
  snowflake: 'snowflake',
  eye: 'eye',
  flask: 'wine bottle',
  // v4.2 B-direction additions with QD analogues
  sword: 'sword',
  axe: 'axe',
  dagger: 'knife',     // QD has knife; dagger silhouettes match closely enough
  fang: 'tooth',       // single curved tooth is the closest QD analogue
  helmet: 'helmet',
  lantern: 'lantern',
  boot: 'shoe',
  // No QD equivalent: bow, claw, wing, scroll, orb, gem — synthetic-only
};

const QD_BASE = 'https://storage.googleapis.com/quickdraw_dataset/full/simplified';

// CLI args
const argv = process.argv.slice(2);
function argVal(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}
const PER_SHAPE = parseInt(argVal('--per-shape') ?? '30', 10);
const ONLY = argVal('--only')?.split(',').map((s) => s.trim()).filter(Boolean);

// ---------- Helpers ----------

async function fileExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Download a category's NDJSON to the cache, or no-op if already there. */
async function fetchCategory(cat) {
  const cachePath = path.join(CACHE_DIR, `${cat.replace(/\s+/g, '_')}.ndjson`);
  if (await fileExists(cachePath)) {
    return { cachePath, downloaded: false };
  }
  const url = `${QD_BASE}/${encodeURIComponent(cat)}.ndjson`;
  const res = await fetch(url);
  if (!res.ok) {
    return { cachePath: null, downloaded: false, status: res.status };
  }
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await pipeline(res.body, createWriteStream(cachePath));
  return { cachePath, downloaded: true };
}

/** Read the first N lines of a NDJSON file. */
async function readNdjson(p, maxLines) {
  const raw = await fs.readFile(p, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  return lines.slice(0, maxLines).map((l) => JSON.parse(l));
}

/** Convert a Quick Draw "drawing" (array of strokes, each [xs, ys]) to a
 *  flat NormalizedPoint[] cloud. */
function drawingToPoints(drawing) {
  const pts = [];
  for (const stroke of drawing) {
    const [xs, ys] = stroke;
    for (let i = 0; i < xs.length; i++) {
      pts.push({ x: xs[i], y: ys[i] });
    }
  }
  return pts;
}

/** Filter: drawing must be plausibly clean. Reject too-short, too-long,
 *  or too-many-strokes drawings. */
function isCleanDrawing(d) {
  if (!Array.isArray(d.drawing)) return false;
  if (d.drawing.length < 1 || d.drawing.length > 4) return false;
  const total = d.drawing.reduce((s, st) => s + (st[0]?.length ?? 0), 0);
  if (total < 20 || total > 400) return false;
  return true;
}

// ---------- Main ----------

async function main() {
  await fs.mkdir(TEMPLATES_DIR, { recursive: true });

  const shapes = ONLY ?? Object.keys(SHAPE_TO_QD);
  const summary = [];

  for (const shape of shapes) {
    const qdCategory = SHAPE_TO_QD[shape];
    if (!qdCategory) {
      summary.push({ shape, status: 'no-mapping', count: 0 });
      continue;
    }

    process.stdout.write(`[${shape}] → "${qdCategory}" ... `);

    let cache;
    try {
      cache = await fetchCategory(qdCategory);
    } catch (err) {
      console.log(`fetch error: ${err.message}`);
      summary.push({ shape, status: 'fetch-error', count: 0, err: err.message });
      continue;
    }

    if (!cache.cachePath) {
      console.log(`HTTP ${cache.status} — skipped`);
      summary.push({ shape, status: `http-${cache.status}`, count: 0 });
      continue;
    }

    if (cache.downloaded) {
      const sz = (await fs.stat(cache.cachePath)).size;
      process.stdout.write(`downloaded ${(sz / 1024 / 1024).toFixed(1)} MB; `);
    } else {
      process.stdout.write(`(cached); `);
    }

    // Read enough lines to get PER_SHAPE clean drawings.
    let raw;
    try {
      raw = await readNdjson(cache.cachePath, PER_SHAPE * 5);
    } catch (err) {
      console.log(`parse error: ${err.message}`);
      summary.push({ shape, status: 'parse-error', count: 0 });
      continue;
    }

    const clean = raw.filter(isCleanDrawing).slice(0, PER_SHAPE);
    let written = 0;
    for (let i = 0; i < clean.length; i++) {
      const d = clean[i];
      const points = drawingToPoints(d.drawing);
      if (points.length < 4) continue;
      const out = {
        savedAt: new Date().toISOString(),
        shape,
        points,
        importedFrom: `quickdraw:${qdCategory}#${d.key_id ?? i}`,
      };
      const outName = `${shape}-qd-${String(i).padStart(3, '0')}.json`;
      await fs.writeFile(path.join(TEMPLATES_DIR, outName), JSON.stringify(out, null, 2), 'utf8');
      written++;
    }
    console.log(`${written} templates written`);
    summary.push({ shape, status: 'ok', count: written, qd: qdCategory });
  }

  console.log(`\n=== Summary ===`);
  const ok = summary.filter((s) => s.status === 'ok');
  const skipped = summary.filter((s) => s.status !== 'ok');
  const totalWritten = ok.reduce((s, x) => s + x.count, 0);
  console.log(`Wrote ${totalWritten} templates across ${ok.length} shapes.`);
  for (const s of ok) {
    console.log(`  ${s.shape.padEnd(12)} ${String(s.count).padStart(3)}  (qd: "${s.qd}")`);
  }
  if (skipped.length > 0) {
    console.log(`\nSkipped (${skipped.length}):`);
    for (const s of skipped) {
      console.log(`  ${s.shape.padEnd(12)} ${s.status}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
