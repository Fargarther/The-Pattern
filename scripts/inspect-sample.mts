// Run a single sample through the full feature pipeline and dump the
// numeric features + per-recognizer scores. Use this to debug a specific
// misread:
//   npx tsx scripts/inspect-sample.mts samples/2026-05-06T19-52-18-697Z-diamond-5.json

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { preprocessStrokes } from '../src/sre/preprocessing.js';
import { extractFeatures } from '../src/sre/features.js';
import {
  recognizeTriangle, recognizeCircle, recognizeSquare, recognizeRectangle,
  recognizeRhombus, recognizeDiamond, recognizeTrapezoid,
  recognizePentagon, recognizeHexagon, recognizeHeptagon, recognizeOctagon,
  recognizeNonagon, recognizeDecagon,
  recognizePlusSign, recognizeArrow, recognizeArrowDown,
  recognizeBolt, recognizeHourglass, recognizeSun,
} from '../src/sre/recognizers.js';
import type { Stroke, RawPoint } from '../src/sre/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function normalizeStroke(s: Stroke): Stroke {
  const points: RawPoint[] = (s.points ?? []).map((p) => ({
    x: p.x, y: p.y, t: typeof p.t === 'number' ? p.t : 0,
    pressure: p.pressure ?? 0.5, pointerType: p.pointerType ?? 'mouse',
  }));
  return {
    points,
    startTime: s.startTime ?? 0,
    endTime: s.endTime ?? 0,
    pointerType: s.pointerType ?? 'mouse',
  };
}

const filename = process.argv[2];
if (!filename) {
  console.error('usage: npx tsx scripts/inspect-sample.mts <sample.json>');
  process.exit(1);
}

const filePath = path.isAbsolute(filename) ? filename : path.join(ROOT, filename);
const raw = await fs.readFile(filePath, 'utf8');
const s = JSON.parse(raw) as Record<string, unknown>;

const strokes: Stroke[] =
  Array.isArray(s.strokes) && s.strokes.length > 0
    ? (s.strokes as Stroke[]).map(normalizeStroke)
    : s.stroke && typeof s.stroke === 'object'
      ? [normalizeStroke(s.stroke as Stroke)]
      : [];

console.log(`label: ${s.label as string}`);
console.log(`strokes: ${strokes.length}, first=${strokes[0]?.points.length} points`);

const norm = preprocessStrokes(strokes);
const f = extractFeatures(norm);

console.log('\n=== features ===');
console.log(`isClosed:           ${f.isClosed}`);
console.log(`closureDistance:    ${f.closureDistance.toFixed(4)}`);
console.log(`cornerCount:        ${f.cornerCount}`);
console.log(`cornerTurnRatio:    ${f.cornerTurnRatio.toFixed(3)}`);
console.log(`bboxAspectRatio:    ${f.bboxAspectRatio.toFixed(3)} (${f.bboxAspectRatio < 1 ? 'tall' : f.bboxAspectRatio > 1 ? 'wide' : 'square'})`);
console.log(`bboxWidth/Height:   ${f.bboxWidth.toFixed(1)} × ${f.bboxHeight.toFixed(1)}`);
console.log(`totalAbsoluteAngle: ${(f.totalAbsoluteAngle / (2 * Math.PI)).toFixed(2)}× 2π`);
console.log(`totalSignedAngle:   ${(f.totalSignedAngle / (2 * Math.PI)).toFixed(2)}× 2π`);
console.log(`sideLengthCV:       ${f.sideLengthCV.toFixed(3)}`);
console.log(`rotationalSym4:     ${f.rotationalSymmetry4.toFixed(3)}`);
console.log(`horizontalSym:      ${f.horizontalSymmetry.toFixed(3)}`);
console.log(`verticalSym:        ${f.verticalSymmetry.toFixed(3)}`);
console.log(`dcr:                ${f.dcr.toFixed(3)}`);
console.log(`cornerSignedAngles: [${f.cornerSignedAngles.map((a) => (a / Math.PI * 180).toFixed(0) + '°').join(', ')}]`);

console.log('\n=== rule-based recognizer scores ===');
const recognizers: [string, (f: typeof f) => number][] = [
  ['triangle', recognizeTriangle], ['circle', recognizeCircle],
  ['square', recognizeSquare], ['rectangle', recognizeRectangle],
  ['rhombus', recognizeRhombus], ['diamond', recognizeDiamond],
  ['trapezoid', recognizeTrapezoid],
  ['pentagon', recognizePentagon], ['hexagon', recognizeHexagon],
  ['heptagon', recognizeHeptagon], ['octagon', recognizeOctagon],
  ['nonagon', recognizeNonagon], ['decagon', recognizeDecagon],
  ['plusSign', recognizePlusSign],
  ['arrow', recognizeArrow], ['arrowDown', recognizeArrowDown],
  ['bolt', recognizeBolt], ['hourglass', recognizeHourglass],
  ['sun', recognizeSun],
];
const scored = recognizers
  .map(([name, fn]) => ({ name, score: fn(f) }))
  .filter((r) => r.score > 0)
  .sort((a, b) => b.score - a.score);
for (const r of scored) {
  console.log(`  ${r.name.padEnd(11)} ${r.score.toFixed(3)}`);
}
if (scored.length === 0) console.log('  (no recognizer scored above 0)');
