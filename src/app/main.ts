// SRE Day-1 debugger UI.
//
// Capture pointer events, push the stroke through preprocessStrokes, and
// render the raw stroke + the 64-point resampled cloud overlaid in the
// original drawing space (centroid added back so things line up visually).
//
// This is *not* the game UI. It's a verification surface for the SRE pipeline.

import type {
  NormalizedPoint,
  PointerType,
  RawPoint,
  RecognitionResult,
  ShapeFeatures,
  Stroke,
} from '../sre/types.js';
import { preprocessStrokes } from '../sre/preprocessing.js';
import { extractFeatures } from '../sre/features.js';
import { recognize } from '../sre/recognize.js';
import {
  canonicalize,
  canonicalFirstAngle,
  rotationalSymmetry,
  rotationFromCorners,
  type CanonicalForm,
} from '../sre/canonicalize.js';
import { recognizeComposite, type CompositeResult } from '../sre/composite.js';
import { buildTemplate, type QTemplate } from '../sre/qdollar.js';
import { getStroke } from 'perfect-freehand';
import {
  addRuntimeTemplate,
  getRuntimeTemplateCount,
  setRuntimeTemplates,
} from '../sre/templates.js';
import { detectOs, type CaptureContext } from '../sre/template-schema.js';
import type { ShapeName } from '../sre/types.js';

const KNOWN_SHAPE_NAMES: ReadonlySet<string> = new Set<ShapeName>([
  // Geometric units
  'triangle', 'circle', 'square', 'rectangle', 'rhombus', 'diamond', 'trapezoid',
  'pentagon', 'hexagon', 'heptagon', 'octagon', 'nonagon', 'decagon',
  // Symbol units / dual-role
  'plusSign', 'arrow', 'arrowDown', 'bolt', 'tear', 'shield', 'star', 'boomerang',
  // Class units
  'shuriken', 'flask', 'eye', 'hammer', 'crown', 'bell',
  // B-direction additions (v4.2 — see project_pattern_dictionary memory)
  'sword', 'bow', 'axe', 'dagger', 'fang', 'claw', 'wing',
  'scroll', 'orb', 'lantern', 'gem', 'boot', 'helmet',
  // Modifier sources (inner-only)
  'flame', 'wave', 'feather', 'snowflake', 'crescent', 'sun', 'skull',
  'hourglass', 'anchor', 'heart', 'spiral',
]);

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2d canvas context unavailable');

const statsEl = document.getElementById('stats') as HTMLElement;
const clearBtn = document.getElementById('clear') as HTMLButtonElement;
const recognizeBtn = document.getElementById('recognize') as HTMLButtonElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const saveTemplateBtn = document.getElementById('save-template') as HTMLButtonElement;
const labelEl = document.getElementById('label') as HTMLInputElement;
const saveStatusEl = document.getElementById('save-status') as HTMLElement;

const COLOR_BG = '#0a0a12';
const COLOR_RAW = '#e8e8ea';
const COLOR_RAW_FAINT = '#3a3a44';
const COLOR_SNAPPED = '#e8e8ea';
const COLOR_INNER = '#e8a13a'; // distinct color for the inner glyph in a composite
const COLOR_RESAMPLED = '#6fb5c9';
const COLOR_BBOX = '#2a2a36';
const COLOR_CENTROID = '#9aa5b1';
const COLOR_CORNER = '#e8a13a';
const COLOR_CLOSURE = '#5a5a6a';

const COMMIT_DELAY_MS = 1500;

let dpr = window.devicePixelRatio || 1;
let activePointerId: number | null = null;
let drawingPoints: RawPoint[] = [];

// Strokes collected since the last commit. The composite parser runs over
// this buffer when the user pauses (1.5 s) or hits the commit button.
let strokeBuffer: Stroke[] = [];
let commitTimer: number | null = null;

interface GroupRender {
  recognition: RecognitionResult;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  canonical: CanonicalForm | null;
  cornerPositions: NormalizedPoint[];
}

let lastResult: {
  composite: CompositeResult;
  groups: GroupRender[];
  runtimeMs: number;
} | null = null;

function asPointerType(p: string): PointerType {
  return p === 'pen' || p === 'touch' ? p : 'mouse';
}

function resizeCanvas(): void {
  dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clearCanvas(): void {
  ctx!.fillStyle = COLOR_BG;
  ctx!.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
}

function drawPolyline(pts: { x: number; y: number }[], color: string, width: number): void {
  if (pts.length < 2) return;
  ctx!.strokeStyle = color;
  ctx!.lineWidth = width;
  ctx!.lineJoin = 'round';
  ctx!.lineCap = 'round';
  ctx!.beginPath();
  ctx!.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) {
    ctx!.lineTo(pts[i]!.x, pts[i]!.y);
  }
  ctx!.stroke();
}

