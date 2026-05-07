import fs from 'node:fs';
import path from 'node:path';
import { extractFeatures } from './features.js';
import { preprocessStrokes } from './preprocessing.js';
import { recognize } from './recognize.js';
import { recognizeQ } from './qdollar.js';
import { getQTemplates } from './templates.js';

const dir = path.resolve('samples');
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f.includes('misread'))
  .sort()
  .reverse()
  .slice(0, 14); // most recent misreads

for (const f of files) {
  const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const stroke = s.stroke ?? s.strokes?.[0];
  if (!stroke) continue;
  const norm = preprocessStrokes([stroke]);
  const ft = extractFeatures(norm);
  const r = recognize(ft, { cloud: norm.points });
  const q = recognizeQ(norm.points, getQTemplates());
  const sgn = ft.cornerSignedAngles.map((a) => Math.round((a * 180) / Math.PI));
  console.log(
    `${s.label.padEnd(50)} -> ${(r.shape ?? '-').padEnd(12)} (${r.confidence.toFixed(2)})  ` +
      `n=${ft.cornerCount} aspect=${ft.bboxAspectRatio.toFixed(2)} ` +
      `signed=${(ft.totalSignedAngle / (2 * Math.PI)).toFixed(2)} sym4=${ft.rotationalSymmetry4.toFixed(3)}`,
  );
  console.log(`  signed angles: [${sgn.join(',')}]° Q:${q ? `${q.template.name}=${q.confidence.toFixed(2)}` : 'null'}`);
}
