// Canonical-form generators. Given a recognized shape name + the original
// drawing's bbox and centroid, return the points that trace the "perfect"
// version of that shape at the same position and rough size.
//
// Used after recognition to snap the user's rough drawing to its ideal form.
// The Pattern's aesthetic is geometric ideals; the recognizer doesn't just
// identify a shape, it restores it to true form.

import type { NormalizedPoint, ShapeName } from './types.js';
import {
  anchorOutline,
  boomerangOutline,
  crescentOutline,
  heartOutline,
  shieldOutline,
  skullOutline,
  spiralOutline,
  starOutline,
  tearOutline,
} from './templates.js';

export interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CanonicalForm {
  /** Closed perimeter as a polyline (last point != first; close by drawing line back to [0]). */
  points: NormalizedPoint[];
  /** True if the shape is closed; renderer should connect last → first. */
  closed: boolean;
}

function bboxCenter(b: Bbox): NormalizedPoint {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

function bboxSize(b: Bbox): { w: number; h: number } {
  return { w: b.maxX - b.minX, h: b.maxY - b.minY };
}

function regularNgon(c: NormalizedPoint, rx: number, ry: number, n: number, rotate = -Math.PI / 2): NormalizedPoint[] {
  const pts: NormalizedPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = rotate + (i / n) * 2 * Math.PI;
    pts.push({ x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) });
  }
  return pts;
}

// ============================================================================
// Per-shape canonical forms
// ============================================================================

function canonicalTriangle(b: Bbox, rotation: number): CanonicalForm {
  // Equilateral. Default orientation: apex pointing up (first vertex at
  // angle -π/2 from center). Adding rotation tilts it.
  const c = bboxCenter(b);
  const { w, h } = bboxSize(b);
  const r = Math.min(w, h) / 2;
  return {
    points: regularNgon(c, r, r, 3, -Math.PI / 2 + rotation),
    closed: true,
  };
}

function canonicalCircle(b: Bbox): CanonicalForm {
  const c = bboxCenter(b);
  const { w, h } = bboxSize(b);
  // Perfect circle, radius = average half-dimension (most forgiving snap).
  const r = (w + h) / 4;
  const pts: NormalizedPoint[] = [];
  const N = 64;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI;
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return { points: pts, closed: true };
}

function canonicalSquare(b: Bbox, rotation: number): CanonicalForm {
  // Square inscribed in a circle of radius half the average bbox dim. Default
  // orientation: axis-aligned (vertices at 45° offsets from centre, first
  // vertex top-right). Rotation tilts the whole thing.
  const c = bboxCenter(b);
  const { w, h } = bboxSize(b);
  const r = ((w + h) / 2) / Math.SQRT2;
  return {
    points: regularNgon(c, r, r, 4, -Math.PI / 4 + rotation),
    closed: true,
  };
}

function canonicalRectangle(b: Bbox): CanonicalForm {
  // Preserve user's bbox aspect — rectangle is a family, not a specific shape.
  return {
    points: [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ],
    closed: true,
  };
}

function canonicalRhombus(b: Bbox): CanonicalForm {
  // Wide horizontal rhombus inscribed in bbox.
  const c = bboxCenter(b);
  const { w, h } = bboxSize(b);
  return {
    points: [
      { x: c.x, y: c.y - h / 2 },
      { x: c.x + w / 2, y: c.y },
      { x: c.x, y: c.y + h / 2 },
      { x: c.x - w / 2, y: c.y },
    ],
    closed: true,
  };
}

function canonicalDiamond(b: Bbox): CanonicalForm {
  // Tall vertical diamond. Same point layout as rhombus — orientation comes
  // from the bbox aspect (diamond's bbox h > w).
  return canonicalRhombus(b);
}

function canonicalTrapezoid(b: Bbox): CanonicalForm {
  // Isosceles, narrow side on top, base on bottom.
  const c = bboxCenter(b);
  const { w, h } = bboxSize(b);
  const topHalf = w * 0.3;
  const botHalf = w * 0.5;
  return {
    points: [
      { x: c.x - topHalf, y: b.minY },
      { x: c.x + topHalf, y: b.minY },
      { x: c.x + botHalf, y: b.maxY },
      { x: c.x - botHalf, y: b.maxY },
    ],
    closed: true,
  };
}

function canonicalRegularPolygon(b: Bbox, n: number, rotation: number): CanonicalForm {
  // Regular polygon with N sides. Default orientation: first vertex at top
  // (angle -π/2). Rotation tilts it. Use bbox aspect for rx, ry so the
  // polygon visually fills the user's drawing space.
  const c = bboxCenter(b);
  const { w, h } = bboxSize(b);
  const rx = w / 2;
  const ry = h / 2;
  return { points: regularNgon(c, rx, ry, n, -Math.PI / 2 + rotation), closed: true };
}

