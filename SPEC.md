# Practice Looper — Claude Code Brief

Oct 23, 2026 · @Chris

## How to use this brief

This brief has two parts: a short kickoff prompt you paste into Claude Code, and a spec it works from.

1. Create an empty folder and open Claude Code in it.
2. Export this doc as Markdown and save it in that folder as `SPEC.md`.
3. Unzip the design references into the same folder, so the images and their notes sit in `design/references/`.
4. Paste the kickoff prompt below into Claude Code and leave it to run.

Everything from "Product overview" onwards is the spec. Claude Code is told to treat it as the source of truth and to log any deviation in `DECISIONS.md`.

## Kickoff prompt

Paste this into Claude Code as a single message.

```
You are building a desktop web app for practising guitar along to recorded tracks: precise looping, slowed playback and pitch shifting. The full specification is in SPEC.md in this folder. Read all of it before writing any code. SPEC.md is the source of truth.

You will work unattended until the first pass is complete. Nobody will answer questions, so do not stop to ask. When something is ambiguous, choose the option that best serves the spec's stated priorities (accuracy first, then restraint in the UI), record the choice in DECISIONS.md, and carry on.

How to work:

1. Initialise a git repository. Write PLAN.md: break each phase in SPEC.md's "Build phases" section into concrete tasks with checkboxes. Keep PLAN.md up to date as you work; it is your memory across a long session.
2. Work through phases 0 to 7 in order. Do not start a phase until the previous one meets its acceptance criteria.
3. At the end of every phase, run the full verification protocol from SPEC.md (typecheck, lint, unit tests, Playwright tests, screenshot review). Fix failures before moving on. Commit with a message naming the phase.
4. Before depending on any third-party library, verify it exists, check its current API and licence, and build a minimal proof that it works in an AudioWorklet or Web Worker as needed. If it does not work, use the listed fallback and record why in DECISIONS.md.
5. If you are stuck on the same problem after three genuinely different attempts, record the problem, what you tried and your best hypothesis in DECISIONS.md under "Open issues", make the smallest safe workaround, and move on.
6. Do NOT implement stem separation (SPEC.md phase 8). Do build the architecture seams it describes, so it can be added later without restructuring.
7. The visual design section is as important as the features. Reference images are in design/references/, and its README.md says what to take from each and what to ignore. Look at them before building any UI. Where an image and SPEC.md disagree, SPEC.md wins. Follow its rules exactly, including the "Do not" list. Review your own screenshots against it critically, as a demanding designer would, at the end of every phase that touches the UI.

When phases 0 to 7 are done, write README.md with: how to install and run the app, a summary of what was built, a feature checklist against SPEC.md marked done or partial, known issues, and suggested next steps. Then stop.
```

## Product overview

The app lets one guitarist open a track, loop a section with sample-accurate precision, slow it down without changing pitch, and shift its pitch in cents. The existing tool it replaces does all of this, but imprecisely. **Accuracy is the reason this app exists**: when a choice trades accuracy against convenience, choose accuracy.

**Context**

- **User:** a single private user on an Apple M1 MacBook Pro, using the latest Chromium (Dia). It must also work in the latest Safari and Firefox.
- **Platform:** desktop only, no mobile or touch layouts. Minimum window size 1280×800.
- **Hosting:** fully client-side. No server, no accounts, no analytics, no network requests after load, except a future one-off model download for stems.
- **Working name:** `Looper`. Keep the name in one constant so it can be changed.

**In scope for this run (phases 0–7)**

- Open an audio file by drag-and-drop or file picker (MP3, WAV, AIFF, FLAC, M4A/AAC: whatever the browser decodes)
- Accurate waveform with zoom and pan down to individual samples
- Precise loop editing, with a loop on/off toggle that keeps the region
- Speed in fixed steps, with pitch preserved
- Pitch shift in cents, independent of speed
- An optional one-bar count-in at the track's detected tempo
- A live, audio-reactive gradient visualiser
- A Recent tracks list (3 tracks) that restores audio and all settings
- Keyboard shortcuts for every frequent action

**Out of scope for this run**

- Stem separation: specified in phase 8 for later, but build its architecture seams now
- Volume, balance and tune controls (the system volume is enough)
- Exporting or saving processed audio
- A speed trainer, beat-grid snapping, tap tempo and chord detection
- Light mode, mobile, touch and accessibility beyond keyboard operation and visible focus

## Stack and architecture

All audio runs in one AudioWorklet that owns the sources, the mixer, the loop and the stretcher. The UI only sends commands and reads position.

**Stack**

- **Framework:** SvelteKit with Svelte 5 (runes), `adapter-static`, SPA mode (`ssr = false`).
- **Language:** TypeScript in strict mode, including worklets and workers. No `any` without a comment explaining why.
- **Styling:** plain modern CSS: custom properties, native nesting, `:has()`, container queries, cascade layers. No Tailwind, no CSS-in-JS, no UI component library.
- **Fonts:** system fonts. Bundle Geist Mono locally (npm `geist` or `@fontsource/geist-mono`) as the mono fallback. Load nothing from a CDN.
- **Tooling:** Vite, Vitest for unit tests, Playwright (Chromium, WebKit and Firefox) for end-to-end tests, ESLint and Prettier.
- **Icons:** inline SVG components, 16px, 1.5px stroke, `currentColor`. At most about 8 icons in the whole app.

**Signal flow**

```
sources[] ──► mixer (per-source gain, crossfade on change) ──► loop/position reader ──► stretcher ──► output ──► AnalyserNode(s) ──► destination
(phase 1: one source, "mix")                                    (wraps loopEnd → loopStart)   (speed + pitch)          (visualiser tap)
```

**Audio engine design**

