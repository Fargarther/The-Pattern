// Run every sample in samples/ through the full recognition pipeline with
// the expanded template library loaded, and report which ones misread.
//
// Usage:
//   npx tsx scripts/validate-samples.mts
//   npx tsx scripts/validate-samples.mts --only triangle,square
//   npx tsx scripts/validate-samples.mts --verbose      # show per-sample
//
// Reports:
//   - per-shape accuracy (correct / total)
//   - confusion matrix (shape → what it was misread as)
//   - the actual filenames of misreads (so you can inspect them)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { recognizeComposite } from '../src/sre/composite.js';
import { buildTemplate, type QTemplate } from '../src/sre/qdollar.js';
import { setRuntimeTemplates } from '../src/sre/templates.js';
import type { Stroke, RawPoint, ShapeName, NormalizedPoint } from '../src/sre/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES_DIR = path.join(ROOT, 'samples');
const TEMPLATES_DIR = path.join(ROOT, 'templates-runtime');

// Final locked dictionary
const KNOWN_SHAPES = new Set<string>([
  'triangle', 'circle', 'square', 'rectangle', 'rhombus', 'diamond', 'trapezoid',
  'pentagon', 'hexagon', 'heptagon', 'octagon', 'nonagon', 'decagon',
  'plusSign', 'arrow', 'arrowDown', 'bolt', 'tear', 'shield', 'star', 'boomerang',
  'shuriken', 'flask', 'eye', 'hammer', 'crown', 'bell',
  'sword', 'bow', 'axe', 'dagger', 'fang', 'claw', 'wing',
  'scroll', 'orb', 'lantern', 'gem', 'boot', 'helmet',
  'flame', 'wave', 'feather', 'snowflake', 'crescent', 'sun', 'skull',
  'hourglass', 'anchor', 'heart', 'spiral',
]);

const ALIASES = new Map<string, string>([
  ['octogon', 'octagon'],
  ['trapazoid', 'trapezoid'],
  ['dianomd', 'diamond'],
  ['downarrow', 'arrowDown'],
  ['plus', 'plusSign'],
  ['run', 'sun'],
  ['ron', 'sun'],
]);

// ---------- helpers ----------

function shapeFromLabel(rawLabel: unknown): string | null {
  if (typeof rawLabel !== 'string') return null;
  const tokens = rawLabel.toLowerCase().split(/[\s_\-]+/).filter(Boolean);
  for (const t of tokens) {
    if (t === 'misread' || t === 'midread' || t === 'missread') return null;
    if (ALIASES.has(t)) return ALIASES.get(t)!;
    if (KNOWN_SHAPES.has(t)) return t;
  }
  return null;
}

function strokesFromSample(s: Record<string, unknown>): Stroke[] {
  if (Array.isArray(s.strokes) && s.strokes.length > 0) {
    return (s.strokes as Stroke[]).map(normalizeStroke);
  }
  if (s.stroke && typeof s.stroke === 'object') {
    return [normalizeStroke(s.stroke as Stroke)];
  }
  return [];
}

function normalizeStroke(s: Stroke): Stroke {
  const points: RawPoint[] = (s.points ?? []).map((p) => ({
    x: p.x,
    y: p.y,
    t: typeof p.t === 'number' ? p.t : 0,
    pressure: p.pressure ?? 0.5,
    pointerType: p.pointerType ?? 'mouse',
  }));
  return {
    points,
    startTime: s.startTime ?? points[0]?.t ?? 0,
    endTime: s.endTime ?? points[points.length - 1]?.t ?? 0,
    pointerType: s.pointerType ?? 'mouse',
  };
}

async function loadRuntimeTemplates(): Promise<number> {
  await fs.mkdir(TEMPLATES_DIR, { recursive: true });
  const files = await fs.readdir(TEMPLATES_DIR);
  const built: QTemplate[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(TEMPLATES_DIR, f), 'utf8');
      const t = JSON.parse(raw) as { shape?: string; points?: NormalizedPoint[] };
      if (!t.shape || !KNOWN_SHAPES.has(t.shape) || !Array.isArray(t.points) || t.points.length < 4) {
        continue;
      }
      built.push(buildTemplate(t.shape as ShapeName, t.points, t.shape));
    } catch {
      // skip malformed
    }
  }
  setRuntimeTemplates(built);
  return built.length;
}

