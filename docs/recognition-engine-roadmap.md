# The Pattern — Recognition Engine Roadmap

> Path: `/docs/recognition-engine-roadmap.md`
> Audience: Claude Code (executing agent), Madalyn (collaborator agent), Alex (solo developer)
> Status: v1.0 — Locked architectural plan. Edits require a new revision section at the bottom.
> Date issued: May 2026

This document is a sequenced, executable plan for building a robust drawing/gesture recognition engine for **The Pattern**, a sacred-geometry mobile puzzle/tower-defense game (PixiJS + Capacitor, iOS + Android). It is prescriptive. Every phase has a Definition of Done. Every uncertain claim is tagged `[VERIFY]`. Every nontrivial design tension is tagged `[TRADEOFF]`. $Q is the spine — alternatives exist only for benchmarking unless and until $Q is empirically proven inadequate on Alex's actual recorded vocabulary.

---

## TL;DR

- **$Q is the spine.** Vendor `wcchoi/dollar-q` (MIT, single-file JS) as TypeScript on day one. Cross-check correctness against the official `qdollar.js` (BSD-3, UWashington/UCLouvain). Every other recognizer (!FTL, Penny Pincher, Jackknife, µV) lives only in the benchmark harness.
- **The novel work is the compositional grammar layer above $Q**, not the recognizer itself. $Q classifies primitives; a thin TypeScript layer on top performs stroke segmentation, per-segment classification, and spatial-relation predicate evaluation to emit compound game tokens.
- **Templates are the product.** $Q achieves >99% user-dependent accuracy with **5+ samples per class** (per the $P paper, inherited by $Q). "Fine-tuning" means an in-app authoring tool that lets Alex record 5–15 high-quality samples per shape on the actual capture surface, versioned in JSON, committed to the repo.

---

## A. Architecture Decisions to Lock In First

These decisions are **not negotiable after Phase 1 starts**. Lock them now in writing.

### A.1 Recognizer port choice