- **Decode** with `decodeAudioData` into planar Float32 per channel. Mono files are treated as stereo.
- **Positions are integer source frames everywhere:** loop points, playhead and seek targets. Convert to seconds only for display.
- **Sources:** the engine holds a list of `AudioSource { id, kind: 'mix' | 'stem', label, channels, gain, muted, soloed }`. Phase 1 has exactly one source, kind `mix`. The mixer must already handle N sources and must crossfade (about 20 ms, equal-power) when the active set changes. Transfer channel data to the worklet with transferable `ArrayBuffer`s. Do not depend on `SharedArrayBuffer`, which needs cross-origin isolation.
- **One custom worklet processor (`player.worklet.ts`)** reads mixed source frames at the read position, feeds them to the stretcher, and writes the stretcher's output.
- **Looping:**
  - When looping is on and the read position reaches `loopEnd`, reading continues from `loopStart`.
  - An equal-power crossfade blends the frames just past `loopEnd` with the frames at `loopStart`. It is 5 ms by default and runs in the source domain, before the stretcher, so the stretcher sees continuous input and there is no click.
  - The wrap is sample-exact in source frames.
- **Stretcher behind an interface:** `Stretcher { setRate(rate), setPitchCents(cents), process(input, inputFrames, output, outputFrames), latencyFrames(), reset() }`. Use them in this order:
  1. **Signalsmith Stretch** (MIT, WASM). Verify the npm package and its API. Prefer using its core inside our own processor so we control the input. If its bundled node already supports exact loop points and a live input, record in DECISIONS.md whether that is used instead.
  2. **Rubber Band** compiled to WASM (GPL is acceptable: this is private).
  3. **SoundTouch** (`soundtouchjs`) as a last resort.
- **Position reporting:** the worklet posts `{ contextTime, sourceFrame }` about 30 times a second. `sourceFrame` is the frame currently _audible_, compensated for stretcher latency and `outputLatency`. The main thread interpolates between reports with `audioContext.currentTime` on `requestAnimationFrame`. **The playhead shows what you hear, not what is being read.**
- **Parameter changes** (rate, pitch, loop points, loop on/off, seek) are messages to the worklet, applied at the next render quantum. Changing speed never changes pitch, and changing pitch never changes speed.
- **Analysis runs in Web Workers:**
  - Multi-resolution peaks: min/max per bucket at 32, 64, 128 … frames per bucket, up to the level where one bucket is under 1 px at fit-to-width.
  - Onset detection (spectral flux) for snapping.
  - Peaks are cached in storage alongside the track.
- **Separation seam:** define `Separator { separate(file, model, onProgress, signal): Promise<StemSet> }` and `StemSet` types now, plus a `NullSeparator`. Nothing calls it in this run.

**Module layout**

```
src/lib/
  audio/       engine.ts, sources.ts, player.worklet.ts, stretcher/, crossfade.ts
  analysis/    peaks.worker.ts, onsets.worker.ts, zero-crossing.ts
  separation/  types.ts, null-separator.ts        (interfaces only in this run)
  storage/     opfs.worker.ts, track-store.ts, settings-schema.ts, hash.ts
  state/       *.svelte.ts runes classes (track, loop, transport, view)
  ui/          components, tokens.css, icons/
  viz/         gradient.ts (WebGL2), shaders/
```

**State rules**

- Engine and audio state live in plain TypeScript classes. Svelte runes wrap them for the UI.
- The playhead, the visualiser and waveform redraws are driven by `requestAnimationFrame` on canvas, **never by reactive state updates**.
- Persisted settings use a versioned schema (`version: 1`) with a migration hook.

## Features and acceptance criteria

Each feature lists what to build, then **Done when**: the testable conditions that must hold before the phase can close.

### Opening a track

- **Drag-and-drop:** drop a file anywhere in the window. A thin white outline round the waveform area is the drop target. No overlay text beyond a single word: `Drop`.
- **File picker:** `Open` in the top bar, or ⌘O.
- **Empty state:** the waveform area shows one line of secondary text, `Drop a track or press ⌘O`, and nothing else.
- **Playback is available immediately after decode.** Peaks and onsets compute in the background, and the waveform draws progressively as levels arrive.
- **Unsupported files** show one line of error text in the waveform area. No modal.

**Done when:** a 5-minute MP3 is playable in under 1.5 s on an M1, and the main thread never blocks for more than 50 ms during load. Measure this with a Playwright performance trace.

### Waveform, zoom and pan

- **True peaks:** draw min/max per pixel column as 1 px vertical lines. No decorative bars, gaps or rounded caps. The waveform shows the truth.
- **Sample detail:** below 1 frame per pixel, draw a 1 px polyline through the samples. Above 6 px per sample, add 2 px square dots on each sample.
- **Crisp rendering:** canvas is `devicePixelRatio`-aware and lines align to the device pixel grid.
- **Zoom** with ⌘ + scroll or pinch, anchored at the cursor. Use `= / -` keys, `0` to fit the track, and `Z` to zoom to the loop with 5% padding either side. The range runs from fit-to-width to at least 16 px per sample.
- **Pan** with horizontal scroll or a trackpad swipe, or by dragging the overview strip.
- **Overview strip:** a 24 px strip under the ruler shows the whole track, the loop region and the visible window as a white 1 px rectangle. Click or drag it to move the view.
- **Ruler:** above the waveform, with mono time labels. Tick spacing adapts to zoom: minutes and seconds down to milliseconds, and sample numbers at the deepest zoom.
- **Follow playhead:** while playing, the view keeps the playhead in view by paging, not by smooth scrolling. Any manual pan disables following until the next play, or until `F` is pressed.

**Done when:**

- A unit test shows the peaks at every level equal a brute-force min/max.
- At max zoom, a Playwright screenshot of a 440 Hz sine fixture shows individual sample dots.
- Zooming from fit to max holds 60 fps on a 5-minute track (measured with a trace).

### Loop editing (the core of the app)

- **Creating a loop:**
  - Drag across the waveform to create one.
  - Or press `I` / `O` to set in or out at the playhead.
  - There is one loop region per track.
