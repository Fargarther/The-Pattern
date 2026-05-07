// One-shot analyzer: reads samples/*.json and prints a summary table of what
// the SRE extracted from each, plus a side-by-side comparison with what the
// player intended (the label).

import fs from 'node:fs';
import path from 'node:path';

interface Sample {
  savedAt: string;
  label: string;
  features: {
    cornerCount: number;
    isClosed: boolean;
    closureDistance: number;
    bboxAspectRatio: number;
    bboxWidth: number;
    bboxHeight: number;
    totalAbsoluteAngle: number;
    dcr: number;
    sideLengthCV: number;
    horizontalSymmetry: number;
    verticalSymmetry: number;
    rotationalSymmetry4: number;
  };
  stroke: {
    points: Array<{ x: number; y: number; t: number }>;
    pointerType: string;
    startTime: number;
    endTime: number;
  };
  runtimeMs: number;
}

const SAMPLES_DIR = path.resolve('samples');
const files = fs
  .readdirSync(SAMPLES_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

const samples: { file: string; sample: Sample }[] = files.map((f) => ({
  file: f,
  sample: JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, f), 'utf8')) as Sample,
}));

console.log(`\n${samples.length} samples loaded from samples/\n`);

function pad(s: string | number, w: number, align: 'l' | 'r' = 'l'): string {
  const str = String(s);
  if (str.length >= w) return str.slice(0, w);
  const space = ' '.repeat(w - str.length);
  return align === 'r' ? space + str : str + space;
}

console.log(
  pad('label', 14) +
    pad('corners', 8, 'r') +
    pad('closed', 8, 'r') +
    pad('aspect', 8, 'r') +
    pad('turn/2π', 9, 'r') +
    pad('dcr', 7, 'r') +
    pad('sideCV', 8, 'r') +
    pad('sym4', 7, 'r') +
    pad('points', 8, 'r') +
    pad('dur(ms)', 9, 'r'),
);
console.log('-'.repeat(82));

for (const { sample } of samples) {
  const f = sample.features;
  const turn = (f.totalAbsoluteAngle / (2 * Math.PI)).toFixed(2);
  const aspect = f.bboxAspectRatio.toFixed(2);
  const dcr = f.dcr.toFixed(2);
  const cv = f.sideLengthCV.toFixed(2);
  const sym = f.rotationalSymmetry4.toFixed(2);
  const pts = sample.stroke.points.length;
  const dur = (sample.stroke.endTime - sample.stroke.startTime).toFixed(0);

  console.log(
    pad(sample.label, 14) +
      pad(f.cornerCount, 8, 'r') +
      pad(f.isClosed ? 'yes' : 'no', 8, 'r') +
      pad(aspect, 8, 'r') +
      pad(turn, 9, 'r') +
      pad(dcr, 7, 'r') +
      pad(cv, 8, 'r') +
      pad(sym, 7, 'r') +
      pad(pts, 8, 'r') +
      pad(dur, 9, 'r'),
  );
}

// ===== Per-label analysis =====
console.log('\n--- per-label analysis ---\n');

const byLabel = new Map<string, Sample[]>();
for (const { sample } of samples) {
  const arr = byLabel.get(sample.label) ?? [];
  arr.push(sample);
  byLabel.set(sample.label, arr);
}

for (const [label, group] of byLabel) {
  const corners = group.map((s) => s.features.cornerCount);
  const closed = group.map((s) => s.features.isClosed);
  const turns = group.map((s) => s.features.totalAbsoluteAngle / (2 * Math.PI));
  const expected = expectedFor(label);

  console.log(`${label}  (${group.length} sample${group.length === 1 ? '' : 's'})`);
  console.log(`  corners detected: [${corners.join(', ')}]   expected: ${expected.corners ?? '?'}`);
  console.log(
    `  closed:           [${closed.map((c) => (c ? 'Y' : 'N')).join(', ')}]   expected: ${expected.closed ?? '?'}`,
  );
  console.log(`  total turn /2π:   [${turns.map((t) => t.toFixed(2)).join(', ')}]`);
  console.log('');
}

function expectedFor(label: string): { corners?: number; closed?: string } {
  const l = label.toLowerCase();
  if (l.includes('triangle')) return { corners: 3, closed: 'Y' };
  if (l.includes('square')) return { corners: 4, closed: 'Y' };
  if (l.includes('rectangle')) return { corners: 4, closed: 'Y' };
  if (l.includes('pentagon')) return { corners: 5, closed: 'Y' };
  if (l.includes('hexagon')) return { corners: 6, closed: 'Y' };
  if (l.includes('circle')) return { corners: 0, closed: 'Y' };
  if (l.includes('open') || l.includes('line')) return { closed: 'N' };
  return {};
}
