// Day-1 smoke run. Generates a synthetic triangle stroke, pushes it through the
// preprocessing pipeline, and prints diagnostic numbers to stdout. Useful as a
// sanity-check independent of vitest.
//
// Run with: npm run smoke

import type { RawPoint, Stroke } from './types.js';
import { SRE_TUNING } from './types.js';
import { preprocessStrokes } from './preprocessing.js';

function syntheticTriangle(): RawPoint[] {
  const verts = [
    { x: 100, y: 200 },
    { x: 200, y: 200 },
    { x: 150, y: 113 },
    { x: 100, y: 200 },
  ];
  const out: RawPoint[] = [];
  let t = 1000;
  for (let i = 0; i < verts.length - 1; i++) {
    const a = verts[i]!;
    const b = verts[i + 1]!;
    for (let s = 0; s < 30; s++) {
      const u = s / 30;
      // Add a tiny jitter to test the 1€ filter on something realistic.
      const jx = (Math.random() - 0.5) * 1.5;
      const jy = (Math.random() - 0.5) * 1.5;
      out.push({ x: a.x + u * (b.x - a.x) + jx, y: a.y + u * (b.y - a.y) + jy, t });
      t += 10;
    }
  }
  out.push({ x: verts[verts.length - 1]!.x, y: verts[verts.length - 1]!.y, t });
  return out;
}

const points = syntheticTriangle();
const stroke: Stroke = {
  points,
  startTime: points[0]!.t,
  endTime: points[points.length - 1]!.t,
  pointerType: 'pen',
};

const t0 = performance.now();
const result = preprocessStrokes([stroke]);
const elapsed = performance.now() - t0;

const xs = result.points.map((p) => p.x);
const ys = result.points.map((p) => p.y);
const minX = Math.min(...xs);
const maxX = Math.max(...xs);
const minY = Math.min(...ys);
const maxY = Math.max(...ys);
const cx = xs.reduce((s, x) => s + x, 0) / xs.length;
const cy = ys.reduce((s, y) => s + y, 0) / ys.length;

console.log('--- SRE Day-1 smoke ---');
console.log(`input raw points:           ${points.length}`);
console.log(`smoothed raw points:        ${result.raw.length}`);
console.log(`resampled output points:    ${result.points.length} (target ${SRE_TUNING.RESAMPLE_POINTS})`);
console.log(`bbox:                       w=${(maxX - minX).toFixed(2)}, h=${(maxY - minY).toFixed(2)}`);
console.log(`aspect ratio (w/h):         ${((maxX - minX) / (maxY - minY)).toFixed(3)}`);
console.log(`centroid (should be ~0,0):  (${cx.toFixed(4)}, ${cy.toFixed(4)})`);
console.log(`pipeline runtime:           ${elapsed.toFixed(2)} ms`);
console.log('first 3 output points:');
for (let i = 0; i < 3; i++) {
  console.log(`  [${i}] (${result.points[i]!.x.toFixed(2)}, ${result.points[i]!.y.toFixed(2)})`);
}
console.log('last 3 output points:');
for (let i = result.points.length - 3; i < result.points.length; i++) {
  console.log(`  [${i}] (${result.points[i]!.x.toFixed(2)}, ${result.points[i]!.y.toFixed(2)})`);
}