- **Vendor**: `wcchoi/dollar-q` (https://github.com/wcchoi/dollar-q, MIT). Single-file JS, ~100 LOC, copies the algorithm directly from `cluelab/dollar-recognizers-java` which mirrors the canonical UWashington C# implementation.
- **Cross-validation reference**: official `qdollar.js` (BSD-3, https://depts.washington.edu/acelab/proj/dollar/qdollar.html, attributed to Magrofuoco/Vatavu/Anthony/Wobbrock). Use this only as a numerical oracle in tests — do not link against it; license/style mismatch with our codebase. `[TRADEOFF]` MIT vs BSD-3: both permissive; we pick MIT to keep a single license profile across vendored code.
- **Do not** create a fork or attempt to publish as npm. Vendor it as source under `src/recognition/vendor/` with the original copyright header preserved verbatim and a `VENDORED.md` documenting the source URL, commit SHA, and any local modifications.

### A.2 Module layout

```
/src
  /recognition
    /vendor
      dollarq.ts                    # Ported from wcchoi/dollar-q, types added, no logic changes
      VENDORED.md
    /core
      ShapeRecognizer.ts            # Strategy interface (see A.4)
      DollarQRecognizer.ts          # Adapter implementing ShapeRecognizer over vendor/dollarq.ts
      types.ts                      # StrokePoint, Stroke, Template, RecognitionResult, etc.
    /pipeline
      InputCapture.ts               # PixiJS pointer event → raw StrokePoint stream
      StrokeBuffer.ts               # Frame-rate-independent buffer with timestamps
      Smoother.ts                   # Catmull-Rom / chord-length resampler
      Segmenter.ts                  # Multi-stroke segmentation (idle + spatial gap)
    /grammar
      Primitives.ts                 # Enum of base shape classes
      SpatialRelations.ts           # inside / bisecting / concentric / adjacent-above / ...
      CompositionEngine.ts          # FSM that consumes [primitives + relations] → game tokens
      grammar.spec.ts               # Tests for grammar
    /templates
      packs/                        # Versioned JSON template packs (committed)
        sacred-v0.1.0.json
      schema.json                   # JSON schema (draft-07) for template packs
    /benchmark
      gester-adapter/               # Stripped-down nmagrofuoco/Gester harness
      candidates/                   # !FTL, Penny Pincher, Jackknife, µV adapters
    /telemetry
      RecognitionLog.ts
  /scenes
    /dev
      TemplateAuthorScene.ts        # Phase 2 deliverable, dev-flag-gated
    /game
      ...
/docs
  recognition-engine-roadmap.md     # this file
  RECOGNIZER.md                     # written by Phase 5, updated thereafter
  MADALYN.md                        # operating notes for the Madalyn agent
```

### A.3 Templates — where they live

Templates are **first-class repo content**. They live at `src/recognition/templates/packs/` as JSON files, versioned by semver in the filename and inside the file. Loading is synchronous at recognizer-init time. `[TRADEOFF]` We considered storing templates in IndexedDB on device for hot-swapping, but that defeats deterministic CI testing. Device-side recording in Phase 2 always exports back to a JSON file the developer commits.

### A.4 Strategy pattern interface (the Most Important File)

```typescript
// src/recognition/core/ShapeRecognizer.ts
export interface StrokePoint {
  x: number;
  y: number;
  t: number;           // ms since stroke start, monotonic
  strokeId: number;    // 1-indexed; new stroke = increment
  pressure?: number;   // 0..1 if available; not used by $Q
}

export interface Template {
  name: string;
  classId: string;             // canonical class label, e.g. "pentagram"
  points: StrokePoint[];       // already resampled into n=32 cloud points (per $Q convention)
  meta: TemplateMeta;
}

export interface RecognitionResult {
  classId: string;
  score: number;               // recognizer-defined; for $Q this is ~ "distance" (lower is better)
  normalizedConfidence: number;// 0..1, recognizer-specific normalization. Use this in game logic.
  candidates: Array<{ classId: string; score: number }>; // top-k for grammar layer
  elapsedMs: number;
}

export interface ShapeRecognizer {
  readonly id: string;                                  // "dollar-q", "ftl", "penny-pincher", etc.
  readonly version: string;                             // recognizer engine version
  loadTemplates(templates: Template[]): void;
  recognize(input: StrokePoint[], opts?: { topK?: number }): RecognitionResult;
}
```

Every alternative recognizer (Phase 5) implements this. The game core never imports `dollarq.ts` directly — only `ShapeRecognizer`. This is the swap-out seam.

### A.5 Input event abstraction

PixiJS event objects do not leave the `/scenes` layer. Inside scenes, a thin shim converts `FederatedPointerEvent` to `StrokePoint`:

```typescript
// src/recognition/pipeline/InputCapture.ts
export class InputCapture {
  private start = 0;
  private strokeId = 0;
  private active = false;

  onPointerDown(e: FederatedPointerEvent) {
    this.active = true;
    this.start = performance.now();
    this.strokeId += 1;
    this.emit({ x: e.global.x, y: e.global.y, t: 0, strokeId: this.strokeId });
  }
  onPointerMove(e: FederatedPointerEvent) {
    if (!this.active) return;
    const native = e.nativeEvent as PointerEvent;
    const events = (native.getCoalescedEvents?.() ?? [native]) as PointerEvent[];
    for (const c of events) {
      this.emit({
        x: c.clientX, y: c.clientY,
        t: performance.now() - this.start,
        strokeId: this.strokeId,
      });
    }
  }
  onPointerUp(_: FederatedPointerEvent) { this.active = false; }
  // emit → pushes to StrokeBuffer
}
```

`getCoalescedEvents()` is the W3C-blessed way to recover sub-frame samples on Chrome/Android WebView. `[VERIFY]` Mobile Safari/WKWebView support of `getCoalescedEvents()` is partial as of mid-2026 — fall back to the unwrapped `pointermove` (Apple Pencil reports up to 240Hz natively on `pointermove` in WKWebView per Apple Developer Forums, finger touch is typically 60–120Hz). The shim above degrades cleanly.

### A.6 Recognition vs. grammar separation — the hard rule

The recognizer **must not** know that "circle + dot inside" means a summon-base. The recognizer answers **"what shape is this stroke (or group)"**. The grammar layer answers **"what game token does this combination of recognized shapes plus their spatial relations encode"**. They live in different folders, are tested independently, and are versioned independently. Violating this rule will turn the system into spaghetti within a week.

### A.7 JSON schema for template packs (locked)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PatternTemplatePack",
  "type": "object",
  "required": ["packVersion", "schemaVersion", "captureContext", "classes"],
  "properties": {
    "packVersion":    { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "schemaVersion":  { "type": "string", "const": "1.0.0" },
    "author":         { "type": "string" },
    "createdAt":      { "type": "string", "format": "date-time" },
    "captureContext": {
      "type": "object",
      "required": ["device", "viewport", "pixelRatio"],
      "properties": {
        "device":     { "type": "string" },
        "os":         { "type": "string" },
        "viewport":   { "type": "object", "properties": { "w": { "type": "number" }, "h": { "type": "number" } } },
        "pixelRatio": { "type": "number" },
        "inputType":  { "enum": ["touch", "stylus", "mouse"] }
      }
    },
    "classes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["classId", "samples"],
        "properties": {
          "classId":    { "type": "string" },
          "displayName":{ "type": "string" },
          "samples": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "required": ["raw", "resampled", "capturedAt"],
              "properties": {
                "raw":       { "type": "array", "items": { "$ref": "#/definitions/point" } },
                "resampled": { "type": "array", "items": { "$ref": "#/definitions/point" } },
                "capturedAt":{ "type": "string", "format": "date-time" },
                "boundingBox":{ "type": "object" }
              }
            }
          }
        }
      }
    }
  },
  "definitions": {
    "point": {
      "type": "object",
      "required": ["x", "y", "t", "strokeId"],
      "properties": {
        "x": { "type": "number" }, "y": { "type": "number" },
        "t": { "type": "number" }, "strokeId": { "type": "integer" }
      }
    }
  }
}
```

Both `raw` and `resampled` are stored. Raw is the source of truth (allows future re-resampling at different `n`); `resampled` is what $Q consumes at load time. Loaders trust `schemaVersion`; mismatch → loud error.

### Definition of Done — Section A
A single PR that adds `src/recognition/core/types.ts`, `ShapeRecognizer.ts`, an empty `DollarQRecognizer.ts` stub, the directory layout above, the JSON schema, and `RECOGNIZER.md` skeleton. No runtime behaviour. CI passes. Type checks pass.

---

## B. Phase 1 — Recognizer Spike (1–2 days)

**Goal**: A working `DollarQRecognizer` with a 100% green test suite, callable from a minimal PixiJS scene that prints `{ classId, score }` to a debug overlay when you draw on the screen.

### B.1 Files to create

| Path | Purpose |
|------|---------|
| `src/recognition/vendor/dollarq.ts` | Direct port of `wcchoi/dollar-q` `dollar.js`. Add TS types. Preserve original comments and copyright. **No algorithmic changes.** |
| `src/recognition/vendor/VENDORED.md` | Source URL, commit SHA, license, list of any local modifications. |
| `src/recognition/core/DollarQRecognizer.ts` | Adapter: implements `ShapeRecognizer`, wraps the vendored API, normalizes scoring. |
| `src/recognition/core/__tests__/dollarq.spec.ts` | Unit tests. |
| `src/recognition/core/__tests__/fixtures/greek.json` | Greek alphabet templates from `wcchoi/dollar-q`'s `samples` directory, converted to our schema. |
| `src/recognition/core/__tests__/fixtures/cangjie.json` | Cangjie templates likewise. |
| `src/scenes/dev/RecognizerSpikeScene.ts` | PixiJS scene with an empty canvas; on pointerup, runs recognition and renders the result. |

### B.2 Tests to write (acceptance criteria)

1. **Determinism**: `recognize(sampleA)` returns the same `score` every call for the same input — no time-dependent state leaks.
2. **Self-recognition**: For each Greek letter template, feeding the template's own resampled points back through `recognize` returns that template's class with the lowest possible score (the $Q Cloud-Distance lower bound). Numerical equality up to 1e-9.
3. **Cross-validation against the upstream reference**: Pick 10 candidate gestures from the Greek pack, run them through both our `DollarQRecognizer` and a one-off `qdollar.js` script (BSD-3 reference, executed under Node via a `vitest --run` helper that we delete after the spike). Top-1 classes must match. Top-3 classes must match in the same order.
4. **Multistroke equivalence** (the whole point of $Q over $1): Reorder the strokes in a multistroke template (e.g. an `X` drawn as two strokes), re-run recognition. Result class must be identical. This validates point-cloud invariance.
5. **Empty input handling**: `recognize([])` does not throw; returns a result with `classId === "__none__"` and `score === Infinity`.
6. **Single-point input**: A stroke with one point returns `__none__` (handled by our adapter, not the vendored code, which is allowed to misbehave on degenerate input).

### B.3 PixiJS test scene specifics

```typescript
// src/scenes/dev/RecognizerSpikeScene.ts (sketch)
const recognizer = new DollarQRecognizer();
recognizer.loadTemplates(loadPack("fixtures/greek.json"));

