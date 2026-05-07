// Validate every JSON file in templates-runtime/ against the locked
// schema (1.0.0). Use this in CI or before publishing a template pack.
//
// Exit code 0 = all valid. Non-zero = at least one file invalid (with
// per-file error report on stderr).
//
// Usage:
//   node scripts/validate-template-pack.mjs
//   node scripts/validate-template-pack.mjs --dir <path>

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const dirArg = argv.indexOf('--dir');
const TEMPLATES_DIR =
  dirArg >= 0 ? path.resolve(argv[dirArg + 1]) : path.join(ROOT, 'templates-runtime');

// Schema mirrors src/sre/template-schema.ts TEMPLATE_FILE_SCHEMA. Kept
// inline so this script can run without going through TypeScript compile.
const SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'TemplateFile',
  type: 'object',
  required: ['schemaVersion', 'shape', 'points', 'capturedAt'],
  properties: {
    schemaVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    shape: { type: 'string' },
    points: {
      type: 'array',
      minItems: 4,
      items: {
        type: 'object',
        required: ['x', 'y'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
        },
      },
    },
    capturedAt: { type: 'string' },
    captureContext: {
      type: 'object',
      required: ['device', 'viewport', 'pixelRatio', 'inputType'],
      properties: {
        device: { type: 'string' },
        os: { type: 'string' },
        viewport: {
          type: 'object',
          required: ['w', 'h'],
          properties: {
            w: { type: 'number' },
            h: { type: 'number' },
          },
        },
        pixelRatio: { type: 'number' },
        inputType: { enum: ['touch', 'stylus', 'mouse', 'unknown'] },
      },
    },
    stroke: {},
    importedFrom: { type: 'string' },
  },
};

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(SCHEMA);

async function main() {
  const files = (await fs.readdir(TEMPLATES_DIR)).filter((f) => f.endsWith('.json'));
  let valid = 0;
  let invalid = 0;
  const failures = [];
  for (const f of files) {
    const p = path.join(TEMPLATES_DIR, f);
    let raw;
    try {
      raw = await fs.readFile(p, 'utf8');
    } catch (err) {
      invalid++;
      failures.push({ f, err: `read: ${err.message}` });
      continue;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      invalid++;
      failures.push({ f, err: `parse: ${err.message}` });
      continue;
    }
    if (validate(data)) {
      valid++;
    } else {
      invalid++;
      failures.push({ f, errors: validate.errors });
    }
  }

  console.log(`Validated ${files.length} files: ${valid} valid, ${invalid} invalid.`);
  if (invalid > 0) {
    console.error('\nFailures:');
    for (const { f, err, errors } of failures.slice(0, 20)) {
      console.error(`\n  ${f}`);
      if (err) {
        console.error(`    ${err}`);
      } else if (errors) {
        for (const e of errors) {
          console.error(`    ${e.instancePath || '(root)'}: ${e.message}`);
        }
      }
    }
    if (failures.length > 20) {
      console.error(`\n  ... and ${failures.length - 20} more`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