- **Editing edges:**
  - Drag a loop edge to move it, with a `col-resize` cursor and an 8 px hit zone.
  - Drag inside the loop band to move the whole loop, keeping its length.
  - Click outside the loop to seek. Clicking on the waveform never moves the loop.
- **Snapping** (on by default, with Alt held to bypass while dragging):
  1. **Onsets:** to a detected onset within 8 px.
  2. **Zero crossings:** otherwise, to the nearest zero crossing of the mono sum within ±2 ms.
- **Nudging:** select an edge with `[` (in) or `]` (out), or by clicking it. The selected edge is drawn 2 px white.
  - `←` / `→` move it 1 ms.
  - With Shift: 10 ms.
  - With Alt: 1 sample, which bypasses snapping.
- **Typed times:**
  - `In`, `Out` and `Length` are shown as editable mono fields in `m:ss.mmm`. Click to type, then Enter to commit or Esc to cancel.
  - Typing a Length moves Out.
  - Typed values are exact to the millisecond and then snap (unless typed with Alt+Enter).
- **Loop toggle:**
  - `L` or the loop control turns looping on and off.
  - Turning it off keeps the region. It is drawn as outline only, with the waveform inside no longer highlighted.
  - Turning it on while the playhead is outside the region does not jump. The loop engages when playback next enters the region, or press `Enter` to jump to the loop start.
- **Live edits:** editing a loop while playing takes effect at the next wrap. If the new loop end is behind the playhead, the playhead wraps immediately.
- **Storage:** loop points are stored as integer frames.

**Done when:**

- **Wrap accuracy, rate 1.0 and pitch 0:** with a click-track fixture rendered through the real worklet in an `OfflineAudioContext`, every cycle's wrap lands within ±1 frame of the expected position.
- **Wrap accuracy, other speeds:** at rates 0.5 and 0.75, cycle length equals `loopLength / rate` within ±1 ms.
- **No clicks:** at every wrap, no sample-to-sample jump exceeds the fixture's maximum natural slope by more than 10%.
- **Round trips:** typed `m:ss.mmm` values convert to frames and back without loss, at 44.1 and 48 kHz.
- **Zero crossings:** unit tests cover silence, DC offset and a pure sine.

### Speed

- **Control:** a horizontal stepped slider from 25–150%, with detents at the presets 50, 60, 70, 75, 80, 90 and 100%. Dragging snaps to a detent within 6 px (Alt bypasses); between detents it moves in 1% steps. Clicking a detent label jumps to it.
- **Exact value:** the value beside the slider can be typed into or scrubbed, in 1% steps.
- **Keys:** `,` / `.` step down or up through the presets. With Shift, they change speed by 1%.
- **Pitch is preserved** at every speed.

**Done when:** a 1 kHz sine fixture played at 50% still measures 1 kHz ±1 cent, using an FFT on the offline render.

### Pitch

- **Range:** −1200 to +1200 cents, shown signed in mono (`−100 ct`).
- **Control:** a bipolar knob with a centre detent at 0, plus the exact value beside it, which can be typed into. Drag, scroll or arrow keys change it by 1 cent, or by 10 with Shift. Double-click the knob to reset to 0.
- **Quick values:** a row of `0  −25  −50  −100  −200`. In a footnote-sized hint, `−100` is labelled `E♭` and `−200` is labelled `D`, the common guitar tunings.
- **Speed is unaffected:** changing pitch never changes speed or position.

**Done when:** a 440 Hz fixture at −100 ct measures 415.3 Hz ±1 cent, at both 100% and 50% speed.

### Count-in

- **Toggle:** `Count-in` in the transport, or `C`. It's off by default and saved per track.
- **What it does:** when on, starting playback (Space from paused, or Enter) plays one bar of four clicks, then the audio starts exactly on the next beat. It counts in only when playback starts, not on every loop wrap.
- **Tempo:** the clicks run at the track tempo × the current speed. At 50% speed, a 120 BPM track counts in at 60 BPM.
- **Clicks:** short synthesised blips (about 30 ms) at about −12 dBFS. Beat 1 is higher (1.5 kHz) than beats 2–4 (1 kHz). They're mixed in after the stretcher, so they're never time-stretched.
- **Beat indicator:** while counting in, the accent dot beside `Count-in` flashes on each beat (instant on, instant off).
- **Timing:** schedule the clicks and the audio start against the audio clock inside the worklet, never with timers.
- **Tempo detection:** detect the track's BPM in a worker after load, folding the result into 70–180 BPM by doubling or halving. Use these in order:
  1. **essentia.js** `RhythmExtractor2013` (AGPL is acceptable: this is private). Verify it runs in a worker.
  2. **web-audio-beat-detector** as the fallback.
- **Tempo value:** shown in the transport as a mono value with one decimal place (`120.0`). It can be typed into or scrubbed in 0.1 steps. A typed value overrides detection and is saved. Until a tempo is known, the value shows `—` and Count-in is unavailable.
- **Not in this run:** aligning the count-in to the song's beat grid. The count-in sets the tempo, not the phase.

**Done when:**

- The 120 BPM click fixture is detected as 120.0 ±0.5 BPM.
- In an offline render at speeds 1.0 and 0.5, clicks are 60 / (BPM × speed) seconds apart ±1 ms, and the first audio frame lands one beat after the fourth click, ±1 ms.

### Visualiser

The visualiser is a WebGL2 audio-reactive mesh gradient. Its visual behaviour is in the Visual design section. Technically:

- **Input:** it reads one `AnalyserNode` (FFT size 2048) after the stretcher, so it reacts to what you hear.
- **Features:** low (20–250 Hz), mid (250 Hz–2 kHz) and high (2–12 kHz) energy, plus RMS, each smoothed with attack around 40 ms and release around 300 ms.
- **Performance:**
  - Render at 0.5× device resolution and upscale.
  - Cap at 60 fps.
  - Stop rendering when the tab is hidden, and drop to about 10 fps when paused.