const inputCapture = new InputCapture();
const buffer = new StrokeBuffer();

stage.eventMode = "static";
stage.hitArea = app.screen;
stage.on("pointerdown", e => { buffer.clear(); inputCapture.onPointerDown(e); });
stage.on("globalpointermove", e => inputCapture.onPointerMove(e));
stage.on("pointerup", () => {
  const points = buffer.flush();
  const result = recognizer.recognize(points, { topK: 3 });
  debugText.text = `${result.classId} (${result.normalizedConfidence.toFixed(2)})\n` +
                   result.candidates.map(c => `  ${c.classId} ${c.score.toFixed(3)}`).join("\n");
});
```

### Definition of Done — Phase 1
- `pnpm test` runs all 6 tests above, green.
- `pnpm dev` opens the spike scene; drawing the letter gamma returns `gamma` as top-1 with a pixel-test on a 1024×768 canvas.
- `RECOGNIZER.md` updated with measured median classification time on Alex's dev laptop and a 2024+ mid-tier Android phone (record both — these set the ceiling for Phase 5).

---

## C. Phase 2 — Template Authoring Pipeline (2–3 days)

**Goal**: An in-app, dev-flag-gated PixiJS scene where Alex (or any future contributor) records 5–15 samples per shape, names them, previews existing templates, and exports a versioned JSON pack ready to commit. This is the single most leveraged piece of work in the plan: per the $P paper, accuracy goes from ~95% at 1 sample to >99% at 5+ samples per class, user-dependent. Per `wcchoi/dollar-q`'s own README, the demo's poor accuracy is explicitly attributed to "only one template for each gesture class" — we are fixing that.

### C.1 Dev-flag gating

```typescript
// src/config.ts
export const DEV_FLAGS = {
  TEMPLATE_AUTHOR: import.meta.env.VITE_DEV_TEMPLATE_AUTHOR === "1",
  TELEMETRY_VERBOSE: import.meta.env.VITE_DEV_TELEMETRY === "1",
};
```

The Template Author Scene is mounted only when `DEV_FLAGS.TEMPLATE_AUTHOR`. In Capacitor production builds the env var is unset and the scene's import is tree-shaken.

### C.2 UI components (PixiJS-native, no DOM dependency)

| Component | Behaviour |
|-----------|-----------|
| `ClassListPanel` | Vertical list of class IDs with sample counts; click to focus. |
| `CapturePad` | Full-bleed drawing surface using `@pixi/graphics-smooth` for a clean ink trail. |
| `SamplePreviewStrip` | Horizontal thumbnails of recorded samples for the focused class. Click to delete or replay. |
| `ActionBar` | Buttons: New Class, Record Sample, Delete Sample, Re-record (replaces last), Undo (last action), Export Pack. |
| `MetadataPanel` | Read-only display of pack version, schema version, current `captureContext`. Editable: `author`. |

### C.3 Flows

- **Record sample**: Tap `Record Sample`; pad becomes red-bordered; one stroke or one multistroke session ends on either (a) the user tapping `Done` or (b) idle timeout (default 800ms — see Phase 4 for the same constant). Sample is buffered, raw and resampled both stored, prepended to the strip.
- **Re-record**: Discards last sample for current class, re-enters Record mode.
- **Undo**: Stack of last 20 actions (add sample, delete sample, add class, delete class, rename class). Ctrl/Cmd+Z and an on-screen button.
- **Delete class**: Confirmation modal. Logs to console with the deleted JSON so it can be recovered if needed.
- **Export Pack**: Prompts for a semver bump (patch/minor/major). Constructs the JSON, runs schema validation in-browser (use `ajv`), and offers two paths:
  1. Download via Capacitor `Filesystem` plugin to `Documents/the-pattern-templates/sacred-v{N}.json`. Alex pulls this off-device and commits.
  2. Copy-to-clipboard fallback for development on desktop browser.

### C.4 Edge cases (must be handled)

- Pack already exists at the same version → block export with a clear error; require version bump.
- Class with zero samples present at export time → warn but allow (lets you stage class IDs in advance).
- Sample with `<8` total points (after resampling target of 32) → reject; the bounding box is too small or the stroke is too short to be meaningful. Min stroke length = 32px on the capture viewport. `[VERIFY]` Tune this constant on real devices in Phase 6.
- Capture viewport orientation change mid-session → discard in-flight stroke, re-emit `captureContext`.
- App backgrounding during recording (Capacitor `App.appStateChange`) → auto-save current pack to a `.draft.json` recoverable on next launch.

### Definition of Done — Phase 2
- Alex records 8 samples each for circle, triangle, line, dot, vertical-line, horizontal-line, arc, and pentagram; exports to `sacred-v0.1.0.json`.
- The exported file passes `ajv` schema validation in CI.
- Reloading the file into the recognizer in `RecognizerSpikeScene` shows top-1 accuracy ≥ 95% on a held-out 9th sample of each shape, drawn on the same device.

---

## D. Phase 3 — Input Pipeline Hardening (2 days)

**Goal**: The pointer event path is robust on iOS Safari/WKWebView, Android WebView, and desktop Chrome. No long-press menus, no magnify lens, no callout, no 300ms tap delay, no rubber-banding canvas, no missed sub-frame samples.

### D.1 HTML/CSS (the cheapest, highest-leverage layer)

```html
<!-- index.html -->
<meta name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1,
               user-scalable=no, viewport-fit=cover">
