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

- [x] peaks.worker.ts: multi-resolution min/max (32, 64 … frames per bucket)
- [x] Unit test: every level equals brute force
- [x] View model: N lanes sharing one viewport (main lane only rendered)
- [x] Canvas renderer: DPR-aware, 1 px columns, polyline < 1 frame/px, dots > 6 px/sample
- [x] Ruler (adaptive ticks: m:ss → ms → samples), overview strip (24 px), playhead (rAF)
- [x] Zoom (⌘+scroll / pinch anchored, = - 0 Z), pan (scroll, overview drag), follow playhead (paging, F)
- [x] Progressive draw as levels arrive; fade in on Slow tier
- [x] App shell: top bar, waveform area, deck skeleton
- [x] E2E: sample dots screenshot at max zoom; zoom fps trace; load trace
- [x] Verify + screenshots + commit `phase 2`

## Phase 3: Loop editing

- [x] Drag create / move / resize (8 px hit zone, col-resize), click outside seeks
- [x] onsets.worker.ts (spectral flux), zero-crossing.ts (+ tests: silence, DC, sine)
- [x] Snapping: onset within 8 px, else zero crossing ±2 ms; Alt bypass
- [x] Edge selection ([ ] / click), nudge ← → (1 ms, Shift 10 ms, Alt 1 sample)
- [x] In / Out / Length typed fields (m:ss.mmm), Enter/Esc, Alt+Enter no-snap
- [x] Loop toggle (L), outline-only when off, Enter jumps to loop start
- [x] I / O set at playhead, live edits
- [x] Verify + screenshots + commit `phase 3`

## Phase 4: Speed, pitch, tempo, count-in

- [x] Stepped slider (detents, 6 px snap, Alt bypass, labels), typeable/scrubbable value, , . keys
- [x] Bipolar knob (25 ticks / 270°, centre detent, drag/scroll/keys, dbl-click reset), quick values + E♭ / D hints
- [x] tempo.worker.ts: essentia.js RhythmExtractor2013 (fallback web-audio-beat-detector), fold 70–180
- [x] Tempo value (typeable, scrub 0.1), `—` until known
- [x] Count-in toggle (C), beat indicator dot
- [x] Test: 120 BPM fixture → 120.0 ±0.5
- [x] Verify + screenshots + commit `phase 4`

## Phase 5: Visualiser

- [x] AnalyserNode (2048) after stretcher; low/mid/high/RMS features, attack 40 ms / release 300 ms
- [x] WebGL2 mesh gradient + grain, 0.5× resolution, 60 fps cap, hidden stop, 10 fps paused
- [x] Reduced motion (1 fps static), WebGL2 fallback static frame
- [x] Verify + fps trace + commit `phase 5`

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

### Phase 2

- Waveform: true min/max per device column, crisp, edge to edge; zero line in `--border-subtle`; overview strip with hairline under it. Matches ref 10 (vertical-line waveform, accent playhead with dot head on the ruler).
- Sample zoom: 1 px polyline with 2 px square dots per sample (dots same colour as line; visible as nodes at 2× crop). OK per spec.
- Fixed: `Open` / `?` were 24 px apart (row gap is 12 px).
- Deck modules other than transport are empty until phases 3–5. Transport: play circle, 28 px readout, `/ 0:10.000` subtle, Count-in ring + `— BPM`.
- Watch: inactive waveform `--wave-default` is very dark on `--bg-sunken`; that is the spec's value (white is reserved for the loop). Revisit only if the loop-on screenshot reads poorly.
- Perf: load-to-playable 437 ms (5-min MP3); no long tasks during load after moving AudioContext creation to startup; zoom fit→max mean 16.67 ms/frame.

### Phase 3

- Loop on: 4 % band, white waveform inside, 1 px white edges, selected edge 2 px with mono time label inside at top. Overview shows band, edges and the white 1 px window rectangle.
- Loop off: two 1 px `--fg-muted` edges, no band, waveform not highlighted. Matches spec.
- Deck loop module: `● Loop` (accent) and `● Snap` (primary) as text toggles; In/Out label-over-value, `Length` inline below. No boxes on values.
- Fixed: overview playhead was a second accent mark; now `--fg-muted`, so accent marks stay ≤ 4 (playhead + its ruler dot, Loop dot, Count-in dot).
- Fixed: spectral flux reported 150 onsets in a steady 16-bit sine (log-magnitude jitter in noise-floor bins); added a −80 dBFS bin floor and an absolute flux threshold.

### Phase 4

- Speed: 1 px track, 2 × 16 px handle, 1 × 4 px detent ticks, mono 11 labels (active white, others subtle). No thumb blob, no filled range. Typeable `80%` right-aligned in mono 15.
- Pitch: flat 56 px knob in `--control-bg`, 2 px indicator 30–85 % radius, 25 ticks on 270° lit from centre outwards. Quick values row 12 px apart with `E♭` / `D` hints under −100 / −200.
- Fixed: modules stacked their content with `space-between`, so the speed slider sat on the bottom edge. All modules now share a three-row grid (header / control / footer): headers, middle controls (In/Out, slider, knob) and footers (Count-in, Length, quick values) line up across the deck.
- Fixed: in the empty state the `100` detent label was white; disabled labels are now all `--fg-subtle`.
- Accent marks with loop and count-in on: playhead (+ ruler dot), Loop dot, Count-in dot = 3.

### Phase 5

- Visualiser fills its 280 px cell edge to edge, no label/border/radius. Soft grainy ember fields over near-black; the only colour on screen besides the accent marks.
- Fixed: first pass was a flat bright red wash when playing (fields too large, tonemap too hot). Reduced field radii/weights and tonemap gain; dark areas now remain, as in refs 01/02.
- Paused exposure 0.5 vs ~0.9 playing (≈ 40–55 % brightness after tonemap); paused render rate 9.5 fps, playing 60 fps; reduced motion 1 fps; WebGL2-less fallback draws a static 2D frame.
- Grain is rendered at 0.5× resolution as specified, so it reads slightly coarse at 1×; acceptable.
