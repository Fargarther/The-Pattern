// Render each sample to an SVG so we can actually look at the strokes.
// Output goes to samples/<basename>.svg next to each json.

import fs from 'node:fs';
import path from 'node:path';

interface Sample {
  label: string;
  stroke: { points: { x: number; y: number; t: number }[]; pointerType: string };
  resampled: { x: number; y: number }[];
  cornerPositions: { x: number; y: number }[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  features: {
    cornerCount: number;
    isClosed: boolean;
    closureDistance: number;
    bboxAspectRatio: number;
    totalAbsoluteAngle: number;
    dcr: number;
  };
}

const SAMPLES_DIR = path.resolve('samples');
const files = fs
  .readdirSync(SAMPLES_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

for (const f of files) {
  const sample = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, f), 'utf8')) as Sample;

  // Pad bbox by 30 px so we have room for markers/labels.
  const PAD = 30;
  const minX = sample.bbox.minX - PAD;
  const minY = sample.bbox.minY - PAD;
  const maxX = sample.bbox.maxX + PAD;
  const maxY = sample.bbox.maxY + PAD;
  const w = maxX - minX;
  const h = maxY - minY;

  const rawPath = sample.stroke.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

  const resampledDots = sample.resampled
    .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2" fill="#6fb5c9" />`)
    .join('');

  const cornerMarkers = sample.cornerPositions
    .map(
      (p, i) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="8" fill="none" stroke="#e8a13a" stroke-width="2" />` +
        `<text x="${(p.x + 12).toFixed(1)}" y="${(p.y - 8).toFixed(1)}" fill="#e8a13a" font-family="ui-monospace,monospace" font-size="11">#${i}</text>`,
    )
    .join('');

  const startMarker = sample.resampled[0]
    ? `<circle cx="${sample.resampled[0].x.toFixed(1)}" cy="${sample.resampled[0].y.toFixed(1)}" r="5" fill="#9aa5b1" /><text x="${(sample.resampled[0].x + 8).toFixed(1)}" y="${(sample.resampled[0].y + 16).toFixed(1)}" fill="#9aa5b1" font-family="ui-monospace,monospace" font-size="10">start</text>`
    : '';
  const endMarker = sample.resampled[sample.resampled.length - 1]
    ? `<circle cx="${sample.resampled[sample.resampled.length - 1]!.x.toFixed(1)}" cy="${sample.resampled[sample.resampled.length - 1]!.y.toFixed(1)}" r="5" fill="none" stroke="#9aa5b1" stroke-width="1.5" /><text x="${(sample.resampled[sample.resampled.length - 1]!.x + 8).toFixed(1)}" y="${(sample.resampled[sample.resampled.length - 1]!.y + 16).toFixed(1)}" fill="#9aa5b1" font-family="ui-monospace,monospace" font-size="10">end</text>`
    : '';

  const bboxRect = `<rect x="${sample.bbox.minX}" y="${sample.bbox.minY}" width="${(sample.bbox.maxX - sample.bbox.minX).toFixed(1)}" height="${(sample.bbox.maxY - sample.bbox.minY).toFixed(1)}" fill="none" stroke="#2a2a36" stroke-dasharray="4 4" />`;

  const meta = [
    `label: ${sample.label}`,
    `corners: ${sample.features.cornerCount}`,
    `closed: ${sample.features.isClosed} (gap ${sample.features.closureDistance.toFixed(3)})`,
    `aspect: ${sample.features.bboxAspectRatio.toFixed(2)}`,
    `turn: ${(sample.features.totalAbsoluteAngle / (2 * Math.PI)).toFixed(2)}×2π`,
    `dcr: ${sample.features.dcr.toFixed(2)}`,
  ].join('  |  ');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h + 30}" width="${w}" height="${h + 30}">
  <rect x="${minX}" y="${minY}" width="${w}" height="${h + 30}" fill="#0a0a12" />
  ${bboxRect}
  <path d="${rawPath}" fill="none" stroke="#e8e8ea" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
  ${resampledDots}
  ${cornerMarkers}
  ${startMarker}
  ${endMarker}
  <text x="${minX + 8}" y="${maxY + 22}" fill="#c4c4c8" font-family="ui-monospace,monospace" font-size="11">${meta}</text>
</svg>`;

  const outFile = path.join(SAMPLES_DIR, f.replace('.json', '.svg'));
  fs.writeFileSync(outFile, svg, 'utf8');
}

console.log(`rendered ${files.length} samples to samples/*.svg`);