```

```css
/* src/styles/global.css */
html, body, #app, canvas {
  margin: 0; padding: 0;
  width: 100%; height: 100%;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  overscroll-behavior: none;
  touch-action: none;            /* Disables browser pan/zoom on the canvas */
}
```

`touch-action: none` is the linchpin for stopping iOS/Android from intercepting drags as scroll.

### D.2 `capacitor.config.ts`

```typescript
import { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "studio.alex.thepattern",
  appName: "The Pattern",
  webDir: "dist",
  ios: {
    contentInset: "never",
    scrollEnabled: false,            // disables WebView UIScrollView scrolling
    backgroundColor: "#000000",
    allowsLinkPreview: false,        // suppresses long-press preview
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#000000",
    webContentsDebuggingEnabled: true, // dev-only; gate via env var in CI
  },
  plugins: {
    Haptics: {},
    StatusBar: { overlaysWebView: true, style: "DARK" },
  },
};
export default config;
```

`scrollEnabled: false` is the documented Capacitor-side switch. `allowsLinkPreview: false` removes the WKWebView 3D-Touch preview that fires on long-press.

### D.3 iOS extras (the parts Capacitor doesn't expose)

The standing-known issue (Capacitor discussion #3208) is that long-press still triggers the haptic-feedback selection gesture even with `user-select: none`. Two-step fix:

1. CSS already covers selection (above).
2. Add a one-file Capacitor plugin in `ios/App/App/SuppressLongPress.swift` that attaches a `UILongPressGestureRecognizer` with `minimumPressDuration = 0.45` to `webView` and consumes the gesture. Pattern from the linked discussion (preserve attribution comment in the file). Register via `import "./suppress-long-press"` in `AppDelegate`.

`Info.plist` additions:
- `UIRequiresFullScreen = YES` (prevents iPad split-view scaling weirdness during drawing). `[VERIFY]` only set for phone-only builds.
- `UIViewControllerBasedStatusBarAppearance = NO`.

### D.4 Android extras

`android/app/src/main/AndroidManifest.xml`:
- On the main `<activity>`: `android:configChanges="orientation|screenSize|keyboardHidden"` to prevent WebView reload mid-stroke.
- `android:windowSoftInputMode="adjustNothing"` (we never want soft keyboard to resize our canvas).

For Android 12+ stretch overscroll, set `android:overScrollMode="never"` on the WebView's parent layout (open Capacitor issue #5384 confirms there is no JS-side fix — must be set in the native layout XML).

### D.5 Frame-rate-independent capture

The `StrokeBuffer` accepts points from `InputCapture` immediately, regardless of PixiJS render frame timing. PixiJS Ticker is decoupled. The render layer (the ink trail in Phase 6) reads from the buffer at its own cadence; the recognizer reads only on `pointerup`.

Pseudocode:
```typescript
class StrokeBuffer {
  private points: StrokePoint[] = [];
  push(p: StrokePoint) { this.points.push(p); this.dirty = true; }
  flush(): StrokePoint[] { const r = this.points; this.points = []; return r; }
  snapshot(): readonly StrokePoint[] { return this.points; }
}
```

### D.6 Spline smoothing before recognition

Per the State-of-the-Art findings, $Q's own resampler is an even-arc-length resampler (chord-length-uniform), which is fine on dense input but degrades when the device drops to 30Hz under load. Pre-smoothing reduces $Q's resampler input variance.

Implementation: **chord-length-parameterized Catmull-Rom** spline interpolation, then resample at a target spacing of ~4px (canvas-space). Reference implementation patterns: `gdenisov/cardinal-spline-js` (MIT, no deps) is the cleanest; copy the algorithm, not the lib (we only need ~30 lines).

```typescript
// src/recognition/pipeline/Smoother.ts
export function smoothCatmullRom(input: StrokePoint[], targetSpacingPx = 4): StrokePoint[] {
  // 1) Group by strokeId (preserves multistroke for $Q).
  // 2) For each group with >= 4 points, interpolate cubic CR; for shorter groups, return as-is.
  // 3) Resample interpolated path at fixed arc-length spacing.
  // 4) Linearly interpolate timestamps along the new arc.
  // Return concatenation, preserving strokeId.
}
```

`[TRADEOFF]` Smoothing reduces the recognizer's sensitivity to input jitter (good) but can mask intentional cusp features (e.g., the sharp angles of a pentagram). Mitigation: keep `targetSpacingPx ≥ 4` so cusps survive, and only smooth when input dt > 16ms (i.e. don't smooth high-rate stylus input).

### Definition of Done — Phase 3
- On-device: long-pressing the canvas does not produce magnification lens / callout / haptic-buzz on iOS 17+. Two-finger pinch on the canvas does not zoom the WebView. Pulling down on the canvas does not rubber-band.
- On-device: the recognizer scene reports an average of >100 samples in a typical 800ms drawn pentagram on both iPhone 13+ and a 2024 Pixel/Samsung mid-range device.
- `Smoother.ts` has unit tests on synthetic noisy inputs proving max deviation from a known curve is bounded.

---

## E. Phase 4 — Compositional Grammar Layer (3–5 days)

This is the part of the plan with the **least prior art** and the most architectural judgment. Read this section twice before writing any code.

The premise: the player draws something like "circle, then a dot inside the circle". $Q can't natively know "inside" — $Q ignores spatial absolute position post-normalization. We add a layer that:
1. **Segments** the input into per-primitive substrokes.
2. **Classifies** each substroke independently with $Q.
3. **Computes spatial relations** between substrokes using their original (un-normalized) bounding boxes and centroids.
4. **Composes** `(primitive, primitive, relation)` triples into game tokens via a small declarative grammar.

### E.1 Stroke segmentation

A "primitive" in our vocabulary corresponds to one **stroke group**: contiguous pen-down events that form one geometric mark. A pentagram is ONE primitive (one continuous stroke). A "circle with a dot inside" is TWO primitives.

Heuristics for boundary detection:

- **Idle timeout**: if `pointerup` occurs and no `pointerdown` within `IDLE_TIMEOUT_MS` (default **400ms**), the gesture session ends and segmentation runs. `[VERIFY]` Tune in Phase 6.
- **Per-primitive boundaries**: Within a session, each `pointerdown→pointerup` pair starts a candidate primitive. We do **not** rely on stroke count alone — `wcchoi/dollar-q`'s known weakness is that the same multistroke shape can be drawn as 1 or 3 strokes; $Q handles that fine for primitives but our segmentation needs explicit grouping.
- **Spatial-gap fallback**: if a single stroke's bounding box centroid jumps by more than `0.5 * min(canvasW, canvasH)` between successive points (impossible from human motion, indicates pen-up-pen-down miss), insert an artificial boundary.

### E.2 Per-segment classification

Each segment is fed to $Q independently. The grammar layer always asks for `topK = 3` so it has fallback candidates if the top one creates an invalid composition.

### E.3 Spatial relation predicates

```typescript
// src/recognition/grammar/SpatialRelations.ts
export interface PrimitiveOccurrence {
  classId: string;
  bbox: { x: number; y: number; w: number; h: number };
  centroid: { x: number; y: number };
  resampledPoints: StrokePoint[]; // unscaled, in canvas space
  index: number; // order drawn
}

export type Relation =
  | "inside"           // A's bbox fully contains B's bbox (with epsilon tolerance)
  | "concentric"       // centroids within R of each other AND bbox-areas within 30% of each other
  | "bisecting"        // line A passes through B's centroid and exits both sides of B's bbox
  | "adjacent-above"   // B's bbox bottom > A's bbox top, x-ranges overlap >= 50%
  | "adjacent-below" | "adjacent-left" | "adjacent-right"
  | "intersecting"     // bboxes overlap but neither contains the other
  | "disjoint";

