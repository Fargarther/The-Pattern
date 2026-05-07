// Run the recognizer dispatcher across every saved sample in samples/
// and print intent (label) vs prediction. The intent is just what the player
// typed when saving, so it's noisy — useful for spotting systematic mismatches.

import fs from 'node:fs';
import path from 'node:path';
import { recognize } from './recognize.js';
import type { ShapeFeatures } from './types.js';

interface Sample {
  label: string;
  features: ShapeFeatures;
}

const dir = path.resolve('samples');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

console.log(
  pad('label', 16) +
    pad('predicted', 12) +
    pad('conf', 8, 'r') +
    pad('alts', 30),
);
console.log('-'.repeat(70));

let agree = 0;
let disagree = 0;
let none = 0;

for (const f of files) {
  const sample = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Sample;
  const result = recognize(sample.features);
  const intentClean = sample.label.toLowerCase().trim();
  const predicted = result.shape ?? '—';

  const alts = (result.alternativeMatches ?? [])
    .map((m) => `${m.shape}:${m.confidence.toFixed(2)}`)
    .join(' ');

  console.log(
    pad(sample.label, 16) +
      pad(predicted, 12) +
      pad(result.confidence.toFixed(3), 8, 'r') +
      pad(alts, 30),
  );

  if (predicted === '—') none++;
  else if (predicted === intentClean) agree++;
  else disagree++;
}

console.log('\nsummary:');
console.log(`  agree:    ${agree}/${files.length}`);
console.log(`  disagree: ${disagree}/${files.length}`);
console.log(`  no class: ${none}/${files.length}`);

function pad(s: string | number, w: number, align: 'l' | 'r' = 'l'): string {
  const str = String(s);
  if (str.length >= w) return str.slice(0, w);
  const space = ' '.repeat(w - str.length);
  return align === 'r' ? space + str : str + space;
}
