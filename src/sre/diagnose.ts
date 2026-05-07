import fs from 'node:fs';
import path from 'node:path';
import { recognize } from './recognize.js';
import { recognizeCircle, recognizeSquare, recognizeTriangle } from './recognizers.js';
import { preprocessStrokes } from './preprocessing.js';
import { extractFeatures } from './features.js';

const dir = path.resolve('samples');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

for (const f of files) {
  const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  // Re-extract features from the saved raw stroke so analysis uses the
  // CURRENT extractor (samples saved before a feature was added otherwise
  // miss it).
  const norm = preprocessStrokes([s.stroke]);
  const ft = extractFeatures(norm);
  const tri = recognizeTriangle(ft);
  const cir = recognizeCircle(ft);
  const sq = recognizeSquare(ft);
  const r = recognize(ft);
  const angles = ft.cornerAngles.map((a) => (a * 180 / Math.PI).toFixed(0));
  console.log(
    s.label.padEnd(38) +
      `corners=${ft.cornerCount} [${angles.join(',')}]° ` +
      `aspect=${ft.bboxAspectRatio.toFixed(2)} ` +
      `turn=${(ft.totalAbsoluteAngle / (2 * Math.PI)).toFixed(2)} ` +
      `cR=${ft.cornerTurnRatio.toFixed(2)} ` +
      ` -> tri=${tri.toFixed(2)} cir=${cir.toFixed(2)} sq=${sq.toFixed(2)} = ${r.shape ?? '-'}`,
  );
}