/** Render raw input as a tapered, pressure/velocity-sensitive ink stroke
 *  via perfect-freehand. Produces a filled outline polygon — feels like
 *  real ink instead of a uniform-width plotter line. Used for live drawing
 *  and recently-drawn buffer ghosts; canonical (snapped) shapes still use
 *  the precise polyline/polygon renderers above.
 */
function drawInkStroke(
  pts: readonly RawPoint[] | readonly { x: number; y: number; pressure?: number }[],
  color: string,
  size: number,
): void {
  if (pts.length < 2) return;
  const inputs: [number, number, number][] = pts.map((p) => [
    p.x,
    p.y,
    typeof (p as { pressure?: number }).pressure === 'number'
      ? (p as { pressure?: number }).pressure!
      : 0.5,
  ]);
  const outline = getStroke(inputs, {
    size,
    thinning: 0.55,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: true,
    last: true,
    start: { taper: true, cap: true },
    end: { taper: true, cap: true },
  });
  if (outline.length < 3) return;
  ctx!.fillStyle = color;
  ctx!.beginPath();
  ctx!.moveTo(outline[0]![0], outline[0]![1]);
  for (let i = 1; i < outline.length; i++) {
    ctx!.lineTo(outline[i]![0], outline[i]![1]);
  }
  ctx!.closePath();
  ctx!.fill();
}

function drawDots(pts: { x: number; y: number }[], color: string, radius: number): void {
  ctx!.fillStyle = color;
  for (const p of pts) {
    ctx!.beginPath();
    ctx!.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx!.fill();
  }
}

function drawBbox(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  color: string,
): void {
  ctx!.strokeStyle = color;
  ctx!.lineWidth = 1;
  ctx!.setLineDash([4, 4]);
  ctx!.strokeRect(bbox.minX, bbox.minY, bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  ctx!.setLineDash([]);
}

function drawCentroidMarker(p: { x: number; y: number }, color: string): void {
  const s = 6;
  ctx!.strokeStyle = color;
  ctx!.lineWidth = 1;
  ctx!.beginPath();
  ctx!.moveTo(p.x - s, p.y);
  ctx!.lineTo(p.x + s, p.y);
  ctx!.moveTo(p.x, p.y - s);
  ctx!.lineTo(p.x, p.y + s);
  ctx!.stroke();
}

function drawCornerMarkers(pts: { x: number; y: number }[], color: string): void {
  ctx!.strokeStyle = color;
  ctx!.lineWidth = 2;
  ctx!.fillStyle = color;
  for (const p of pts) {
    ctx!.beginPath();
    ctx!.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx!.stroke();
    ctx!.beginPath();
    ctx!.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx!.fill();
  }
}

function drawClosureLine(
  a: { x: number; y: number },
  b: { x: number; y: number },
  color: string,
): void {
  ctx!.strokeStyle = color;
  ctx!.lineWidth = 1;
  ctx!.setLineDash([3, 3]);
  ctx!.beginPath();
  ctx!.moveTo(a.x, a.y);
  ctx!.lineTo(b.x, b.y);
  ctx!.stroke();
  ctx!.setLineDash([]);
}

function drawClosedPolygon(pts: { x: number; y: number }[], color: string, width: number): void {
  if (pts.length < 2) return;
  ctx!.strokeStyle = color;
  ctx!.lineWidth = width;
  ctx!.lineJoin = 'round';
  ctx!.lineCap = 'round';
  ctx!.beginPath();
  ctx!.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) {
    ctx!.lineTo(pts[i]!.x, pts[i]!.y);
  }
  ctx!.closePath();
  ctx!.stroke();
}

function render(): void {
  clearCanvas();

  // Render any not-yet-committed strokes in the buffer as faint ghosts so
  // the user can see what they've drawn.
  for (const s of strokeBuffer) {
    drawInkStroke(s.points, COLOR_RAW_FAINT, 4);
  }

  // After commit: render each recognized group's canonical form.
  if (lastResult) {
    for (let i = 0; i < lastResult.groups.length; i++) {
      const g = lastResult.groups[i]!;
      const isInner =
        lastResult.composite.isNested && i === lastResult.composite.innerIndex;
      const color = isInner ? COLOR_INNER : COLOR_SNAPPED;

      drawBbox(g.bbox, COLOR_BBOX);

      if (g.canonical) {
        if (g.canonical.closed) {
          drawClosedPolygon(g.canonical.points, color, 2.5);
        } else {
          drawPolyline(g.canonical.points, color, 2.5);
        }
      } else {
        // No recognition — keep the raw rendering so the user sees what
        // they drew.
        const rawStroke = lastResult.composite.groups[i]!.group.strokes[0];
        if (rawStroke) {
          drawInkStroke(rawStroke.points, COLOR_RAW, 5);
        }
        drawCornerMarkers(g.cornerPositions, COLOR_CORNER);
      }
    }
  }

  if (drawingPoints.length > 1) {
    drawInkStroke(drawingPoints, COLOR_RAW, 5);
  }
}