// ============================================================================
// Dispatcher
// ============================================================================

export interface CanonicalizeOptions {
  /** Rotation (radians) to apply to the canonical form. Used to match the
   * orientation of the user's drawing. Ignored for shapes without a clear
   * orientation (circle) or that derive it from bbox aspect (rectangle,
   * rhombus, diamond, trapezoid). */
  rotation?: number;
}

/** Compute the rotation that aligns a regular n-gon's canonical form with the
 * user's drawing. `cornerPoints` are the detected corner positions from the
 * extracted features. We use the first one's angle from the corner-cloud
 * centroid, modulo the n-fold symmetry, to pick a minimal-rotation tilt. */
export function rotationFromCorners(
  cornerPoints: readonly NormalizedPoint[],
  n: number,
  canonicalFirstAngle: number,
): number {
  if (cornerPoints.length === 0) return 0;
  let cx = 0;
  let cy = 0;
  for (const p of cornerPoints) {
    cx += p.x;
    cy += p.y;
  }
  cx /= cornerPoints.length;
  cy /= cornerPoints.length;
  const a0 = Math.atan2(cornerPoints[0]!.y - cy, cornerPoints[0]!.x - cx);
  const period = (2 * Math.PI) / n;
  let r = a0 - canonicalFirstAngle;
  // Normalize into (-period/2, period/2] so the canonical's tilt is the
  // minimum rotation that lands on the user's orientation.
  r = ((r % period) + period) % period;
  if (r > period / 2) r -= period;
  return r;
}

// ============================================================================
// Day 6 — symbolic shapes
// ============================================================================

function canonicalPlusSign(b: Bbox): CanonicalForm {
  // 12-vertex outline of a + sign. Arm thickness = 1/3 of total dimension.
  const c = bboxCenter(b);
  const { w, h } = bboxSize(b);
  const half = Math.min(w, h) / 2;
  const armOuter = half;
  const armInner = half / 3;
  return {
    points: [
      { x: c.x - armInner, y: c.y - armOuter },
      { x: c.x + armInner, y: c.y - armOuter },
      { x: c.x + armInner, y: c.y - armInner },
      { x: c.x + armOuter, y: c.y - armInner },
      { x: c.x + armOuter, y: c.y + armInner },
      { x: c.x + armInner, y: c.y + armInner },
      { x: c.x + armInner, y: c.y + armOuter },
      { x: c.x - armInner, y: c.y + armOuter },
      { x: c.x - armInner, y: c.y + armInner },
      { x: c.x - armOuter, y: c.y + armInner },
      { x: c.x - armOuter, y: c.y - armInner },
      { x: c.x - armInner, y: c.y - armInner },
    ],
    closed: true,
  };
}

function canonicalArrow(b: Bbox, pointsDown = false): CanonicalForm {
  // Arrow silhouette: rectangular stem + triangular head. Default tip up;
  // pass pointsDown=true to flip the head to the bottom.
  const c = bboxCenter(b);
  const { w, h } = bboxSize(b);
  const stemHalf = w * 0.18;
  const headHalf = w * 0.5;
  const headHeight = h * 0.4;
  const tipY = pointsDown ? b.maxY : b.minY;
  const headBaseY = pointsDown ? b.maxY - headHeight : b.minY + headHeight;
  const stemBaseY = pointsDown ? b.minY : b.maxY;
  return {
    points: [
      { x: c.x, y: tipY },
      { x: c.x + headHalf, y: headBaseY },
      { x: c.x + stemHalf, y: headBaseY },
      { x: c.x + stemHalf, y: stemBaseY },
      { x: c.x - stemHalf, y: stemBaseY },
      { x: c.x - stemHalf, y: headBaseY },
      { x: c.x - headHalf, y: headBaseY },
    ],
    closed: true,
  };
}

function canonicalBolt(b: Bbox): CanonicalForm {
  // Open lightning zigzag: 4 vertices, 3 segments alternating L/R.
  const c = bboxCenter(b);
  const { w, h } = bboxSize(b);
  return {
    points: [
      { x: c.x + w * 0.2, y: b.minY },
      { x: c.x - w * 0.2, y: c.y - h * 0.05 },
      { x: c.x + w * 0.2, y: c.y + h * 0.05 },
      { x: c.x - w * 0.2, y: b.maxY },
    ],
    closed: false,
  };
}

function canonicalHourglass(b: Bbox): CanonicalForm {
  // 4 corners with X-cross sides. Walk TL → BR → BL → TR → TL.
  return {
    points: [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
      { x: b.maxX, y: b.minY },
    ],
    closed: true,
  };
}