- **Fallback:** if WebGL2 is unavailable, show a static frame of the gradient.

### Recent tracks and persistence

- **What's stored:** each track is stored in OPFS under the SHA-256 of its file bytes: the original file, cached peaks, cached onsets and `settings.json` (loop, loop on/off, speed, pitch, count-in, tempo override, last position, zoom and scroll).
- **Write path:** all OPFS writes go through a Web Worker using `createSyncAccessHandle`, for Safari compatibility.
- **List size:** the list holds the 3 most recently opened tracks. Opening a fourth evicts the oldest, including all its stored data.
- **Recognition:** dropping a file already in the list restores it, matched by content rather than name.
- **Saving:** settings save debounced (500 ms) and on `pagehide`.
- **On launch:** the most recent track reopens, paused at its last position.

**Done when:** a Playwright test opens 4 tracks, reloads, and confirms 3 remain with their settings restored, and the evicted track's directory is gone.

### Keyboard shortcuts

Shortcuts are suspended while a text field has focus. `?` shows a minimal overlay listing them (mono, two columns, Esc to close).

| Key               | Action                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Space             | Play / pause                                                                                      |
| Enter             | Jump to loop start (or track start if no loop)                                                    |
| L                 | Loop on / off                                                                                     |
| I / O             | Set loop in / out at playhead                                                                     |
| \[ / \]           | Select loop in / out edge                                                                         |
| ← / →             | Nudge selected edge 1 ms (Shift 10 ms, Alt 1 sample); with no edge selected, seek 1 s (Shift 5 s) |
| , / .             | Speed preset down / up (Shift: ±1%)                                                               |
| Esc               | Deselect edge, close overlay                                                                      |
| ⌘ + scroll, = / - | Zoom                                                                                              |
| 0                 | Zoom to fit                                                                                       |
| Z                 | Zoom to loop                                                                                      |
| F                 | Follow playhead                                                                                   |
| ⌘O                | Open track                                                                                        |
| ?                 | Shortcuts overlay                                                                                 |
| C                 | Count-in on / off                                                                                 |

## Visual design

The app should look like a precision instrument: dark, technical and restrained. It's closer to Teenage Engineering than GarageBand. It lives or dies on typography, alignment and whitespace, not on colour or decoration.

### Character

What the reference images share, and what to take from them:

- **Near-black surfaces separated by hairlines, not boxes.** Panels are defined by 1 px lines and spacing.
- **Graphics drawn with sharp, thin strokes:** waveforms as crisp vertical lines, rings of radial tick marks, schematic line drawings.
- **Real audio controls, drawn flat.** Knobs, sliders, values and the odd button, each chosen because it suits the parameter. Every knob and slider also has an exact value you can type into.
- **Parameters as a small grey label with a larger white value** (`Start 17`, `Cutoff 6.4k`). Inputs never look like web form fields.
- **Colour comes only from an asset** (a soft, grainy, audio-reactive gradient) **or one small accent.** White marks the active or selected state.
- **Hierarchy from opacity steps of white**, not from extra colours.
- **Tight, software-like density** with deliberate empty space. It's a tool, not a marketing page.

### Reference images

The images are supplied in `design/references/`, with a `README.md` saying what to take from each and what to ignore. **This spec takes priority over the images.** Where they disagree (light themes, rounded cards, other accent colours), follow the spec.

- **Closest to the target:** `07-instrument-modules.png`. Its label-over-value parameters, line-drawn module graphics, crisp waveforms, `M` / `S` text toggles and small accent dots are the language to follow, but with hairline dividers instead of its rounded cards.
- **The visualiser:** `01` and `02` show the grainy mesh-gradient look.
- **Knobs and dials:** `03`, `04`, `05` and `08` show flat knobs and rings of fine radial ticks with only the active ticks lit.
- **Technical layout and drawing language:** `06` and `09` show the grid, hairlines, mono annotations and opacity steps.
- **Waveform and playhead:** `10` shows vertical-line waveforms and a playhead with a dot head.
- **Features only:** `00` is the app being replaced. Take nothing from its look.

### Layout

The app fills the viewport with no page scroll. It has three horizontal bands: top bar, waveform area and control deck. Everything sits on a 4 px grid, with a 16 px outer gutter shared by every band, so left edges line up from top to bottom.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Looper     Tokenise The Pain  4:47 ▾                                           Open    ? │  top bar · 40 px
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ 0:00          0:30          1:00          1:30          2:00          2:30         3:00  │  ruler · 20 px
│ ░░░░░░░░[██]░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  overview · 24 px
│                                                                                          │
│               ┊█████████████┊                                                            │
│   ▁▂▃▅▆▇▆▅▃▂ ┊█████████████┊ ▂▃▅▆▇█▇▆▅▃▂▁▂▃▅▆▇▆▅▃▂▁▂▃▅▆▇▇▆▅▃▂▁▂▃▅▆▇▆▅▃▂                 │  main waveform · fills remaining height
│               ┊█████████████┊                                                            │  (loop region: waveform white, band 4% white)
│               ┊  │ playhead ┊                                                            │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ (phase 8: stem lanes, 40 px each, collapsible — nothing rendered in this run)            │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  ( ▶ )   1:23.456 │ ● Loop   Snap      │ Speed      80% │ Pitch           │░░░░░░░░░░░░░│
│          / 4:47   │ In        Out      │ ──────┼──────  │  ╱╲  −100 ct    │░ visualiser░│  control deck · 176 px
│                   │ 0:42.118  0:51.902 │ 50 60 70 75 80 │ (knob)          │░░░░░░░░░░░░░│
│ ● Count-in  120.0 │ Length 0:09.784    │ 90 100         │ 0 −25 −50 −100  │░░░░░░░░░░░░░│
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar (40 px)**, left to right:
  - **App name** in 13 px, weight 500, muted.
  - **Track title** in 13 px primary, then the duration in mono 11 px subtle, then a 12 px chevron. Clicking any of these opens Recent tracks.
  - **Right-aligned:** `Open`, then `?`.
  - No logo mark and no other items.
