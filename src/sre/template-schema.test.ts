import { describe, expect, it } from 'vitest';
import { detectOs, TEMPLATE_SCHEMA_VERSION, TEMPLATE_FILE_SCHEMA } from './template-schema.js';

describe('template-schema', () => {
  it('exposes the locked schemaVersion', () => {
    expect(TEMPLATE_SCHEMA_VERSION).toBe('1.0.0');
  });

  it('JSON Schema lists schemaVersion + shape + points + capturedAt as required', () => {
    expect(TEMPLATE_FILE_SCHEMA.required).toEqual(
      expect.arrayContaining(['schemaVersion', 'shape', 'points', 'capturedAt']),
    );
  });

  describe('detectOs', () => {
    const cases: Array<[string, string]> = [
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Windows',
      ],
      [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Safari/604',
        'iOS',
      ],
      [
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
        'Android',
      ],
      [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Version/17 Safari/605',
        'macOS',
      ],
      ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Linux'],
      ['Mozilla/5.0 (Unknown)', 'unknown'],
    ];
    for (const [ua, expected] of cases) {
      it(`recognizes ${expected} from "${ua.slice(0, 40)}…"`, () => {
        expect(detectOs(ua)).toBe(expected);
      });
    }

    it('handles undefined gracefully', () => {
      expect(detectOs(undefined)).toBe('unknown');
    });
  });
});