export function relate(a: PrimitiveOccurrence, b: PrimitiveOccurrence): Relation { /* ... */ }
```

All predicates are pure functions over bounding-box geometry plus, for `bisecting` and similar, line-segment intersection on the resampled point list. Each predicate returns a `Relation` enum and a confidence ∈ [0,1] (e.g., `inside` returns 1.0 if B's bbox is fully inside A's with 5% margin, falling off linearly outside).

### E.4 The composition engine

A declarative grammar:

```typescript
// src/recognition/grammar/grammar.sacred.ts
import { rule } from "./CompositionEngine";

export const SACRED_GRAMMAR = [
  rule("summon-base",       ["circle", "dot"],            { dot: { inside: "circle" } }),
  rule("binding-spell",     ["pentagram", "circle"],      { circle: { inside: "pentagram" } }),
  rule("split-cast",        ["hexagram", "line"],         { line: { bisecting: "hexagram" } }),
  rule("nullify",           ["circle", "line"],           { line: { bisecting: "circle" } }),
  rule("amplify",           ["triangle", "triangle"],     { "triangle@1": { concentric: "triangle@0" } }),
  // ... more
];
```

`CompositionEngine` is a small finite-state matcher: given a sorted list of `PrimitiveOccurrence` and the computed pairwise relations, it returns the highest-priority rule that matches. Priority is "most primitives matched"; ties broken by rule declaration order. If no rule matches, the result is `unknown-pattern` and the game treats it as a failed cast.

```typescript
// src/recognition/grammar/CompositionEngine.ts (sketch)
export class CompositionEngine {
  constructor(private rules: GrammarRule[]) {}
  evaluate(occurrences: PrimitiveOccurrence[]): GameToken {
    const relations = computePairwise(occurrences);
    for (const r of this.rules.sort(byPriority)) {
      const match = r.tryMatch(occurrences, relations);
      if (match) return { token: r.token, evidence: match };
    }
    return { token: "unknown-pattern", evidence: null };
  }
}
```

### E.5 Required unit tests

Hand-craft (or use Phase 2 to record) inputs for each:

1. Draw circle, then dot inside → `summon-base`.
2. Draw circle, then dot outside → `unknown-pattern` (NOT `summon-base`).
3. Draw pentagram → `unknown-pattern` (incomplete; binding-spell needs the inscribed circle).
4. Draw pentagram, then circle inside → `binding-spell`.
5. Draw pentagram, then circle inside, then ANOTHER dot inside → still matches `binding-spell` rule (we do not require strict completeness; spurious extra primitives drop us to a different/no rule depending on grammar). `[TRADEOFF]` This is permissive — it keeps the player feeling in control. The strict alternative ("every primitive must be accounted for") is more rigorous but punishes accidental dots. Decision: permissive for prototype, revisit at MVP.
6. Hexagram + bisecting line → `split-cast`.
7. Hexagram + line that does NOT pass through centroid → `unknown-pattern`.
8. Two concentric triangles → `amplify`.
9. Two triangles drawn far apart → `unknown-pattern`.

### E.6 TypeScript representation of the grammar

```typescript
export interface GrammarRule {
  token: string;
  primitives: string[];
  /** key: primitive ref (classId or "classId@index"); value: relations to other primitives */
  relations: Record<string, Record<Relation, string>>;
  priority?: number;
}
```

The grammar is a JSON-serializable DSL. We can later expose it to data-only modders. `[VERIFY]` Avoid premature flexibility — keep the grammar in TypeScript for at least 4 weeks before considering a JSON DSL.

### Definition of Done — Phase 4
- The 9 hand-crafted tests above pass.
- Drawing a circle-and-dot in the dev scene reliably reports `summon-base` and visibly logs the matched rule + matched primitives in the debug overlay.
- `RECOGNIZER.md` has a "Grammar reference" section enumerating all rules.

---

## F. Phase 5 — Benchmark and Tune (2 days)

**Goal**: Empirical, defensible numbers. Don't take "it feels accurate" as evidence.

### F.1 Integrate `nmagrofuoco/Gester` (or a stripped equivalent)

`Gester` is a Chrome-only single-page app that takes a JSON dataset and a list of recognizer functions and produces accuracy + speed metrics. It expects a specific format described in its `config.js`. The fastest path:

- Fork `Gester` as a sibling repo (`/tools/gester-the-pattern/`) or clone into a `git submodule`.
- Convert `sacred-v*.json` template packs to Gester's expected JSON via a one-file converter (`tools/convert-to-gester.ts`).
- Add adapter shims for each recognizer: $Q (ours), !FTL (vendor `jperezmedina/FTL` JS source — ~219 LOC), Penny Pincher (port `fe9lix/PennyPincher` Swift to TS — algorithm is trivially short, 2–4 hours), Jackknife (use `ISUE/Jackknife`'s `js/jackknife/` directly), µV (Magrofuoco 2022; reference impl from `nmagrofuoco`'s repo collection). `[VERIFY]` µV may not have a public JS port; if not, omit and leave a note in `RECOGNIZER.md`.
- Run user-dependent dataset-dependent (UDDD) and user-independent dataset-dependent (UIDD) procedures — the two evaluation modes Gester ships with that match our reality (one user = Alex; one dataset).

### F.2 Outputs

Gester produces CSVs by default. Generate:

- A per-class **confusion matrix** (markdown table in `docs/RECOGNIZER.md`).
- A **confusion wheel** PNG (Gester ships this).
- A **speed table**: median ms per recognition, on Alex's laptop and on a target Android device (use Capacitor + a tiny bench scene to dump numbers to console).

### F.3 Threshold tuning

Per-class thresholds, not a global threshold. For each class `c`, compute:
- Distribution of `score` for true positives (held-out 20%).
- Distribution of `score` for the most-confused negative class (look in the matrix).
- Set `threshold[c]` to the value that maximises F1, or — if you care more about user frustration than misfires — pick the 95th-percentile of true positives (more permissive, more false positives).

`[TRADEOFF]` False-positive vs frustration: A permissive threshold lets more "almost there" inputs trigger a cast, which feels generous, but allows wrong casts. A strict threshold rejects iffy inputs, which feels rigorous but punishes the player. Default: **permissive in tutorial/early game, strict in late game**, gameplay-driven.

### F.4 The Recognizer Report artifact

`docs/RECOGNIZER.md` is updated by Phase 5 and re-updated every time the template pack version bumps. Sections:

1. Date, packVersion, recognizer engine version.
2. Vocabulary (list of class IDs).
3. Per-class accuracy (UDDD), per-class accuracy (UIDD).
4. Confusion matrix.
5. Speed table.
6. Recognizer comparison table (rows: $Q, !FTL, Penny Pincher, Jackknife, µV; columns: top-1 acc, median ms, max ms).
7. Notes from this run (e.g., "spiral was confused with circle in 8% of cases — added a 'spiral' minimum-arc-length predicate in the grammar").

Madalyn reads `RECOGNIZER.md` on subsequent sessions to know what's working.

### Definition of Done — Phase 5
- `docs/RECOGNIZER.md` populated with real numbers from Alex's `sacred-v0.1.0.json` pack.
- $Q's per-class accuracy >= 95% UDDD on every shape with >= 5 samples. Any shape failing this is flagged in the report with a "needs more samples" note that loops back to Phase 2.
- A decision is recorded: **either** $Q is sufficient (most likely outcome — proceed to Phase 6) **or** another recognizer wins on a specific subset (rare; document and either swap or Phase 7).

---

## G. Phase 6 — Game-Feel Polish (1–2 days first pass; ongoing)

The recognizer working is necessary but not sufficient. Players judge the game by the feedback loop, not the algorithm.

### G.1 Visual feedback — ink trail

Use `@pixi/graphics-smooth` (drop-in replacement for `PIXI.Graphics`, HHAA anti-aliasing) for the live-drawn trail. Each render frame, redraw the last N=64 points as a polyline with falloff alpha (older points more transparent). Wipe and redraw — `clear()` per frame is the recommended pattern; appending to a never-cleared `Graphics` causes the slowdown documented in PixiJS discussion #7814.

```typescript
// pseudocode
function renderTrail(buffer: StrokePoint[]) {
  trail.clear();
  for (let i = 1; i < buffer.length; i++) {
    const alpha = i / buffer.length;
    trail.lineStyle({ width: 4, color: 0xffd9aa, alpha });
    trail.moveTo(buffer[i-1].x, buffer[i-1].y);
    trail.lineTo(buffer[i].x, buffer[i].y);
  }
}
```

### G.2 Recognition outcome flourishes

- **Success**: particle burst at the centroid of the matched pattern; the matched pattern is briefly redrawn in gold over the player's stroke; brief radial bloom.
- **"Almost"** (score in `(threshold, threshold * 1.5)`): partial flourish — the closest matching glyph is shown ghost-white over the player's stroke for 250ms, with text "Close — try again". This is the single biggest game-feel win and the cheapest. It also implicitly trains the player.
- **Fail**: stroke fades out grey; no flourish. No haptic.

### G.3 Haptics (`@capacitor/haptics`)

| Event | Call |
|-------|------|
| Pointer-down on canvas | `Haptics.selectionStart()` |
| Each new substroke completed (multi-primitive) | `Haptics.selectionChanged()` |
| Pointer-up | `Haptics.selectionEnd()` |
| Successful recognition | `Haptics.impact({ style: ImpactStyle.Medium })` |
| "Almost" feedback | `Haptics.impact({ style: ImpactStyle.Light })` |
| Failed recognition | none |

`[VERIFY]` Capacitor #3406 reports several haptic methods as no-ops on some Android devices; gracefully fall back to `Haptics.vibrate({ duration: 30 })` if `impact` throws.

### G.4 Audio cues

Three SFX: stroke-start (subtle pen-on-paper), recognition-success (chime), recognition-fail (low thud). Use Howler or PixiJS sound; loop nothing; pre-decode at scene init.

### G.5 False-positive prevention

Reject the candidate gesture entirely if any of:
- Total path length < 64 canvas-px. (Prevents accidental taps from being recognized as anything.)
- Bounding-box area < (32 * 32) canvas-px. (Same reasoning.)
- Total duration < 80ms. (Same.)
- Single point. (Already handled in Phase 1.)

These checks live in `DollarQRecognizer.recognize` before invoking $Q. They short-circuit to `__none__`.

### Definition of Done — Phase 6
- Drawing a recognized glyph produces visible flourish + haptic on iPhone and Android device.
- Drawing an unrecognized scribble fades out silently.
- Drawing something close-but-not-quite shows the ghost-glyph hint at least 50% of the time on borderline scores.

---

## H. Phase 7 — ML Escape Hatch (only if Phase 5 reveals problems)

**Do not start this phase preemptively.** Reasons not to:
- $Q at >99% UDDD with 5+ samples is the published baseline. If Alex's vocabulary doesn't reach this, the bug is almost certainly in template quality or grammar logic, not in $Q itself.
- An ML pipeline adds ~3–5 MB of model weights to the bundle, training infrastructure, an ONNX export step, version-skew between trained model and template pack, and a debugging story Alex doesn't yet have time for.

If Phase 5 shows that two specific shapes are persistently confusable (e.g., "vesica piscis" and "circle-with-arc-inside" — geometrically very close) and threshold tuning, more samples, and grammar refinement all fail, then:

### H.1 Hybrid pipeline architecture

```
Input → smoothing → $Q (top-3 candidates) → branching:
  - if top-1 score easily wins: return top-1 (fast path, ~95% of cases)
  - if top-1 and top-2 are close: rasterize stroke to 64x64 grayscale → ONNX tiny CNN → return CNN's top-1
