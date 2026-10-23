# PLAN

Working memory for the build. SPEC.md is the source of truth; deviations go in DECISIONS.md.

## Phase 0: Setup

- [x] Scaffold SvelteKit (Svelte 5, adapter-static, SPA `ssr = false`), strict TS
- [x] ESLint, Prettier, Vitest, Playwright (chromium, webkit, firefox)
- [x] `src/lib/ui/tokens.css`: every primitive + semantic token, type, spacing, motion
- [x] Lint rule: components may not reference primitives or raw colours
- [x] `scripts/make-fixtures.ts`: 44.1k + 48k WAVs: click-120, sine-440, sine-1k, log sweep, silence, dc-sine, 5-min song (+ MP3 of song)
- [x] `npm run verify`: check, lint, unit, e2e, screenshots
- [x] Module layout skeleton (audio, analysis, separation, storage, state, ui, viz)
- [x] APP_NAME constant
- [x] Verify + commit `phase 0`

## Phase 1: Audio engine

- [x] Verify Signalsmith Stretch (npm `signalsmith-stretch` 1.3.2, MIT): extract emscripten core, run in Node + AudioWorklet
- [x] `Stretcher` interface + Signalsmith implementation (+ resampler for pitch, see DECISIONS)
- [x] `crossfade.ts`: equal-power curves, correlation-aware loop crossfade
- [x] `sources.ts`: AudioSource types, mute/solo resolution, N-source mixer with 20 ms equal-power set crossfade
- [x] `player.worklet.ts`: reader (loop wrap, 5 ms crossfade, seek), stretcher, bypass at unity, count-in clicks, position reports
- [x] `engine.ts`: decode, transfer channels, commands, interpolated position
- [x] `/debug` page: play, loop range, speed, pitch
- [x] Offline tests (Playwright chromium, real worklet in OfflineAudioContext): wrap ±1 frame @1.0, cycle length @0.5/0.75 ±1 ms, no clicks, 1 kHz @50% ±1 ct, 440 @−100 ct → 415.3 ±1 ct at 100% and 50%, count-in spacing + first audio frame
- [x] Unit tests: crossfade, mixer (two synthetic sources), mute/solo, time formatting round trips
- [x] Verify + commit `phase 1`

## Phase 2: Waveform

- [ ] peaks.worker.ts: multi-resolution min/max (32, 64 … frames per bucket)
- [ ] Unit test: every level equals brute force
- [ ] View model: N lanes sharing one viewport (main lane only rendered)
- [ ] Canvas renderer: DPR-aware, 1 px columns, polyline < 1 frame/px, dots > 6 px/sample
- [ ] Ruler (adaptive ticks: m:ss → ms → samples), overview strip (24 px), playhead (rAF)
- [ ] Zoom (⌘+scroll / pinch anchored, = - 0 Z), pan (scroll, overview drag), follow playhead (paging, F)
- [ ] Progressive draw as levels arrive; fade in on Slow tier
- [ ] App shell: top bar, waveform area, deck skeleton
- [ ] E2E: sample dots screenshot at max zoom; zoom fps trace; load trace
- [ ] Verify + screenshots + commit `phase 2`

## Phase 3: Loop editing

- [ ] Drag create / move / resize (8 px hit zone, col-resize), click outside seeks
- [ ] onsets.worker.ts (spectral flux), zero-crossing.ts (+ tests: silence, DC, sine)
- [ ] Snapping: onset within 8 px, else zero crossing ±2 ms; Alt bypass
- [ ] Edge selection ([ ] / click), nudge ← → (1 ms, Shift 10 ms, Alt 1 sample)
- [ ] In / Out / Length typed fields (m:ss.mmm), Enter/Esc, Alt+Enter no-snap
- [ ] Loop toggle (L), outline-only when off, Enter jumps to loop start
- [ ] I / O set at playhead, live edits
- [ ] Verify + screenshots + commit `phase 3`

## Phase 4: Speed, pitch, tempo, count-in

- [ ] Stepped slider (detents, 6 px snap, Alt bypass, labels), typeable/scrubbable value, , . keys
- [ ] Bipolar knob (25 ticks / 270°, centre detent, drag/scroll/keys, dbl-click reset), quick values + E♭ / D hints
- [ ] tempo.worker.ts: essentia.js RhythmExtractor2013 (fallback web-audio-beat-detector), fold 70–180
- [ ] Tempo value (typeable, scrub 0.1), `—` until known
- [ ] Count-in toggle (C), beat indicator dot
- [ ] Test: 120 BPM fixture → 120.0 ±0.5
- [ ] Verify + screenshots + commit `phase 4`

## Phase 5: Visualiser

- [ ] AnalyserNode (2048) after stretcher; low/mid/high/RMS features, attack 40 ms / release 300 ms
- [ ] WebGL2 mesh gradient + grain, 0.5× resolution, 60 fps cap, hidden stop, 10 fps paused
- [ ] Reduced motion (1 fps static), WebGL2 fallback static frame
- [ ] Verify + fps trace + commit `phase 5`

## Phase 6: Persistence

- [ ] opfs.worker.ts (createSyncAccessHandle), hash.ts (SHA-256), track-store.ts
- [ ] settings-schema.ts (version 1, migration hook, `stems` absent), reserved `stems/` dir
- [ ] Recent list (3), eviction removes dir, content match, debounce 500 ms + pagehide
- [ ] Restore most recent on launch, paused at last position
- [ ] Recent dropdown UI (320 px, rows, ×)
- [ ] E2E: open 4, reload, 3 remain with settings, evicted dir gone
- [ ] Verify + commit `phase 6`

## Phase 7: Polish

- [ ] Shortcuts overlay (?), empty + error states
- [ ] Full visual pass at 1280×800 and 1512×982
- [ ] Performance traces vs budgets
- [ ] Cross-browser smoke (WebKit, Firefox)
- [ ] README.md
- [ ] Verify + commit `phase 7`

## Screenshot review log

### Phase 1
- No product UI yet (by design: phase 1 is engine only). `/` shows the app name on `--bg-default`; `/debug` is an unstyled test page and is excluded from review.