function updateStats(text: string[]): void {
  statsEl.innerHTML = '';
  for (const line of text) {
    const div = document.createElement('div');
    div.className = 'row';
    div.textContent = line;
    statsEl.appendChild(div);
  }
}

function processGroup(strokes: readonly Stroke[]): GroupRender {
  const norm = preprocessStrokes(strokes);
  const features = extractFeatures(norm);
  // Pass the cloud so the cascade can use $Q for iconic glyphs.
  const recognition = recognize(features, { cloud: norm.points });

  const cx = norm.raw.reduce((s, p) => s + p.x, 0) / norm.raw.length;
  const cy = norm.raw.reduce((s, p) => s + p.y, 0) / norm.raw.length;

  const resampledInDrawSpace: NormalizedPoint[] = norm.points.map((p) => ({
    x: p.x + cx,
    y: p.y + cy,
  }));
  const cornerPositions: NormalizedPoint[] = features.cornerIndices
    .map((i) => resampledInDrawSpace[i])
    .filter((p): p is NormalizedPoint => p !== undefined);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of resampledInDrawSpace) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  let canonical: CanonicalForm | null = null;
  if (recognition.shape) {
    const sym = rotationalSymmetry(recognition.shape);
    const rotation =
      sym >= 3
        ? rotationFromCorners(
            features.cornerPoints,
            sym,
            canonicalFirstAngle(recognition.shape),
          )
        : 0;
    canonical = canonicalize(
      recognition.shape,
      { minX, minY, maxX, maxY },
      { rotation },
    );
  }

  return { recognition, bbox: { minX, minY, maxX, maxY }, canonical, cornerPositions };
}

function commitBuffer(): void {
  if (commitTimer !== null) {
    window.clearTimeout(commitTimer);
    commitTimer = null;
  }
  if (strokeBuffer.length === 0) return;

  const t0 = performance.now();
  const composite = recognizeComposite(strokeBuffer);
  const groups = composite.groups.map((g) => processGroup(g.group.strokes));
  const elapsed = performance.now() - t0;

  lastResult = { composite, groups, runtimeMs: elapsed };
  strokeBuffer = [];
  saveBtn.disabled = false;
  saveTemplateBtn.disabled = false;
  setSaveStatus('', 'idle');

  // Stats panel
  const lines: string[] = [];
  if (composite.isNested) {
    const outer = groups[composite.outerIndex!]!.recognition;
    const inner = groups[composite.innerIndex!]!.recognition;
    lines.push(
      `> ${outer.shape ?? '?'} containing ${inner.shape ?? '?'}  (${outer.confidence.toFixed(2)} / ${inner.confidence.toFixed(2)})`,
    );
  } else if (groups.length === 1) {
    const r = groups[0]!.recognition;
    lines.push(
      r.shape
        ? `> ${r.shape}  (${r.confidence.toFixed(2)})`
        : `> unrecognized  (best ${r.confidence.toFixed(2)})`,
    );
  } else {
    lines.push(`> ${groups.length} shapes`);
    for (let i = 0; i < groups.length; i++) {
      const r = groups[i]!.recognition;
      lines.push(`  [${i}] ${r.shape ?? 'unrecognized'} (${r.confidence.toFixed(2)})`);
    }
  }
  lines.push('');
  lines.push(`groups         ${groups.length}`);
  lines.push(`nested         ${composite.isNested ? 'yes' : 'no'}`);
  lines.push(`runtime        ${elapsed.toFixed(2)} ms`);
  updateStats(lines);

  render();
}

function scheduleCommit(): void {
  if (commitTimer !== null) window.clearTimeout(commitTimer);
  commitTimer = window.setTimeout(() => {
    commitTimer = null;
    commitBuffer();
  }, COMMIT_DELAY_MS);
}