```

A "tiny CNN" here means literally 4 conv layers and 2 FC, ~50k params, ~200KB ONNX file. Not sketch-rnn (Magenta sketch-rnn is generative, not discriminative — wrong tool, despite the QuickDraw connection).

### H.2 Synthetic dataset for sacred geometry

Sacred shapes are mathematically definable: a pentagram is the union of 5 line segments at known angles, a vesica piscis is the intersection of two circles at specific offsets. We can generate **10,000+ perfect-plus-noise** examples per class in Python:

```python
# tools/synthesize.py
def pentagram(noise_sigma=0.02, rotation_jitter=0.1, scale_jitter=0.1):
    pts = canonical_pentagram_points()
    pts = add_gaussian_noise(pts, noise_sigma)
    pts = randomly_rotate(pts, rotation_jitter)
    pts = randomly_scale(pts, scale_jitter)
    pts = randomly_drop_points(pts, p=0.05)  # simulate sensor dropout
    return rasterize(pts, 64, 64)
```

Mix synthetic + Alex's real templates 90/10 in training. This is the same approach used in Taranta et al. UIST '16 ("Rapid Prototyping Approach to Synthetic Data Generation for Improved 2D Gesture Recognition") — domain precedent.

### H.3 Training notebook outline

`tools/train_disambiguator.ipynb`:
1. Load synthetic + real datasets.
2. Define a 4-conv tiny CNN in PyTorch.
3. Train 20 epochs, augment with rotation/scale/noise during training.
4. Validate on held-out real samples only.
5. Export to ONNX with `torch.onnx.export(... opset=13)`.
6. Quantize to int8 with `onnxruntime.quantization` if size is critical.

### H.4 Integration point

A new `ShapeRecognizer` implementation: `HybridQDollarPlusCNN.ts`. Wraps a `DollarQRecognizer` and an `OnnxDisambiguator`. Same `ShapeRecognizer` interface — drop-in. The grammar layer doesn't know.

```typescript
class HybridQDollarPlusCNN implements ShapeRecognizer {
  constructor(
    private dq: DollarQRecognizer,
    private cnn: OnnxDisambiguator,
    private confidenceMargin = 0.15,
  ) {}
  recognize(input: StrokePoint[]): RecognitionResult {
    const r = this.dq.recognize(input, { topK: 3 });
    if (r.candidates.length < 2) return r;
    const margin = (r.candidates[1].score - r.candidates[0].score) / r.candidates[0].score;
    if (margin > this.confidenceMargin) return r; // fast path
    return this.cnn.disambiguate(input, r.candidates);
  }
}
```

ONNX Runtime Web (`onnxruntime-web`) runs in the WebView via WASM with optional WebGL backend. Bundle size ~1MB for the runtime + ~200KB model. Acceptable.

### Definition of Done — Phase 7 (only when entered)
- Confusable pair from Phase 5 disambiguates correctly ≥ 95% of the time on real input.
- Total recognition latency on mid-tier Android remains < 80ms p95.
- A `tools/synthesize.py`, `tools/train_disambiguator.ipynb`, and `models/disambiguator-v1.onnx` are committed.

---

## I. Cross-Cutting Concerns

### I.1 Error handling

Every public function in `/recognition` returns either a typed `Result` or an explicit `__none__` sentinel. **No throws** in the recognition path. A scribble that breaks the recognizer must produce a visible "fail" state, not a crash. Wrap the entire recognizer call in scenes inside a try/catch that logs to `RecognitionLog` and returns the no-match state — a recognizer crash should never break gameplay.

### I.2 Telemetry

```typescript
// src/recognition/telemetry/RecognitionLog.ts
export interface RecognitionEvent {
  ts: string;
  recognizerVersion: string;
  packVersion: string;
  inputPointsCount: number;
  inputDurationMs: number;
  topClass: string;
  topScore: number;
  topNormalizedConfidence: number;
  candidates: Array<{ classId: string; score: number }>;
  matchedToken: string | null;
  groundTruth?: string; // only set in dev mode where the user pre-declares the intended shape
}
```

In dev builds, log to a ring buffer that exports JSON via the same Filesystem path Phase 2 uses. In prod builds, log to memory only and surface only aggregate metrics (count of casts, success rate per class) for analytics. `[TRADEOFF]` Privacy — never log raw point streams in prod without explicit telemetry consent. Schema-version this too.

### I.3 Versioning

Three independent version axes:

| Axis | Where versioned | Bump rules |
|------|-----------------|------------|
| Recognizer engine | `package.json` of recognizer module | semver; major bump if `ShapeRecognizer` interface changes |
| Template pack | Filename + `packVersion` field | semver; minor for new classes, patch for new samples in existing classes |
| Schema | `schemaVersion` field, hardcoded const | semver; loaders refuse mismatched majors |

Backward compat plan: the loader must accept any pack with the same schema major. We commit to NOT bumping the schema major until at least MVP.

### I.4 Test data discipline

Every committed template pack has at least one corresponding integration test that loads it, runs it through `DollarQRecognizer`, and asserts a known-good top-1 on a held-out sample stored alongside the pack as `sacred-v0.1.0.holdout.json`. Claude Code can run `pnpm test` offline at any point.

### I.5 Documentation

| File | Owner | Purpose |
|------|-------|---------|
| `docs/recognition-engine-roadmap.md` | This file. Frozen except for revision sections. | The plan. |
| `docs/RECOGNIZER.md` | Auto-updated by Phase 5; manually annotated by Alex/Madalyn. | Empirical state of the recognizer (accuracy, speed, confusions). |
| `docs/MADALYN.md` | Madalyn updates after each session. | Operational notes: "we tried X, it didn't work because Y, the next thing to try is Z." Persistent context across sessions. |
| `src/recognition/vendor/VENDORED.md` | Alex updates on each vendor refresh. | Provenance. |
| `README.md` | Standard. | Add a "Recognition engine" section linking to all of the above. |

### I.6 Repo layout (consolidated)

```
the-pattern/
├── android/
├── ios/
├── docs/
│   ├── recognition-engine-roadmap.md
│   ├── RECOGNIZER.md
│   └── MADALYN.md
├── src/
│   ├── recognition/      (see Section A.2)
│   ├── scenes/
│   ├── game/             (Madalyn's domain, mostly)
│   ├── styles/global.css
│   └── config.ts
├── tools/
│   ├── convert-to-gester.ts
│   ├── synthesize.py     (Phase 7 only)
│   └── train_disambiguator.ipynb (Phase 7 only)
├── capacitor.config.ts
├── package.json
└── README.md
```

---

## J. Specific Claude Code Prompts

Each prompt below is single-session-completable (a few hours each), self-contained, and has explicit acceptance criteria. Paste verbatim.

### Prompt 1 — Vendor and type the recognizer

> Vendor `wcchoi/dollar-q` (https://github.com/wcchoi/dollar-q, MIT) into `src/recognition/vendor/dollarq.ts`. Preserve original copyright/comments verbatim. Add full TypeScript types — every function, every parameter, every return — but make NO algorithmic changes. Add `src/recognition/vendor/VENDORED.md` recording the source URL, current commit SHA, and license. Confirm `tsc --noEmit` passes. Do not write tests yet.

### Prompt 2 — Implement the ShapeRecognizer adapter

> Implement `src/recognition/core/DollarQRecognizer.ts` as an adapter that wraps `src/recognition/vendor/dollarq.ts` and implements the `ShapeRecognizer` interface defined in `src/recognition/core/ShapeRecognizer.ts`. Add a `normalizedConfidence` field that maps the vendor's distance score into [0,1] using `1 / (1 + score)`. Reject inputs with fewer than 2 points or total path length under 64px (canvas units) by returning `{ classId: "__none__", score: Infinity, normalizedConfidence: 0, candidates: [], elapsedMs: 0 }`. Do not modify the vendor file.

### Prompt 3 — Test suite for $Q

> Create `src/recognition/core/__tests__/dollarq.spec.ts` using vitest. Convert `wcchoi/dollar-q`'s Greek alphabet samples (in its `samples/greek/` directory) into our JSON template-pack schema and place at `src/recognition/core/__tests__/fixtures/greek.json`. Implement these six tests verbatim from the roadmap section B.2: determinism, self-recognition, cross-validation against the upstream reference (use `qdollar.js` from https://depts.washington.edu/acelab/proj/dollar/qdollar.html as a one-off node script, then delete it from the repo), multistroke equivalence, empty input, single-point input. Acceptance: `pnpm test` runs all six green.

### Prompt 4 — Capacitor + WebView gesture suppression

> Update `capacitor.config.ts` per roadmap section D.2. Update `src/styles/global.css` per D.1. Add the iOS Swift long-press suppressor per D.3 — create `ios/App/App/SuppressLongPress.swift` based on the pattern in https://github.com/ionic-team/capacitor/discussions/3208 and register it in `AppDelegate`. Update `android/app/src/main/AndroidManifest.xml` per D.4. After deployment, on physical iPhone and Android device, confirm: (a) long-pressing the WebView does not show callout/lens, (b) two-finger pinch on canvas does not zoom, (c) pulling-down on canvas does not bounce. Document any deviations in `docs/MADALYN.md`.

### Prompt 5 — InputCapture and StrokeBuffer

> Implement `src/recognition/pipeline/InputCapture.ts` and `StrokeBuffer.ts` per roadmap A.5. `InputCapture` must use `getCoalescedEvents()` when available, fall back gracefully when not. Wire it into a new dev scene `src/scenes/dev/RecognizerSpikeScene.ts` that listens on a stage with `eventMode = "static"` and `hitArea = app.screen`. Display the live point count in a debug overlay, and on `pointerup`, run `DollarQRecognizer.recognize` and display top-3 candidates with scores. Test on iPhone + Android: a typical 800ms stroke must produce at least 80 points logged.

### Prompt 6 — Catmull-Rom smoother

> Implement `src/recognition/pipeline/Smoother.ts` per roadmap D.6. Use chord-length-parameterized Catmull-Rom interpolation. Group input points by `strokeId` so multistrokes are preserved. Resample at 4px target spacing. Add unit tests using a synthetic noisy circle (true points plus Gaussian noise sigma=2px) — assert the smoothed output's max deviation from the noiseless circle is under 1px. Wire into `RecognizerSpikeScene` such that the smoothed points (not raw) are fed to the recognizer; expose a debug toggle to compare smoothed-vs-raw recognition results.

### Prompt 7 — Template Author Scene (Phase 2)

> Build `src/scenes/dev/TemplateAuthorScene.ts` per roadmap section C. UI components per C.2; flows per C.3; edge cases per C.4. Gate behind `DEV_FLAGS.TEMPLATE_AUTHOR`. Validate exports against `src/recognition/templates/schema.json` using `ajv` before download. Use Capacitor `Filesystem.writeFile` for download on device, and `navigator.clipboard.writeText` fallback on desktop. Acceptance: Alex can record 8 samples each for 8 base shapes, export `sacred-v0.1.0.json`, and the file passes `ajv` validation.

### Prompt 8 — Composition engine and grammar tests

> Implement `src/recognition/grammar/SpatialRelations.ts` and `CompositionEngine.ts` per roadmap section E. Define the initial grammar in `src/recognition/grammar/grammar.sacred.ts` with the three example rules: summon-base, binding-spell, split-cast (plus nullify, amplify). Write the 9 unit tests listed in E.5. Acceptance: `pnpm test` runs all 9 green; in `RecognizerSpikeScene`, drawing a circle then a dot inside it logs `summon-base` to the debug overlay.

### Prompt 9 — Benchmark harness

> Add `tools/convert-to-gester.ts` that converts our template-pack JSON to Gester's input format. Vendor `nmagrofuoco/Gester` (https://github.com/nmagrofuoco/Gester) into `src/recognition/benchmark/gester-vendor/`. Implement adapters in `src/recognition/benchmark/candidates/` for $Q (ours), !FTL (port from https://github.com/jperezmedina/FTL), Penny Pincher (port from https://github.com/fe9lix/PennyPincher), Jackknife (use `js/jackknife/` from https://github.com/ISUE/Jackknife). Skip µV unless a JS reference impl is found. Run UDDD and UIDD on Alex's `sacred-v0.1.0.json`. Write the report to `docs/RECOGNIZER.md` per roadmap section F.4.

### Prompt 10 — Game-feel polish first pass

> Implement the visual feedback layer per roadmap section G. Use `@pixi/graphics-smooth` for the ink trail with falloff alpha. Implement success/fail/almost flourishes per G.2. Wire `@capacitor/haptics` per G.3 with the fallback for Android `impact` no-op per the roadmap note. Add the four false-positive guards in `DollarQRecognizer.recognize` per G.5. Acceptance on physical device: drawing a recognized glyph produces visible flourish + medium haptic; drawing scribble silently fades; drawing borderline produces ghost-glyph hint and light haptic.

---

## Caveats

- **`[VERIFY]` $Q resampling target `n=32`** is the published default; we keep it. If, after Phase 5, certain shapes (very long spirals, complex sigils) underperform, raising `n` to 64 is a single-line change with a measurable speed cost.
- **`[VERIFY]` Mobile Safari `getCoalescedEvents()` support** is partial as of mid-2026 — the fallback path in InputCapture is tested but not yet measured against Apple Pencil 240Hz. Madalyn should re-test when iOS 18+ becomes the floor target.
- **`[TRADEOFF]` We are not benchmarking sketch-rnn or any RNN-based recognizer.** They are generative, not the right tool for closed-vocabulary classification. Phase 7's tiny CNN is the only ML door we keep open.
- **`[TRADEOFF]` Single-developer, time-boxed.** Phases 1–4 are sequential and gate everything else. Phases 5 and 6 can run in parallel after Phase 4. Phase 7 is opt-in. Natural pause points exist after each phase's Definition of Done — leaving the project in a working state.
- **Treat $Q as the spine.** Every alternative recognizer in this plan exists in the benchmark harness, not in the production code path. Promoting one of them to production requires (a) a `RECOGNIZER.md` entry showing it wins on Alex's actual vocabulary by ≥ 3 percentage points top-1, AND (b) it fits the same `ShapeRecognizer` interface with no changes to scenes or grammar. This is the discipline that prevents a rewrite spiral.
- **The grammar layer is the work.** Most of the engineering risk is in Phase 4. Most of the gameplay-feel risk is in Phase 6. The recognizer itself, by Phase 1's end, is a solved problem. Allocate worry accordingly.