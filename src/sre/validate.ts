import fs from 'node:fs';
import path from 'node:path';
import { recognize } from './recognize.js';
import { preprocessStrokes } from './preprocessing.js';
import { extractFeatures } from './features.js';

const dir = path.resolve('samples');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();

// Map label prefix to expected outcome.
function expectedFor(label: string): string {
  const l = label.toLowerCase();
  if (l.startsWith('triangle')) return 'triangle';
  if (l.startsWith('circle')) return 'circle';
  if (l.startsWith('square')) return 'square';
  // Negatives — should classify as anything-but-not-the-shape-we-have
  if (l.startsWith('v') || l.startsWith('wave')) return 'unrecognized';
  if (l.startsWith('rectangle')) return 'rectangle';
  if (l.startsWith('rhombus')) return 'rhombus';
  if (l.startsWith('diamond')) return 'diamond';
  if (l.startsWith('trapezoid') || l.startsWith('trapazoid')) return 'trapezoid';
  if (l.startsWith('pentagon')) return 'pentagon';
  if (l.startsWith('hexagon')) return 'hexagon';
  if (l.startsWith('heptagon')) return 'heptagon';
  if (l.startsWith('octagon') || l.startsWith('octogon')) return 'octagon';
  if (l.startsWith('plus')) return 'plusSign';
  if (l.startsWith('bolt')) return 'bolt';
  if (l.startsWith('sun') || l.startsWith('run positive') || l.startsWith('run postiive')) return 'sun';
  if (l.startsWith('hourglass')) return 'hourglass';
  if (l.startsWith('arrow')) return 'arrow';
  if (l.startsWith('random')) return 'unrecognized'; // user-marked junk
  if (l.startsWith('nonagon')) return 'nonagon';
  if (l.startsWith('decagon')) return 'decagon';
  return '?';
}

const rows: Array<{ label: string; expected: string; got: string; conf: number; cR: number; corners: number; aspect: number; turn: number; sgnRatio: number }> = [];

for (const f of files) {
  const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const norm = preprocessStrokes([s.stroke]);
  const ft = extractFeatures(norm);
  const r = recognize(ft);
  rows.push({
    label: s.label,
    expected: expectedFor(s.label),
    got: r.shape ?? 'unrecognized',
    conf: r.confidence,
    cR: ft.cornerTurnRatio,
    corners: ft.cornerCount,
    aspect: ft.bboxAspectRatio,
    turn: ft.totalAbsoluteAngle / (2 * Math.PI),
    sgnRatio:
      ft.totalAbsoluteAngle > 0
        ? Math.abs(ft.totalSignedAngle) / ft.totalAbsoluteAngle
        : 0,
  });
}

console.log('per-sample:');
console.log('  ' + 'label'.padEnd(20) + 'expected'.padEnd(15) + 'got'.padEnd(15) + 'conf'.padEnd(7) + 'corners' + ' aspect' + ' turn' + ' cR');
console.log('  ' + '-'.repeat(78));
for (const r of rows) {
  const ok = r.expected === r.got ? '✓' : '✗';
  console.log(
    `${ok} ${r.label.padEnd(20)}${r.expected.padEnd(15)}${r.got.padEnd(15)}${r.conf.toFixed(2).padEnd(7)}${String(r.corners).padStart(3)}    ${r.aspect.toFixed(2)}  ${r.turn.toFixed(2)}  ${r.cR.toFixed(2)}`
  );
}

console.log('\nconfusion matrix:');
const allCats = Array.from(
  new Set([...rows.map((r) => r.expected), ...rows.map((r) => r.got)]),
).sort();
const cell = (e: string, g: string) =>
  rows.filter((r) => r.expected === e && r.got === g).length;
console.log('  expected→got    | ' + allCats.map((c) => c.padEnd(13)).join(''));
console.log('  ' + '-'.repeat(18 + allCats.length * 13));
for (const e of allCats) {
  console.log(
    `  ${e.padEnd(15)} | ${allCats.map((g) => String(cell(e, g)).padEnd(13)).join('')}`,
  );
}

const correct = rows.filter(r => r.expected === r.got).length;
console.log(`\noverall: ${correct}/${rows.length} correct (${((correct/rows.length)*100).toFixed(0)}%)`);
