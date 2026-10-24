# Looper

A desktop web app for practising guitar along to recorded tracks: sample-accurate looping, slowed playback with pitch preserved, and pitch shifting in cents. Fully client-side; nothing leaves the browser.

SPEC.md is the specification. PLAN.md is the build log (with screenshot reviews per phase); DECISIONS.md records every deviation and judgement call.

## Install and run

Requires Node 24+ and npm.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. For a production build served statically:

```bash
npm run build && npm run preview
```

The build in `build/` is a static SPA (`adapter-static`, `ssr = false`) and can be served from any static host.

### Verification

```bash
npx playwright install chromium webkit firefox
```

```bash
npm run verify
```

`verify` generates the audio fixtures (`static/fixtures/`, ~150 MB, not committed), then runs `svelte-check` (zero errors and warnings), Prettier and ESLint, Vitest, and Playwright: audio and performance tests in Chromium (launched with `--autoplay-policy=no-user-gesture-required`) and smoke tests in WebKit and Firefox. Screenshots for review:

```bash
PHASE=7 npx playwright test screenshots waveform --project=chromium
```

They land in `screenshots/phase-7/` at 1280×800 and 1512×982.

## What was built

- **Audio engine** (`src/lib/audio/`). One AudioWorklet (`player.worklet.ts`) owns the sources, the N-source mixer, the loop reader and the stretcher. The UI only sends commands and reads position.
  - Positions are integer source frames everywhere. The AudioContext runs at the file's native sample rate (sniffed from the header), so decoding never resamples.
  - Loop wrap is sample-exact in the source domain, with a 5 ms correlation-aware equal-power crossfade before the stretcher. Seeks while playing use the same crossfade.
  - Time-stretch uses the Signalsmith Stretch WASM core (MIT) inside our own processor. Pitch is a windowed-sinc resample after the stretch, because Signalsmith's own transpose measured 2–7 cents off on pure tones. At 100 % and 0 ct the output bypasses the stretcher and is bit-exact.
  - Count-in clicks are synthesised after the stretcher and scheduled on the audio clock in the worklet; the first audio frame lands exactly on the downbeat.
  - Position reports are compensated for stretcher and output latency, so the playhead shows what you hear.
- **Analysis in workers** (`src/lib/analysis/`): multi-resolution min/max peaks, spectral-flux onsets refined to the sample, zero crossings, and tempo via essentia.js `RhythmExtractor2013`.
- **Waveform** (`src/lib/ui/waveform/`): exact min/max per device-pixel column, polyline with sample dots at deep zoom (to 16 px per sample), adaptive ruler down to sample numbers, overview strip, ⌘/pinch zoom anchored at the cursor, follow-playhead paging.
- **Loop editing**: drag to create, drag edges or the band, onset and zero-crossing snapping (Alt bypasses), edge selection and nudging (1 ms, 10 ms, 1 sample), typed `m:ss.mmm` In/Out/Length, loop toggle that keeps the region.
- **Control deck**: transport with 28 px readout, count-in and tempo; loop module; stepped speed slider with detents; bipolar pitch knob with radial ticks and quick values; WebGL2 audio-reactive gradient visualiser.
- **Persistence** (`src/lib/storage/`): OPFS via a worker with sync access handles; each track stored under the SHA-256 of its bytes with peaks, onsets, tempo and versioned `settings.json`; Recent list of 3 with eviction; the last track reopens paused at its last position.
- **Stem separation** (phase 8, branch `stems`): demucs-rs (`htdemucs_6s`) compiled to WebAssembly and run on WebGPU in a dedicated worker, behind a transport-agnostic `Separator` interface selected in one place (`src/lib/separation/index.ts`). Separation starts in the background when a track without stems opens, with progress and `Stop` in the top bar; opening another track cancels it. Stems are stored as 16-bit PCM with peaks in the track's OPFS directory and restored on reopen. Each audible stem gets a lane with `M` / `S`; with nothing muted or soloed the original mix plays, and switching crossfades at the same source frame. `Re-separate (fine)` runs `htdemucs_ft`. The model (84 MB) downloads once into Cache Storage.

## Feature checklist