- **Waveform area (fills the remaining height):**
  - Ruler (20 px), then the overview strip (24 px), then the main waveform.
  - It's the deepest surface (`--bg-sunken`) and runs edge to edge, with no horizontal padding. The waveform touches the window edges.
- **Control deck (176 px):** five modules in a row, separated by full-height 1 px vertical hairlines. Each module has 16 px padding, so the deck reads as one instrument panel, not five cards.
  - **Transport (240 px):**
    - The 40 px play/pause circle, with the position readout in mono 28 px beside it and `/ 4:47.000` in mono 11 px subtle under the readout.
    - **Bottom row:** `Count-in` as a text toggle with its state dot, then the tempo as a typeable mono value (`120.0`, with `BPM` in 11 px subtle after it).
  - **Loop (flexible, minimum 320 px):**
    - **Header row:** the loop state dot and `Loop`, then `Snap`.
    - **Fields:** `In` and `Out` as label-over-value pairs, with `Length` below.
  - **Speed (flexible):**
    - **Header row:** the `Speed` label, with the exact value (`80%`) right-aligned in mono 15 px. The value is typeable.
    - **Slider:** a horizontal stepped slider across the module, with preset detents labelled under it in mono 11 px.
  - **Pitch (flexible):**
    - **Knob:** a 56 px bipolar knob with a ring of radial ticks, and the exact value (`−100 ct`) beside it in mono 15 px. The value is typeable.
    - **Quick values:** a row of `0  −25  −50  −100  −200`, with the `E♭` and `D` hints in 11 px subtle under their values.
  - **Visualiser (fixed 280 px wide, full deck height):** the canvas fills the cell edge to edge, with no padding, label, border or radius.

### Typography

Only two families, four sizes and two weights. Hierarchy comes from size, colour and position, never from extra weights.

| Token     | Size / line height | Family | Weight     | Used for                                                  |
| --------- | ------------------ | ------ | ---------- | --------------------------------------------------------- |
| `--fs-xs` | 11 / 14 px         | Mono   | 400        | Ruler labels, durations, hints, detent labels, file sizes |
| `--fs-sm` | 13 / 16 px         | Sans   | 400 or 500 | Labels, menu items, text buttons, track title             |
| `--fs-md` | 15 / 20 px         | Mono   | 400        | Parameter values (In, Out, Speed, Pitch, tempo)           |
| `--fs-lg` | 28 / 32 px         | Mono   | 400        | Position readout only                                     |

- **Sans:** `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` (SF Pro on macOS).
- **Mono:** `ui-monospace, "Geist Mono", monospace`, with Geist Mono bundled locally. Chromium doesn't support `ui-monospace`, so it will render Geist Mono; Safari will use SF Mono. That's acceptable.
- **Numbers:** all values use `font-variant-numeric: tabular-nums slashed-zero` so digits never jitter.
- **Signs:** use the real minus sign (−) for negative values, not a hyphen.
- **Mono is for data only:** values, times, ruler, detent labels, status and the shortcut overlay. Labels and names are always sans.
- **Labels are sentence case, one or two words:** `In`, `Out`, `Length`, `Speed`, `Pitch`, `Loop`, `Count-in`, `Open`. No all-caps, no letter-spaced eyebrow labels, no helper sentences. Where a value's meaning is obvious from its position, it has no label at all.
- **Text colours:** `--fg-primary`, `--fg-muted` and `--fg-subtle` only. The accent never colours text. Error text is primary, with a 6 px accent dot before it.

### Colour tokens

Dark only for now, but structured so a light mode can be added later by remapping one layer. Tokens have two tiers, both defined in `tokens.css`:

- **Primitives** hold every unique colour value (including colour plus alpha) and say nothing about use.
- **Semantic tokens** describe use and point at primitives.
- **Components use semantic tokens only.** A lint rule or test must fail if a component references a primitive or a raw colour value.
- **Light mode later** becomes a second set of semantic mappings under `:root[data-theme="light"]`. Don't build it in this run.

**Primitives**

| Token               | Value                     | Note                         |
| ------------------- | ------------------------- | ---------------------------- |
| `--neutral-950`     | `#080808`                 | Deepest surface              |
| `--neutral-925`     | `#0E0E0E`                 | Base surface                 |
| `--neutral-910`     | `#121212`                 | Raised panels                |
| `--neutral-900`     | `#161616`                 | Hover surface                |
| `--neutral-875`     | `#1C1C1C`                 | Hairlines                    |
| `--neutral-850`     | `#2A2A2A`                 | Strong lines, control tracks |
| `--neutral-700`     | `#3A3A3A`                 | Inactive waveform            |
| `--neutral-600`     | `#525252`                 | Subtle text                  |
| `--neutral-450`     | `#8A8A8A`                 | Muted text                   |
| `--neutral-100`     | `#EDEDED`                 | Primary white                |
| `--neutral-100-a04` | `rgb(237 237 237 / 0.04)` | Loop band                    |
| `--neutral-100-a06` | `rgb(237 237 237 / 0.06)` | Control hover wash           |
| `--red-500`         | `#FF3B30`                 | The accent                   |
| `--ember-900`       | `#1C0503`                 | Visualiser                   |
| `--ember-700`       | `#8C120C`                 | Visualiser                   |
| `--ember-200`       | `#FF9E85`                 | Visualiser                   |

**Semantic tokens**