/** Take a parametric outline (centred around its own origin) and rescale
 * + translate it to fit `bbox`. Used by the iconic-glyph canonical forms. */
function fitParametricToBbox(outline: NormalizedPoint[], b: Bbox): CanonicalForm {
  if (outline.length === 0) return { points: [], closed: true };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of outline) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const ow = maxX - minX;
  const oh = maxY - minY;
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  const sx = ow > 0 ? bw / ow : 1;
  const sy = oh > 0 ? bh / oh : 1;
  return {
    points: outline.map((p) => ({
      x: b.minX + (p.x - minX) * sx,
      y: b.minY + (p.y - minY) * sy,
    })),
    closed: true,
  };
}

function canonicalSun(b: Bbox, rays = 8): CanonicalForm {
  // Radial sunburst: alternating outer tips and inner valleys around the centre.
  const c = bboxCenter(b);
  const { w, h } = bboxSize(b);
  const rOut = Math.min(w, h) / 2;
  const rIn = rOut * 0.6;
  const pts: NormalizedPoint[] = [];
  const total = rays * 2;
  for (let i = 0; i < total; i++) {
    const a = -Math.PI / 2 + (i / total) * 2 * Math.PI;
    const r = i % 2 === 0 ? rOut : rIn;
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return { points: pts, closed: true };
}

export function canonicalize(
  name: ShapeName,
  bbox: Bbox,
  options: CanonicalizeOptions = {},
): CanonicalForm | null {
  const rotation = options.rotation ?? 0;
  switch (name) {
    case 'triangle':
      return canonicalTriangle(bbox, rotation);
    case 'circle':
      return canonicalCircle(bbox);
    case 'square':
      return canonicalSquare(bbox, rotation);
    case 'rectangle':
      return canonicalRectangle(bbox);
    case 'rhombus':
      return canonicalRhombus(bbox);
    case 'diamond':
      return canonicalDiamond(bbox);
    case 'trapezoid':
      return canonicalTrapezoid(bbox);
    case 'pentagon':
      return canonicalRegularPolygon(bbox, 5, rotation);
    case 'hexagon':
      return canonicalRegularPolygon(bbox, 6, rotation);
    case 'heptagon':
      return canonicalRegularPolygon(bbox, 7, rotation);
    case 'octagon':
      return canonicalRegularPolygon(bbox, 8, rotation);
    case 'nonagon':
      return canonicalRegularPolygon(bbox, 9, rotation);
    case 'decagon':
      return canonicalRegularPolygon(bbox, 10, rotation);
    case 'plusSign':
      return canonicalPlusSign(bbox);
    case 'arrow':
      return canonicalArrow(bbox, false);
    case 'arrowDown':
      return canonicalArrow(bbox, true);
    case 'bolt':
      return canonicalBolt(bbox);
    case 'hourglass':
      return canonicalHourglass(bbox);
    case 'sun':
      return canonicalSun(bbox);
    case 'heart':
      return fitParametricToBbox(heartOutline(), bbox);
    case 'star':
      return fitParametricToBbox(starOutline(4), bbox);
    case 'tear':
      return fitParametricToBbox(tearOutline(), bbox);
    case 'crescent':
      return { ...fitParametricToBbox(crescentOutline(), bbox), closed: false };
    case 'spiral':
      return { ...fitParametricToBbox(spiralOutline(), bbox), closed: false };
    case 'anchor':
      return fitParametricToBbox(anchorOutline(), bbox);
    case 'skull':
      return fitParametricToBbox(skullOutline(), bbox);
    case 'boomerang':
      return { ...fitParametricToBbox(boomerangOutline(), bbox), closed: false };
    case 'shield':
      return fitParametricToBbox(shieldOutline(), bbox);
    default:
      return null;
  }
}

/** Default first-vertex angle for each shape's canonical form. For regular
 * n-gons we put the first vertex at -π/2 (straight up) by convention; for
 * the square we use -π/4 (top-right corner) since that's the natural axis-
 * aligned orientation. */
export function canonicalFirstAngle(name: ShapeName): number {
  if (name === 'square') return -Math.PI / 4;
  return -Math.PI / 2;
}

/** Number of rotational symmetry axes for each shape — used by
 * rotationFromCorners to compute the minimum tilt within the symmetry. */
export function rotationalSymmetry(name: ShapeName): number {
  switch (name) {
    case 'triangle':
      return 3;
    case 'square':
      return 4;
    case 'pentagon':
      return 5;
    case 'hexagon':
      return 6;
    case 'heptagon':
      return 7;
    case 'octagon':
      return 8;
    case 'nonagon':
      return 9;
    case 'decagon':
      return 10;
    default:
      return 1;
  }
}
