// Starter rule set for The Pattern's grammar layer.
//
// **This is a skeleton, not the full grammar.** The Pattern's locked
// composite contract is 3-deep nesting (unit → wrapper → modifier source).
// The composition engine here works on a flat list of primitives + their
// pairwise spatial relations, which is the foundation. The 3-deep parser
// upgrade (separate session) will produce the per-layer occurrences this
// engine consumes.
//
// Rules below cover a handful of 2-primitive compositions purely to
// validate the engine end-to-end. They'll be replaced/expanded once the
// 3-deep parser lands and we have the full unit/wrapper/modifier matrix
// from project_pattern_composite.md.

import { rule, type GrammarRule } from './composition-engine.js';

export const SACRED_GRAMMAR_STARTER: GrammarRule[] = [
  // Plus inside a circle — basic healing pattern.
  rule('heal-self', ['circle', 'plusSign'], {
    plusSign: { inside: 'circle' },
  }),

  // Arrow bisecting a circle — directional dispel.
  rule('dispel-line', ['circle', 'arrow'], {
    arrow: { bisecting: 'circle' },
  }),

  // Two concentric triangles — amplification glyph (matches Alex's
  // doc reference for the "amplify" pattern).
  rule('amplify', ['triangle@0', 'triangle@1'], {
    'triangle@1': { concentric: 'triangle@0' },
  }),

  // Star inside a hexagon — binding pattern (placeholder until 3-deep).
  rule('bind', ['hexagon', 'star'], {
    star: { inside: 'hexagon' },
  }),

  // Bolt bisecting a square — lightning strike (line-through-tank kind
  // of mechanic).
  rule('lightning-strike', ['square', 'bolt'], {
    bolt: { bisecting: 'square' },
  }),
];