| Token                    | Maps to                                                  | Used for                                     |
| ------------------------ | -------------------------------------------------------- | -------------------------------------------- |
| `--bg-sunken`            | `--neutral-950`                                          | Waveform area                                |
| `--bg-default`           | `--neutral-925`                                          | App background, top bar, control deck        |
| `--bg-raised`            | `--neutral-910`                                          | Dropdown and overlay panels                  |
| `--bg-interactive-hover` | `--neutral-900`                                          | Row hover in Recent tracks                   |
| `--control-bg`           | `--neutral-875`                                          | Knob body                                    |
| `--control-bg-hover`     | `--neutral-100-a06`                                      | Hover wash on knobs and slider area          |
| `--control-track`        | `--neutral-850`                                          | Slider track, unlit knob ticks               |
| `--control-fill`         | `--neutral-100`                                          | Slider handle, knob indicator, lit ticks     |
| `--border-subtle`        | `--neutral-875`                                          | Hairlines, the waveform centre line          |
| `--border-strong`        | `--neutral-850`                                          | Ruler ticks, panel borders                   |
| `--border-focus`         | `--neutral-100`                                          | Focus outline                                |
| `--fg-primary`           | `--neutral-100`                                          | Primary text, active and selected states     |
| `--fg-muted`             | `--neutral-450`                                          | Labels, secondary text, hover on subtle      |
| `--fg-subtle`            | `--neutral-600`                                          | Inactive options, hints, ruler labels        |
| `--fg-on-primary`        | `--neutral-925`                                          | Icon on the play button                      |
| `--wave-default`         | `--neutral-700`                                          | Waveform outside the loop, overview waveform |
| `--wave-active`          | `--neutral-100`                                          | Waveform inside an enabled loop              |
| `--loop-band`            | `--neutral-100-a04`                                      | Loop band fill when loop is on               |
| `--loop-edge`            | `--neutral-100`                                          | Loop edges                                   |
| `--accent`               | `--red-500`                                              | Playhead, state dots, error dot              |
| `--viz-1` … `--viz-4`    | `--ember-900`, `--ember-700`, `--red-500`, `--ember-200` | Visualiser gradient only                     |

**Rules:**

- **White means active or selected.** That covers the active preset, the selected loop edge, the waveform inside an enabled loop, lit knob ticks and the overview viewport. The accent is never used for selection.
- **The accent is red and is used sparingly:** the playhead, the on-state dots for Loop and Count-in, the count-in beat indicator and the error dot. No more than three or four accent marks on screen at once.
- **No other hues**, and specifically no purple or blue.

### Spacing, lines and shape

- **Spacing scale:** 4, 8, 12, 16, 24, 32 px (`--s1` to `--s6`).
  - 8 px between a label and its value.
  - 12 px between items in a row.
  - 16 px of module padding.
- **Lines:** all lines and strokes are 1 px, except a selected loop edge, the slider handle and the knob indicator, which are 2 px.
- **Corners:** radius is 0 everywhere. The only round things are the play button, knobs and status dots.
- **No shadows, blur, glass, gradients or textures** anywhere except inside the visualiser canvas.

### Waveform rendering

- **Colour:** outside the loop, the waveform is `--wave-default`. Inside an enabled loop it is `--wave-active`. When the loop is off, the region shows as two 1 px `--fg-muted` edges, with no band fill and no highlighted waveform.
- **Loop edges:** full height, 1 px `--loop-edge`. The selected edge is 2 px, with an 11 px mono time label at the top inside the region.
- **Playhead:** a 1 px `--accent` line at full height, with a 5 px accent dot on the ruler. It moves in exact steps and is never eased.
- **Zero line:** a 1 px `--border-subtle` centre line. At sample-level zoom, the samples are drawn as described in Features.

### Visualiser look

The visualiser is a soft, grainy mesh gradient: four or five large Gaussian colour fields in the `--viz` palette over near-black, with fine animated film grain at about 4% amplitude.

- **Paused:** a near-still slow drift (one cycle about every 20 s) at about 40% brightness.
- **Playing:**
  - **Low energy** swells the largest, deepest field and raises its brightness.
  - **Mid energy** speeds up and warps the fields' motion.
  - **High energy** raises grain intensity and lifts a small `--viz-4` highlight.
  - **RMS** sets overall exposure.
- **Restraint:** no strobing. Rate-limit brightness changes. With `prefers-reduced-motion`, show a static frame that updates once a second.

### Controls

Choose the control that suits each parameter. Every knob and slider is paired with its exact value, which can be typed into.

- **Knob** (Pitch):
  - **Drawing:** a 56 px flat circle in `--control-bg`, with a 2 px `--control-fill` indicator line from 30% to 85% of the radius. No bevel, gradient, shadow or highlight.
  - **Tick ring:** around it, 4 px outside the body, sit 25 radial ticks (1 px × 4 px) across a 270° sweep. Ticks between the zero point and the current value are `--control-fill`; the rest are `--control-track`. A bipolar knob lights ticks from the centre outwards.
  - **Interaction:** drag vertically (4 px per step, Shift for 10× steps), scroll, or use the arrow keys when focused. Double-click resets to the default. Hover shows a `--control-bg-hover` wash on the body.
  - **Detent:** a centre detent at 0 holds the value within 6 px of drag, unless Alt is held.
- **Stepped slider** (Speed):
  - **Drawing:** a 1 px `--control-track` line across the module. The handle is a 2 px × 16 px vertical `--control-fill` line, like a playhead. There is no thumb blob and no filled range.
  - **Detents:** 1 px × 4 px ticks under the track at each preset, with mono 11 px labels. The active preset's label is `--fg-primary`; the others are `--fg-subtle`, and hover is `--fg-muted`. Clicking a label jumps to it.
  - **Interaction:** dragging snaps to a detent within 6 px (Alt bypasses). Between detents it moves in 1% steps. Arrow keys when focused move 1%.
- **Values** (In, Out, Length, Speed, Pitch, tempo):
  - No box and no border. Where the meaning is obvious from position, no label either.
  - **Hover:** the value turns `--fg-primary` and the cursor becomes `ns-resize`.
  - **Scrubbing:** drag vertically or scroll to change it.
  - **Typing:** a click without dragging turns the value into an inline input with identical metrics and a 1 px `--fg-primary` underline. Enter commits; Esc cancels.
