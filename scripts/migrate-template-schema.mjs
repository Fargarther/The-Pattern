// Migrate templates-runtime/*.json from the legacy pre-schema format to
// schema 1.0.0. Idempotent — files already at v1.0.0 are skipped.
//
// What changes per file:
//   - Adds `schemaVersion: "1.0.0"`
//   - Adds `captureContext` derived from filename hints when possible:
//     - *-qd-*.json (Quick Draw imports) → device "quickdraw", inputType "mouse"
//     - other (Alex's hand-drawn samples) → device "unknown", inputType "mouse"
//   - Renames `savedAt` → `capturedAt` if present; otherwise leaves capturedAt
//     unset (which is invalid per schema, so we synthesize from file mtime).
//
// Usage: node scripts/migrate-template-schema.mjs

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\//, ''), '..');
const TEMPLATES_DIR = path.join(ROOT, 'templates-runtime');

async function main() {
  const files = (await fs.readdir(TEMPLATES_DIR)).filter((f) => f.endsWith('.json'));
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  for (const f of files) {
    const p = path.join(TEMPLATES_DIR, f);
    let raw;
    try {
      raw = await fs.readFile(p, 'utf8');
    } catch (err) {
      errors++;
      console.error(`read ${f}: ${err.message}`);
      continue;
    }
    let t;
    try {
      t = JSON.parse(raw);
    } catch (err) {
      errors++;
      console.error(`parse ${f}: ${err.message}`);
      continue;
    }
    if (t.schemaVersion === '1.0.0') {
      skipped++;
      continue;
    }

    // Derive captureContext from filename + existing metadata.
    const isQuickDraw = /-qd-\d+\.json$/.test(f);
    const captureContext = {
      device: isQuickDraw ? 'quickdraw' : 'unknown-pre-schema',
      os: 'unknown',
      viewport: { w: 0, h: 0 },
      pixelRatio: 1,
      inputType: 'mouse',
    };

    // capturedAt: prefer existing savedAt, else fall back to file mtime.
    let capturedAt = t.savedAt ?? t.capturedAt;
    if (!capturedAt) {
      const stat = await fs.stat(p);
      capturedAt = stat.mtime.toISOString();
    }

    // Build new file in canonical key order.
    const out = {
      schemaVersion: '1.0.0',
      shape: t.shape,
      points: t.points,
      capturedAt,
      captureContext,
      ...(t.stroke ? { stroke: t.stroke } : {}),
      ...(t.importedFrom ? { importedFrom: t.importedFrom } : {}),
    };
    await fs.writeFile(p, JSON.stringify(out, null, 2), 'utf8');
    migrated++;
  }
  console.log(`Migrated ${migrated}, skipped ${skipped}, errors ${errors} (of ${files.length} files).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