canvas.addEventListener('pointerdown', (e: PointerEvent) => {
  if (activePointerId !== null) return;
  canvas.setPointerCapture(e.pointerId);
  activePointerId = e.pointerId;
  drawingPoints = [
    {
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      pressure: e.pressure,
      pointerType: asPointerType(e.pointerType),
    },
  ];
  // Starting a new stroke cancels any pending commit and clears the previous
  // result so the user sees the new gesture cleanly.
  if (commitTimer !== null) {
    window.clearTimeout(commitTimer);
    commitTimer = null;
  }
  if (lastResult !== null) {
    lastResult = null;
    strokeBuffer = [];
  }
  render();
});

canvas.addEventListener('pointermove', (e: PointerEvent) => {
  if (e.pointerId !== activePointerId) return;
  const events: PointerEvent[] =
    typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
  for (const ce of events) {
    drawingPoints.push({
      x: ce.clientX,
      y: ce.clientY,
      t: ce.timeStamp,
      pressure: ce.pressure,
      pointerType: asPointerType(ce.pointerType),
    });
  }
  render();
});

function endStroke(e: PointerEvent): void {
  if (e.pointerId !== activePointerId) return;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    // capture may already be released
  }
  activePointerId = null;

  if (drawingPoints.length >= 2) {
    const stroke: Stroke = {
      points: drawingPoints,
      startTime: drawingPoints[0]!.t,
      endTime: drawingPoints[drawingPoints.length - 1]!.t,
      pointerType: drawingPoints[0]!.pointerType ?? 'mouse',
    };
    strokeBuffer.push(stroke);
    // Auto-commit disabled — user clicks 🔍 recognize when ready, or 📌 save
    // as template to save without ever running the recognizer.
    recognizeBtn.disabled = false;
    saveTemplateBtn.disabled = false;
  }
  drawingPoints = [];
  render();
}

canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

clearBtn.addEventListener('click', () => {
  drawingPoints = [];
  strokeBuffer = [];
  if (commitTimer !== null) {
    window.clearTimeout(commitTimer);
    commitTimer = null;
  }
  lastResult = null;
  recognizeBtn.disabled = true;
  saveBtn.disabled = true;
  saveTemplateBtn.disabled = true;
  setSaveStatus('', 'idle');
  updateStats([
    'draw something',
    'manual mode — 🔍 to recognize, 📌 to save as template',
    `templates loaded: ${getRuntimeTemplateCount()}`,
  ]);
  render();
});

function setSaveStatus(text: string, kind: 'idle' | 'success' | 'error'): void {
  saveStatusEl.textContent = text;
  saveStatusEl.classList.remove('success', 'error');
  if (kind === 'success') saveStatusEl.classList.add('success');
  if (kind === 'error') saveStatusEl.classList.add('error');
}

async function saveCurrentSample(): Promise<void> {
  if (!lastResult) return;
  const label = labelEl.value.trim();
  if (!label) {
    labelEl.focus();
    setSaveStatus('label first', 'error');
    return;
  }
  setSaveStatus('saving…', 'idle');
  try {
    const composite = lastResult.composite;
    // The first group's stroke list represents what we'd want to replay; for
    // single-shape gestures this matches the original 1-stroke save format.
    const allStrokes = composite.groups.flatMap((g) => g.group.strokes);
    const payload = {
      label,
      stroke: allStrokes[0] ?? null, // legacy single-stroke field
      strokes: allStrokes,
      composite: {
        isNested: composite.isNested,
        outerIndex: composite.outerIndex,
        innerIndex: composite.innerIndex,
        groups: composite.groups.map((g, i) => ({
          bbox: g.group.bbox,
          recognition: {
            shape: g.recognition.shape,
            confidence: g.recognition.confidence,
            alternativeMatches: g.recognition.alternativeMatches,
          },
          features: lastResult!.groups[i]?.recognition.features,
        })),
      },
      runtimeMs: lastResult.runtimeMs,
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr },
      userAgent: navigator.userAgent,
    };
    const res = await fetch('/api/save-sample', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = (await res.json()) as { ok: boolean; filename?: string; error?: string };
    if (result.ok) {
      setSaveStatus(`saved ${result.filename}`, 'success');
    } else {
      setSaveStatus(`error: ${result.error ?? 'unknown'}`, 'error');
    }
  } catch (err) {
    setSaveStatus(`error: ${String(err)}`, 'error');
  }
}

saveBtn.addEventListener('click', () => {
  void saveCurrentSample();
});