- **Text toggles** (`Loop`, `Snap`, `Count-in`) and **text buttons** (`Open`, `?`) have no background and no border.
  - At rest: `--fg-muted`. Hover: `--fg-primary`.
  - Where on/off state matters, a 6 px dot sits before the label: `--accent` for Loop and Count-in, `--fg-primary` for Snap. When off, the dot is a 1 px `--fg-subtle` ring.
- **Play/pause** is the one filled control: a 40 px `--fg-primary` circle with a 14 px `--fg-on-primary` icon. Hover is 90% opacity. When no track is loaded, it is `--fg-subtle`.
- **Quick-value and preset rows** are plain mono numbers 12 px apart. Active is `--fg-primary`, inactive `--fg-subtle`, and hover `--fg-muted`. No pills, chips or backgrounds.
- **The Recent tracks dropdown** is a panel directly under the title: `--bg-raised`, 1 px `--border-strong` border, square, 320 px wide.
  - **Rows:** 32 px each, with the name in sans 13 px on the left and the duration and size in mono 11 px subtle on the right.
  - **Hover:** `--bg-interactive-hover`, and a `×` appears to remove the track.
  - **States:** the current track's name is `--fg-primary`; the others are `--fg-muted`.
- **Shortcuts overlay** (`?`): a centred panel styled like the dropdown, with two mono columns, no title and no close button. Esc or a click outside closes it.
- **Focus:** `:focus-visible` shows a 1 px `--border-focus` outline with a 2 px offset. Never remove focus styles.
- **Empty state:**
  - The deck is fully laid out, with values shown as `—` in `--fg-subtle` and controls at their defaults.
  - The waveform area shows its single line of text.
  - The visualiser shows its paused drift.

### Motion

Motion should feel responsive and polished. The size of a transition matches the size of the change. Define these as tokens (`--dur-instant`, `--dur-fast`, `--dur-base`, `--dur-slow`) with one easing curve, `--ease-out: cubic-bezier(0.2, 0, 0, 1)`.

| Tier    | Duration         | Applies to                                                                                                            |
| ------- | ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| Instant | 0 ms             | Play/pause icon swap, toggle state, playhead, values while scrubbing, knob and slider positions, zoom and pan         |
| Fast    | 200 ms, ease-out | Hover and focus colour changes, preset and quick-value state                                                          |
| Base    | 300 ms, ease-out | Dropdown and overlay fade in and out                                                                                  |
| Slow    | 600 ms, ease-out | Large changes: the waveform fading in after load, deck values appearing on first load, stem lanes appearing (phase 8) |

- **What animates:** opacity and colour only. No movement, scaling or lifting on hover. Panels fade without sliding.
- **Direct manipulation is never eased.** Waveform, zoom, pan, playhead, knobs and sliders follow input 1:1. Follow-playhead pages instantly.
- **The visualiser is the only continuous animation.**
- **Reduced motion:** with `prefers-reduced-motion`, the Slow and Base tiers drop to 0 ms.

### Do not

- Do not put things in cards or containers with drop shadows. Separate with space and hairlines.
- Do not use AI-style UI tells:
  - eyebrow labels above headings
  - taglines or helper sentences where a one-word label will do
  - "Welcome" text, emoji, gradient text
  - soft purple or blue accents
- Do not give every control the same treatment. Choose per parameter: a slider for a range with presets, a knob for a bipolar value, plain values for times, text toggles for on/off, and a button only where an action needs one. Avoid rows of same-weight buttons.
- Do not draw skeuomorphic controls: no bevels, metal, gradients, shadows or highlights on knobs and sliders. They are flat line drawings.
- Do not make inputs look like web form fields: no boxes, borders or backgrounds on values.
- Do not lay it out like a web page: no hero, no centred max-width column, no footer, no section headings.
- Do not use icons decoratively or beside text labels. Icons are only for play, pause, the chevron, remove (×) and the drop target, kept small and plain.
- Do not use rounded corners, pills or toggle switches.
- Do not use toasts, modals (other than the shortcuts overlay), custom tooltips or skeleton loaders. Fade the waveform in instead.
- Do not use colours, sizes, weights, durations or spacing values outside the tokens above, or reference a primitive token from a component.
- Do not use the accent for selection, or to colour text.

## Stem separation (phase 8, not this run)

When a track is opened, the app separates it into stems in the background, in the browser, and shows them as mutable, soloable lanes under the main waveform. **In this run, build only the seams listed at the end of this section.**

### Behaviour

- **Starting:** separation starts automatically when a track is opened and has no stored stems. Playback is never blocked; the original mix plays until stems are ready.
- **One job at a time:**
  - Opening a different track cancels the running job and starts one for the new track.
  - A cancelled or stopped track shows `Separate` in the top bar to start again.
- **Status:** shown in the top bar, after the track title, in mono 11 px: an accent dot, then `Stems 42%`, then a `Stop` text button. When finished, the status disappears and the lanes appear without interrupting playback. On failure it shows `Stems failed` and `Retry`.
- **Model:**
  - **Default:** HTDemucs 6-stem (`htdemucs_6s`): drums, bass, vocals, guitar, piano, other.
  - **Option:** in the Recent tracks row menu, `Re-separate (fine)` runs the fine-tuned 4-stem model (`htdemucs_ft`) and replaces the stems.
  - **Download:** the model downloads on first use (about 80 MB) and is cached.
- **Empty stems:** a stem whose overall RMS is below −50 dBFS gets no lane.

### Lanes