| Area          | Item                                                                                                        | Status                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Opening       | Drag-and-drop with `Drop` outline, Open / ⌘O, empty-state line, one-line error                              | Done                                                                |
| Opening       | Playable immediately after decode; peaks/onsets in background                                               | Done (5-min MP3: ~0.4 s to playable, no main-thread task > 50 ms)   |
| Waveform      | True min/max, 1 px lines, DPR-aware, polyline < 1 frame/px, dots > 6 px/sample                              | Done                                                                |
| Waveform      | Zoom (⌘+scroll, pinch, = - 0 Z), pan (scroll, swipe, overview drag), ruler, overview                        | Done (Safari pinch via `gesturechange`, not automated)              |
| Waveform      | Follow playhead by paging; manual pan disables until play or F                                              | Done                                                                |
| Waveform      | Peaks equal brute force at every level; 60 fps zoom on 5-min track                                          | Done                                                                |
| Loop          | Drag create / move / resize, 8 px hit zone, click outside seeks                                             | Done                                                                |
| Loop          | Onset (8 px) then zero-crossing (±2 ms) snapping, Alt bypass                                                | Done                                                                |
| Loop          | `[` `]` select, ←/→ nudge 1 ms / Shift 10 ms / Alt 1 sample                                                 | Done                                                                |
| Loop          | Typed In / Out / Length, Enter / Esc / Alt+Enter                                                            | Done                                                                |
| Loop          | L toggle keeps region; no jump when outside; Enter jumps to start                                           | Done                                                                |
| Loop          | Live edits, wrap at next cycle or immediately if end moved behind                                           | Done                                                                |
| Loop          | Wrap ±1 frame at 1.0; cycle = len/rate ±1 ms at 0.5/0.75; no clicks; round trips; zero-crossing tests       | Done (Node and real worklet in OfflineAudioContext)                 |
| Speed         | Stepped slider 25–150 %, detents, 6 px snap, Alt bypass, typeable/scrubbable value, , . keys                | Done (detents evenly spaced, see DECISIONS)                         |
| Speed         | 1 kHz at 50 % = 1 kHz ±1 ct                                                                                 | Done (−0.002 ct)                                                    |
| Pitch         | Bipolar knob, centre detent, drag/scroll/keys, double-click reset, typeable value, quick values with E♭ / D | Done                                                                |
| Pitch         | 440 Hz at −100 ct = 415.3 Hz ±1 ct at 100 % and 50 %                                                        | Done                                                                |
| Count-in      | Toggle / C, one bar at tempo × speed, worklet-scheduled, beat indicator, per-track                          | Done                                                                |
| Count-in      | Tempo detection (essentia.js, folded 70–180), typeable/scrubbable override, `—` until known                 | Done                                                                |
| Count-in      | 120 BPM fixture → 120.0 ±0.5; click spacing and first audio frame ±1 ms at 1.0 and 0.5                      | Done                                                                |
| Count-in      | `web-audio-beat-detector` fallback                                                                          | Not needed (essentia verified in all three browsers); not installed |
| Visualiser    | WebGL2 mesh gradient, analyser after stretcher, band features with 40/300 ms smoothing                      | Done                                                                |
| Visualiser    | 0.5× resolution, 60 fps cap, stops when hidden, ~10 fps paused, reduced motion, no-WebGL2 fallback          | Done                                                                |
| Persistence   | OPFS worker with `createSyncAccessHandle`, SHA-256 ids, peaks/onsets/settings cached                        | Done                                                                |
| Persistence   | Recent list of 3 with eviction, content recognition, 500 ms debounce + pagehide, restore on launch          | Done                                                                |
| Shortcuts     | Every listed shortcut; suspended in text fields; `?` overlay                                                | Done                                                                |
| Visual design | Tokens (two tiers), lint rule for primitives/raw colours, layout, type, controls, motion tiers              | Done                                                                |
| Separation    | Seams only (mixer, types, lanes model, storage layout), tested                                              | Done (by design, no separation code)                                |

## Stem separation runtime

`vendor/demucs-wasm/` holds the compiled demucs-rs wasm (v0.3.5) so the app builds without Rust. To rebuild it you need `rustup` (stable, `wasm32-unknown-unknown`) and `wasm-bindgen-cli` 0.2.108:

```bash
scripts/build-demucs.sh
```

WebGPU is required. In Playwright, headed Chromium and WebKit expose a WebGPU adapter; headless Chromium and Firefox do not, so automated tests use a stub separator (`?separator=stub`).

## Known issues

- **Start latency.** After pressing play, audio is heard ~120 ms later at 100 % (48 kHz), more at slower speeds: the stretcher's input plus output latency. The playhead holds at the start frame until then, so it never lies. See DECISIONS.md.
- **Real-device performance is unmeasured.** Budgets were verified with headless Chromium traces on this machine, not in Dia on the target M1.
- **Safari is exercised through Playwright WebKit only.** Ephemeral WebKit contexts have no OPFS, so the WebKit persistence test runs in a persistent context.
- **Pitch shifting moves formants**, as any resample-based shift does; large shifts sound "chipmunk" or "giant". Signalsmith's formant compensation was not used because its transpose path is not cent-accurate.
- **Count-in timing is fixed when playback starts**: changing speed during the count-in does not reschedule the remaining clicks.
- **Visualiser grain** is rendered at half resolution as specified and reads slightly coarse on a 1× display.
- **Licences.** essentia.js is AGPL-3.0 and the MP3 fixture encoder (dev-only) is LGPL-3.0; acceptable for this private app, not for redistribution as closed source.

## Suggested next steps

1. Measure the budgets in Dia on the M1 and in real Safari; tune the Signalsmith block size if start latency matters more than stretch quality.
2. Phase 9: move into Tauri and run demucs-rs natively on Metal behind the same `Separator`, with a native track store and bundled model (see PLAN.md).
3. Reschedule count-in clicks when speed changes mid-count, and optionally align the count-in to detected beat phase.
4. A light theme by adding a second semantic mapping under `:root[data-theme="light"]`.
