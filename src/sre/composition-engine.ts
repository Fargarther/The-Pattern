// Composition engine — matches lists of recognized primitives against a
// declarative grammar of rules and emits game tokens.
//
// Per recognition-engine-roadmap §E.4, a rule says: "this token appears
// when the gesture contains primitives X and Y in some configuration of
// spatial relations." Rules are JSON-serializable; the matcher does
// constraint satisfaction over the small (~3-5 primitive) gesture space.
//
// At ≤10 primitives per gesture and ≤30 rules, brute-force assignment
// (try every 1-to-1 mapping from rule.primitives → occurrences) runs in
// well under a frame.

import { relate, type PrimitiveOccurrence, type Relation } from './spatial-relations.js';

/** A primitive reference inside a rule's relations map. Either:
 *   - bare classId, e.g. `"circle"` (matches the unique circle in the rule)
 *   - classId@N, e.g. `"triangle@1"` (matches the (N+1)th triangle in
 *     declaration order — `triangle@0` and `triangle@1` would be two
 *     distinct triangles in the rule). */
export type PrimitiveRef = string;

/** Required relations from one primitive to other primitives. Keys are
 *  relations; values are refs to other primitives. */
export type RuleRelations = Partial<Record<Relation, PrimitiveRef>>;

/** A grammar rule: "if these primitives appear in these relationships,
 *  emit this token." */
export interface GrammarRule {
  token: string;
  /** Ordered list of primitive refs the rule requires. Same classId can
   *  appear multiple times — disambiguate with `classId@N` syntax in the
   *  relations map. */
  primitives: PrimitiveRef[];
  /** Per-primitive relation requirements. Key is the source primitive ref,
   *  value is `{ relation: targetPrimitiveRef }`. */
  relations: Record<PrimitiveRef, RuleRelations>;
  /** Higher = matched first when multiple rules fit. Defaults to
   *  primitives.length so more-specific rules win over less-specific. */
  priority?: number;
}

export interface GameToken {
  token: string;
  /** Per-rule-ref → matched occurrence, when matched. `null` for the
   *  unknown-pattern fallback. */
  evidence: Record<PrimitiveRef, PrimitiveOccurrence> | null;
  /** Aggregate confidence — geometric mean of per-relation confidences. */
  confidence: number;
}

export const UNKNOWN_PATTERN_TOKEN = 'unknown-pattern';

/** Convenience constructor — most rules don't need explicit priority, so
 *  default it to primitives.length (more-primitives wins ties). */
export function rule(
  token: string,
  primitives: PrimitiveRef[],
  relations: Record<PrimitiveRef, RuleRelations>,
  priority?: number,
): GrammarRule {
  return {
    token,
    primitives,
    relations,
    priority: priority ?? primitives.length,
  };
}

// ============================================================================
// Internals
// ============================================================================

/** Parse `"circle@2"` → `{ classId: "circle", index: 2 }`; `"circle"` →
 *  `{ classId: "circle", index: undefined }`. */
function parseRef(ref: PrimitiveRef): { classId: string; index?: number } {
  const at = ref.indexOf('@');
  if (at < 0) return { classId: ref };
  return { classId: ref.slice(0, at), index: parseInt(ref.slice(at + 1), 10) };
}

/** Generate every assignment of rule primitives → distinct occurrences
 *  consistent with classId constraints. Yields an object `{ [ref]: occ }`
 *  per assignment. */
function* enumerateAssignments(
  refs: PrimitiveRef[],
  occurrences: PrimitiveOccurrence[],
): Generator<Record<PrimitiveRef, PrimitiveOccurrence>> {
  const used = new Set<number>();
  const out: Record<PrimitiveRef, PrimitiveOccurrence> = {};

  function* recurse(idx: number): Generator<Record<PrimitiveRef, PrimitiveOccurrence>> {
    if (idx === refs.length) {
      yield { ...out };
      return;
    }
    const ref = refs[idx]!;
    const { classId } = parseRef(ref);
    for (let i = 0; i < occurrences.length; i++) {
      if (used.has(i)) continue;
      const o = occurrences[i]!;
      if (o.classId !== classId) continue;
      used.add(i);
      out[ref] = o;
      yield* recurse(idx + 1);
      used.delete(i);
      delete out[ref];
    }
  }

  yield* recurse(0);
}

/** For an assignment, check every relation requirement. Returns the
 *  geometric mean of per-relation confidences, or 0 if any required
 *  relation isn't satisfied. */
function scoreAssignment(
  rule: GrammarRule,
  assignment: Record<PrimitiveRef, PrimitiveOccurrence>,
): number {
  const confidences: number[] = [];
  for (const [sourceRef, requirements] of Object.entries(rule.relations)) {
    const source = assignment[sourceRef];
    if (!source) return 0;
    for (const [rel, targetRef] of Object.entries(requirements) as Array<
      [Relation, PrimitiveRef]
    >) {
      const target = assignment[targetRef];
      if (!target) return 0;
      const result = relate(source, target);
      if (result.relation !== rel) return 0;
      confidences.push(result.confidence);
    }
  }
  if (confidences.length === 0) return 1;
  const product = confidences.reduce((a, b) => a * b, 1);
  return Math.pow(product, 1 / confidences.length);
}

// ============================================================================
// Engine
// ============================================================================

export class CompositionEngine {
  private readonly rules: readonly GrammarRule[];

  constructor(rules: readonly GrammarRule[]) {
    // Sort once at construction. Higher priority + more primitives wins.
    this.rules = [...rules].sort((a, b) => {
      const pa = a.priority ?? a.primitives.length;
      const pb = b.priority ?? b.primitives.length;
      if (pb !== pa) return pb - pa;
      return b.primitives.length - a.primitives.length;
    });
  }

  /** Find the best-matching rule. Walks rules in priority order; for each,
   *  tries every assignment of primitives→occurrences. Returns the highest-
   *  scoring assignment from the first rule that produces a non-zero
   *  score, or the unknown-pattern fallback. */
  evaluate(occurrences: readonly PrimitiveOccurrence[]): GameToken {
    const occs = [...occurrences];
    for (const r of this.rules) {
      if (r.primitives.length > occs.length) continue;
      let bestScore = 0;
      let bestAssignment: Record<PrimitiveRef, PrimitiveOccurrence> | null = null;
      for (const assignment of enumerateAssignments(r.primitives, occs)) {
        const score = scoreAssignment(r, assignment);
        if (score > bestScore) {
          bestScore = score;
          bestAssignment = assignment;
        }
      }
      if (bestAssignment !== null) {
        return { token: r.token, evidence: bestAssignment, confidence: bestScore };
      }
    }
    return { token: UNKNOWN_PATTERN_TOKEN, evidence: null, confidence: 0 };
  }
}
