// 1€ Filter for noisy pointer input.
// Casiez, Roussel & Vogel, CHI 2012, "1€ Filter: A Simple Speed-Based Low-Pass
// Filter for Noisy Input in Interactive Systems."
//
// Two parameters:
//   mincutoff — minimum cutoff frequency (Hz). Lower = more lag, less jitter at rest.
//   beta      — speed-coefficient. Higher = cutoff rises faster with speed (less lag while moving).
//
// Defaults match Casiez et al. for general use. SRE_TUNING in types.ts has
// pen-vs-touch presets the preprocessing pipeline picks between.

import type { RawPoint, PointerType } from './types.js';
import { SRE_TUNING } from './types.js';

export interface OneEuroConfig {
  mincutoff: number;
  beta: number;
  dcutoff?: number; // derivative-channel cutoff (Hz). Default 1.0.
}

interface AxisState {
  xPrev: number;
  dxPrev: number;
  initialized: boolean;
}

function smoothingFactor(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

function exponentialSmoothing(alpha: number, x: number, xPrev: number): number {
  return alpha * x + (1 - alpha) * xPrev;
}

function stepAxis(
  state: AxisState,
  x: number,
  dtSec: number,
  cfg: Required<OneEuroConfig>,
): number {
  if (!state.initialized) {
    state.xPrev = x;
    state.dxPrev = 0;
    state.initialized = true;
    return x;
  }

  const dx = (x - state.xPrev) / dtSec;
  const aD = smoothingFactor(cfg.dcutoff, dtSec);
  const dxHat = exponentialSmoothing(aD, dx, state.dxPrev);

  const cutoff = cfg.mincutoff + cfg.beta * Math.abs(dxHat);
  const a = smoothingFactor(cutoff, dtSec);
  const xHat = exponentialSmoothing(a, x, state.xPrev);

  state.xPrev = xHat;
  state.dxPrev = dxHat;
  return xHat;
}

/**
 * Apply 1€ filter to a sequence of raw points. Returns a new array; input is not mutated.
 *
 * Each stroke gets fresh filter state — no leakage across strokes.
 * Timestamps must be in milliseconds; dt is computed in seconds internally.
 *
 * Guards:
 *   - Empty / single-point input passes through unchanged.
 *   - Non-positive dt (dup or out-of-order timestamps) re-emits the last smoothed value
 *     for that axis without updating state.
 */
export function applyOneEuroFilter(
  points: readonly RawPoint[],
  config: OneEuroConfig,
): RawPoint[] {
  if (points.length <= 1) return points.slice();

  const cfg: Required<OneEuroConfig> = {
    mincutoff: config.mincutoff,
    beta: config.beta,
    dcutoff: config.dcutoff ?? SRE_TUNING.ONE_EURO_DERIVATE_CUTOFF,
  };

  const xState: AxisState = { xPrev: 0, dxPrev: 0, initialized: false };
  const yState: AxisState = { xPrev: 0, dxPrev: 0, initialized: false };

  const out: RawPoint[] = new Array(points.length);
  let prevT = points[0]!.t;

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const dtMs = i === 0 ? 0 : p.t - prevT;

    let smoothedX: number;
    let smoothedY: number;

    if (i === 0 || dtMs <= 0) {
      // First sample, or non-monotonic timestamp: pass through and seed state.
      smoothedX = stepAxis(xState, p.x, 1 / 60, cfg); // dummy 60Hz dt for seeding
      smoothedY = stepAxis(yState, p.y, 1 / 60, cfg);
    } else {
      const dtSec = dtMs / 1000;
      smoothedX = stepAxis(xState, p.x, dtSec, cfg);
      smoothedY = stepAxis(yState, p.y, dtSec, cfg);
    }

    out[i] = {
      x: smoothedX,
      y: smoothedY,
      t: p.t,
      ...(p.pressure !== undefined ? { pressure: p.pressure } : {}),
      ...(p.pointerType !== undefined ? { pointerType: p.pointerType } : {}),
    };
    prevT = p.t;
  }

  return out;
}

export function pickOneEuroPreset(pointerType: PointerType): OneEuroConfig {
  if (pointerType === 'pen') {
    return {
      mincutoff: SRE_TUNING.ONE_EURO_PEN_MIN_CUTOFF,
      beta: SRE_TUNING.ONE_EURO_PEN_BETA,
    };
  }
  return {
    mincutoff: SRE_TUNING.ONE_EURO_TOUCH_MIN_CUTOFF,
    beta: SRE_TUNING.ONE_EURO_TOUCH_BETA,
  };
}