// ---------- args ----------

const argv = process.argv.slice(2);
const onlyArg = argv.indexOf('--only');
const ONLY: Set<string> | null =
  onlyArg >= 0 ? new Set(argv[onlyArg + 1]!.split(',').map((s) => s.trim())) : null;
const VERBOSE = argv.includes('--verbose');

// ---------- main ----------

interface Result {
  file: string;
  expected: string;
  predicted: string | null;
  confidence: number;
  isCorrect: boolean;
}

async function main() {
  console.log('loading runtime templates...');
  const nRuntime = await loadRuntimeTemplates();
  console.log(`loaded ${nRuntime} runtime templates\n`);

  const files = (await fs.readdir(SAMPLES_DIR)).filter((f) => f.endsWith('.json'));
  const results: Result[] = [];
  let skippedNoLabel = 0;
  let skippedFiltered = 0;

  for (const f of files) {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(SAMPLES_DIR, f), 'utf8');
    } catch {
      continue;
    }
    let s: Record<string, unknown>;
    try {
      s = JSON.parse(raw);
    } catch {
      continue;
    }

    const expected = shapeFromLabel(s.label);
    if (!expected) {
      skippedNoLabel++;
      continue;
    }
    if (ONLY && !ONLY.has(expected)) {
      skippedFiltered++;
      continue;
    }
    const strokes = strokesFromSample(s);
    if (strokes.length === 0 || strokes[0]!.points.length < 4) continue;

    let predicted: string | null = null;
    let confidence = 0;
    try {
      const composite = recognizeComposite(strokes);
      // For non-nested: read the single group's recognition.
      const main = composite.groups[0]?.recognition;
      predicted = main?.shape ?? null;
      confidence = main?.confidence ?? 0;
    } catch (err) {
      predicted = null;
    }

    results.push({
      file: f,
      expected,
      predicted,
      confidence,
      isCorrect: predicted === expected,
    });
  }

  // Per-shape accuracy
  const byShape = new Map<string, Result[]>();
  for (const r of results) {
    if (!byShape.has(r.expected)) byShape.set(r.expected, []);
    byShape.get(r.expected)!.push(r);
  }

  console.log('=== Per-shape accuracy ===');
  console.log('shape         total  correct  acc%');
  const shapeOrder = [...byShape.keys()].sort();
  let totalCorrect = 0;
  let totalAll = 0;
  for (const shape of shapeOrder) {
    const arr = byShape.get(shape)!;
    const correct = arr.filter((r) => r.isCorrect).length;
    const acc = (correct / arr.length) * 100;
    console.log(
      `${shape.padEnd(13)} ${String(arr.length).padStart(5)}  ${String(correct).padStart(7)}  ${acc.toFixed(0).padStart(3)}%`,
    );
    totalCorrect += correct;
    totalAll += arr.length;
  }
  console.log(
    `${'TOTAL'.padEnd(13)} ${String(totalAll).padStart(5)}  ${String(totalCorrect).padStart(7)}  ${((totalCorrect / totalAll) * 100).toFixed(0).padStart(3)}%`,
  );

  // Confusion: expected → predicted (only for incorrects)
  console.log('\n=== Misread breakdown ===');
  for (const shape of shapeOrder) {
    const wrong = byShape.get(shape)!.filter((r) => !r.isCorrect);
    if (wrong.length === 0) continue;
    const counts = new Map<string, number>();
    for (const w of wrong) {
      const key = w.predicted ?? '(unrecognized)';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(
      `${shape.padEnd(13)} → ${sorted.map(([k, n]) => `${k}×${n}`).join(', ')}`,
    );
  }

  if (VERBOSE) {
    console.log('\n=== All misreads (file-level) ===');
    for (const r of results.filter((x) => !x.isCorrect)) {
      console.log(
        `  [${r.expected.padEnd(11)} → ${(r.predicted ?? '(none)').padEnd(11)}, conf ${r.confidence.toFixed(2)}]  ${r.file}`,
      );
    }
  }

  console.log(
    `\nValidated ${results.length} samples (skipped ${skippedNoLabel} without parsable labels${ONLY ? `, ${skippedFiltered} filtered out` : ''}).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