- **Placement:** lanes sit between the main waveform and the control deck. Each is 40 px high, separated by 1 px `--border-subtle`. A `Stems` text toggle in the top bar collapses or expands them. They fade in on the Slow motion tier when separation finishes.
- **Left gutter (96 px):** the stem name (sans 13 px `--fg-muted`), then `M` and `S` as mono 11 px text toggles. Active is `--fg-primary`; inactive is `--fg-subtle`. No buttons or backgrounds.
- **Shared view:** each lane draws its own waveform in `--wave-default`, with the loop region in `--wave-active`. Lanes share the main waveform's zoom, scroll, playhead and loop band, which are drawn as one continuous band through all lanes.
- **Mute and solo** follow DAW rules: if any lane is soloed, only soloed lanes play; otherwise every unmuted lane plays.
- **The main waveform always shows what is audible.** When the active set changes, recompute its peaks from the stem sum in a worker and swap them in when ready.

### Playback

- **Nothing muted or soloed:** the original file plays (source `mix`).
- **Any mute or solo:** the sum of the active stems plays.
- **Switching** between the two happens at the same source frame, with an about 20 ms equal-power crossfade, including mid-loop.
- **Settings are unaffected:** loop, speed, pitch, tempo and count-in never change when the stem selection changes.

### Implementation

- **Runtime options, in order:**
  1. **demucs-rs** (Rust/WASM + WebGPU). It supports `htdemucs`, `htdemucs_6s` and `htdemucs_ft` in the browser. Verify its licence and API first.
  2. **onnxruntime-web on WebGPU** with an HTDemucs ONNX export. This is 4-stem only, so the guitar lane is lost.
- **Without WebGPU:** use the runtime's CPU/WASM path in a worker, with `Stems (slow) 12%`. If no CPU path exists, show `Stems unavailable in this browser` and disable the feature.
- **Keep the UI smooth:** run separation in a dedicated worker. Chunk GPU work so the UI keeps 60 fps; the visualiser may drop to 30 fps while separation runs.
- **Storage:**
  - Store stems in the track's OPFS directory as 16-bit PCM, with their peaks.
  - Stems count towards the 3-track Recent list. Eviction removes them.
  - Expect about 300–350 MB per separated track.

### Seams to build in this run

- [ ] `AudioSource` list and an N-source mixer in the worklet, with gains, mute/solo and crossfaded set changes. Unit-test it with two synthetic sources.
- [ ] `Separator`, `StemSet`, `SeparationJob` (progress, cancel via `AbortSignal`) types and a `NullSeparator`.
- [ ] Waveform view model that supports N lanes sharing one viewport. Render only the main lane now.
- [ ] Track storage layout with a reserved `stems/` directory and a `stems` field (absent) in `settings.json`.

## Build phases and verification

Build the riskiest part first: phase 1 proves the audio engine before any real UI exists. Each phase closes only when its acceptance criteria pass.

### Phases

0. **Setup**
   - Scaffold SvelteKit (static, SPA) with strict TypeScript, ESLint, Prettier, Vitest and Playwright (Chromium, WebKit, Firefox).
   - Add `tokens.css` with every token from Visual design.
   - Write `scripts/make-fixtures.ts`. It generates WAV fixtures at 44.1 and 48 kHz:
     - a 120 BPM click track
     - 440 Hz and 1 kHz sines
     - a log sweep
     - silence
     - a DC-offset sine
     - a 5-minute noise-and-tone "song" for performance tests
   - Add `npm run verify`, which runs everything in the verification protocol.
1. **Audio engine**
   - Decoding, the player worklet, the stretcher (verify the library choice first), the N-source mixer with one source, loop wrap with crossfade, and position reporting with latency compensation.
   - The only UI is a bare debug page (`/debug`) with play, a loop range and speed/pitch inputs.
   - All engine acceptance tests from Features run against the real worklet in an `OfflineAudioContext`.
2. **Waveform:** the peaks worker, canvas renderer, ruler, overview strip, zoom, pan and follow-playhead.
3. **Loop editing:** drag create/move/resize, onset and zero-crossing snapping, nudging, typed fields, the loop toggle and the keyboard shortcuts for loops.
4. **Speed and pitch controls, tempo detection and count-in** in the control deck.
5. **Visualiser:** WebGL2 gradient, analyser features, reduced-motion and fallback.
6. **Persistence:** OPFS worker, hashing, the Recent tracks list (3) with eviction, restore on launch.
7. **Polish**
   - A full pass against Visual design at both screenshot sizes.
   - The shortcuts overlay, and empty and error states.
   - Performance traces against every budget.
   - Cross-browser runs.
   - README.md.
8. **Stem separation:** future work, specified above. Do not start it.

### Verification protocol (run at the end of every phase)

1. **`svelte-check`** with zero errors and zero warnings, then ESLint and Prettier clean.
2. **Vitest:** all unit tests pass. Engine maths (crossfade, zero crossings, peaks, time formatting, count-in timing, mute/solo resolution) each have tests.
3. **Playwright:**
   - **Audio tests** run in Chromium launched with `--autoplay-policy=no-user-gesture-required`.
   - **Smoke tests** in WebKit and Firefox load a fixture, play, set a loop and change speed without console errors.
4. **Screenshots:**
   - Capture the main screen at 1280×800 and 1512×982, empty and with a track loaded, the loop on, and zoomed to sample level. Save them in `screenshots/phase-N/`.
   - Review each one against the Visual design section, including every "Do not". Write the findings and fixes in PLAN.md.
5. **Performance** (phases 2, 3, 5 and 7): Playwright traces confirm three things:
   - **Load:** load-to-playable time under 1.5 s.
   - **Main thread:** no main-thread task over 50 ms during load.
   - **Frame rate:** 60 fps while zooming and while the visualiser runs.
6. **Commit** with the message `phase N: <summary>`.

### Definition of done for this run

- [ ] Phases 0–7 complete, with `npm run verify` passing.
- [ ] A real MP3 can be opened, looped, slowed to 50%, shifted −100 ct, and restored after a reload, with an inaudible loop wrap.
- [ ] The stem-separation seams exist and are tested, with no separation code.
- [ ] README.md, PLAN.md and DECISIONS.md are up to date. Every deviation from this spec is recorded, with its reason.
