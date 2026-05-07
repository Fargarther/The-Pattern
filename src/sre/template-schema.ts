// Template pack schema (per recognition-engine-roadmap §A.7).
//
// We store one JSON file per template (in `templates-runtime/`) rather than
// roadmap-style aggregated pack files. The metadata fields are the same;
// the on-disk layout is the difference. An optional aggregator script can
// build a versioned pack JSON from the per-file collection when we need
// one for shipping.

import type { NormalizedPoint } from './types.js';

/** Bumped whenever the on-disk shape changes incompatibly. Loaders refuse
 *  packs whose major doesn't match. */
export const TEMPLATE_SCHEMA_VERSION = '1.0.0' as const;

export interface CaptureContext {
  /** User-agent or "node" for synthetic / programmatic captures. */
  device: string;
  /** Best-effort OS name ("Windows", "iOS", "Android", "macOS", "Linux", "unknown"). */
  os?: string;
  viewport: { w: number; h: number };
  /** `window.devicePixelRatio` at capture time. */
  pixelRatio: number;
  /** Pointer type used to draw — drives template-quality stratification later. */
  inputType: 'touch' | 'stylus' | 'mouse' | 'unknown';
}

/** A single saved template, on-disk shape. */
export interface TemplateFile {
  /** Schema version. Mismatched majors → loader rejects. */
  schemaVersion: string;
  /** Canonical class label from the locked dictionary (`ShapeName`). */
  shape: string;
  /** Resampled point cloud the recognizer consumes (after $Q's
   *  centre+scale). Kept for backward compat with existing files; loaders
   *  re-build $Q templates via `buildTemplate(shape, points)`. */
  points: NormalizedPoint[];
  /** ISO-8601 capture timestamp. */
  capturedAt: string;
  /** Device + viewport + input metadata. Optional only on legacy v0 files
   *  that pre-date the schema; new saves always include it. */
  captureContext?: CaptureContext;
  /** Original raw stroke (with timestamps + pressure) when available. Lets
   *  us re-resample at a different N in the future without re-recording. */
  stroke?: unknown;
  /** Provenance — either a sample filename, a Quick Draw key_id, or "ui"
   *  for templates saved through the in-app 📌 button. */
  importedFrom?: string;
}

/** AJV-compatible JSON Schema (draft-07) for `TemplateFile`. */
export const TEMPLATE_FILE_SCHEMA = {
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
} as const;

/** Heuristic OS detection from a user-agent string. Pure function,
 *  testable, no `navigator` dependency. */
export function detectOs(ua: string | undefined): string {
  if (!ua) return 'unknown';
  if (/Windows NT/i.test(ua)) return 'Windows';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac OS X/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'unknown';
}