async function saveCurrentTemplate(): Promise<void> {
  const label = labelEl.value.trim().toLowerCase();
  if (!label) {
    labelEl.focus();
    setSaveStatus('label first', 'error');
    return;
  }
  if (!KNOWN_SHAPE_NAMES.has(label)) {
    labelEl.focus();
    setSaveStatus(`"${label}" is not a known shape`, 'error');
    return;
  }
  // Pull strokes from either the buffer (no recognition has run yet) or
  // the last recognized result. Template-saving doesn't need recognition —
  // the user's label IS the truth.
  const allStrokes: Stroke[] =
    strokeBuffer.length > 0
      ? [...strokeBuffer]
      : (lastResult?.composite.groups.flatMap((g) => g.group.strokes) ?? []);
  if (allStrokes.length === 0) {
    setSaveStatus('nothing to save', 'error');
    return;
  }
  const points: NormalizedPoint[] = allStrokes.flatMap((s) =>
    s.points.map((p) => ({ x: p.x, y: p.y })),
  );
  if (points.length < 4) {
    setSaveStatus('stroke too short', 'error');
    return;
  }
  // Pick the dominant pointer type from the captured strokes — touch +
  // stylus + mouse can mix in theory, but in practice one type dominates.
  const ptCounts: Record<string, number> = { touch: 0, pen: 0, mouse: 0 };
  for (const s of allStrokes) {
    for (const p of s.points) {
      const t = p.pointerType ?? 'mouse';
      ptCounts[t] = (ptCounts[t] ?? 0) + 1;
    }
  }
  const dominantPtType = Object.entries(ptCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'mouse';
  const inputType: CaptureContext['inputType'] =
    dominantPtType === 'pen' ? 'stylus' : dominantPtType === 'touch' ? 'touch' : 'mouse';
  const captureContext: CaptureContext = {
    device: navigator.userAgent,
    os: detectOs(navigator.userAgent),
    viewport: { w: window.innerWidth, h: window.innerHeight },
    pixelRatio: window.devicePixelRatio || 1,
    inputType,
  };
  setSaveStatus('saving template…', 'idle');
  try {
    const res = await fetch('/api/save-template', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shape: label,
        points,
        stroke: allStrokes[0] ?? null,
        captureContext,
      }),
    });
    const result = (await res.json()) as { ok: boolean; filename?: string; error?: string };
    if (!result.ok) {
      setSaveStatus(`error: ${result.error ?? 'unknown'}`, 'error');
      return;
    }
    // Update in-memory library so the next gesture uses the new template.
    const tmpl = buildTemplate(label as ShapeName, points, label);
    addRuntimeTemplate(tmpl);
    setSaveStatus(
      `📌 saved ${result.filename}  (templates: ${getRuntimeTemplateCount()})`,
      'success',
    );
  } catch (err) {
    setSaveStatus(`error: ${String(err)}`, 'error');
  }
}

saveTemplateBtn.addEventListener('click', () => {
  void saveCurrentTemplate();
});

recognizeBtn.addEventListener('click', () => {
  commitBuffer();
  recognizeBtn.disabled = true;
});

labelEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !saveBtn.disabled) {
    void saveCurrentSample();
  }
});

window.addEventListener('resize', () => {
  resizeCanvas();
  render();
});

async function loadRuntimeTemplates(): Promise<void> {
  try {
    const res = await fetch('/api/list-templates');
    const result = (await res.json()) as {
      ok: boolean;
      templates?: Array<{ shape: string; points: NormalizedPoint[]; schemaVersion?: string }>;
    };
    if (!result.ok || !result.templates) return;
    const built: QTemplate[] = [];
    let skippedSchema = 0;
    let skippedShape = 0;
    for (const t of result.templates) {
      // Schema-version gate per template-schema.ts. Mismatched majors → drop
      // with a warning. Files predating the schema (no `schemaVersion`) are
      // treated as legacy and accepted only for the current major to keep
      // backward compat during the transition; once all templates carry
      // metadata we can tighten this.
      const ver = t.schemaVersion;
      if (ver && !ver.startsWith('1.')) {
        skippedSchema++;
        continue;
      }
      if (!KNOWN_SHAPE_NAMES.has(t.shape) || !Array.isArray(t.points) || t.points.length < 4) {
        skippedShape++;
        continue;
      }
      built.push(buildTemplate(t.shape as ShapeName, t.points, t.shape));
    }
    if (skippedSchema > 0) {
      console.warn(
        `[templates] dropped ${skippedSchema} templates with incompatible schemaVersion`,
      );
    }
    setRuntimeTemplates(built);
    updateStats([
      'draw something',
      'manual mode — 🔍 to recognize, 📌 to save as template',
      `templates loaded: ${getRuntimeTemplateCount()}`,
    ]);
  } catch {
    // server middleware not available — fine, just use synthetic templates
  }
}

resizeCanvas();
clearCanvas();
void loadRuntimeTemplates();
