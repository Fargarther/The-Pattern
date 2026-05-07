// Dump the per-sample turning angles for a single sample so we can see
// where corners are vs. where the recognizer detected them.
//   npx tsx scripts/dump-angles.mts <file>

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { preprocessStrokes } from '../src/sre/preprocessing.js';
import { extractFeatures } from '../src/sre/features.js';
import { turningAngles } from '../src/sre/geometry.js';
import type { Stroke, RawPoint } from '../src/sre/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.isAbsolute(process.argv[2]!) ? process.argv[2]! : path.join(ROOT, process.argv[2]!);
const raw = await fs.readFile(filePath, 'utf8');
const s = JSON.parse(raw) as Record<string, unknown>;

function normalizeStroke(s: Stroke): Stroke {
  const points: RawPoint[] = (s.points ?? []).map((p) => ({
    x: p.x, y: p.y, t: typeof p.t === 'number' ? p.t : 0,
    pressure: p.pressure ?? 0.5, pointerType: p.pointerType ?? 'mouse',
  }));
  return { points, startTime: 0, endTime: 0, pointerType: 'mouse' };
}

const strokes: Stroke[] =
  Array.isArray(s.strokes) && s.strokes.length > 0
    ? (s.strokes as Stroke[]).map(normalizeStroke)
    : s.stroke && typeof s.stroke === 'object'
      ? [normalizeStroke(s.stroke as Stroke)]
      : [];

const norm = preprocessStrokes(strokes);
const angles = turningAngles(norm.points, true);
const f = extractFeatures(norm);

console.log(`label: ${s.label}, isClosed: ${f.isClosed}, cornerCount: ${f.cornerCount}`);
console.log(`detected corners at indices: [${f.cornerIndices.join(', ')}]`);
console.log();
console.log('idx  |angle|  vis (|angle| in degrees as bar; * = detected corner)');
const maxAbs = Math.max(...angles.map(Math.abs));
const corners = new Set(f.cornerIndices);
for (let i = 0; i < angles.length; i++) {
  const a = angles[i]!;
  const absDeg = Math.abs(a) * 180 / Math.PI;
  const barLen = Math.round((Math.abs(a) / maxAbs) * 60);
  const bar = '#'.repeat(barLen);
  const marker = corners.has(i) ? '*' : ' ';
  console.log(`${String(i).padStart(3)} ${absDeg.toFixed(1).padStart(5)}°  ${marker} ${bar}`);
}
