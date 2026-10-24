# DECISIONS

Every deviation from SPEC.md, and every judgement call on an ambiguity, with its reason.

## Setup

- **SPEC.md whitespace.** The `sv create` formatter re-aligned the Markdown tables in SPEC.md before it was ignored. Only table padding changed; content is identical. SPEC.md and `design/` are now in `.prettierignore`.
- **Lockfile committed.** The scaffold gitignored `package-lock.json`; it is committed for reproducible installs.
- **Toolchain versions.** SvelteKit 3, Svelte 5, Vite 8, TypeScript 6, Vitest 4, Playwright 1.60 (latest at scaffold time).
- **`#lib` imports need extensions.** SvelteKit 3 replaced `$lib` with package `imports` (`#lib/*`); TypeScript resolves them only with the file extension, so app code imports `#lib/x.ts`. Inside `src/lib`, relative imports are used.
- **Lint rule for tokens** is a Vitest test (`src/lib/ui/tokens.test.ts`): it fails on primitive references, hex/rgb/named colours, raw font sizes/weights/durations, non-zero radii, shadows and gradients in any component, and on hex/rgb literals in UI scripts.
- **Fixtures** are generated, not committed (`static/fixtures/`, ~150 MB). `npm run verify` generates them first. The 5-minute song also gets an MP3 (via `@breezystack/lamejs`, dev-only, LGPL) for the load-time test.

## Audio engine

- **Signalsmith Stretch (npm `signalsmith-stretch` 1.3.2, MIT) verified.** The package ships one file containing an Emscripten factory (WASM inlined as base64) plus its own AudioWorkletProcessor. Its bundled node takes loop points in seconds and seeks its input every render quantum; it cannot do a sample-exact, crossfaded, source-domain wrap. So we use its **core only**: a Vite plugin (`signalsmith-core`) slices the Emscripten factory out of the package and exposes it as a module, which our own `player.worklet.ts` instantiates. The same module runs in Node for unit tests.
- **Latency model (measured).** Streaming `process(nIn, nOut)`: an input impulse at index `i` appears at output `i/rate + inputLatency/rate + outputLatency`. At 48 kHz default preset, input and output latency are 2880 frames each.
- **Pitch via stretch + resample, not Signalsmith's transpose.** Measured on pure sines, Signalsmith's own transpose is off by 2–7 cents depending on frequency (440 Hz at −100 ct gave 416.17 Hz, +3.6 ct; 220 Hz at −100 ct gave +6.1 ct). That fails the ±1 ct requirement and would be audible against a tuned guitar. Its time-stretch alone is exact (1 kHz at 50 % measured −0.002 ct). The stretcher therefore time-stretches at `rate / p` (p = 2^(cents/1200)) and a windowed-sinc resampler then reads its output at step `p`. Frequency becomes exact to resampler precision; speed is unchanged because the two factors cancel.
- **Unity bypass.** At speed 100 % and 0 ct the stretcher is still fed (to stay warm) but the output reads the source-domain stream directly through the same latency, so the audio is bit-exact. Switching between bypass and stretched output crossfades over 20 ms once the stretcher output for the new setting arrives.
- **Correlation-aware loop crossfade.** The 5 ms wrap crossfade uses the power-preserving family `gIn² + gOut² + 2r·gIn·gOut = 1`, with `r` the normalised correlation of the two 5 ms segments (clamped to 0..1). For uncorrelated material this is exactly the spec's equal-power curve; for correlated material (a sustained note looped at matching phase) it tends to a linear fade, avoiding the +3 dB bump a pure equal-power curve would add at the midpoint, which is an audible swell and a slope spike.
- **Seeks while playing** reuse the wrap crossfade (5 ms, source domain) instead of resetting the stretcher, so a seek never clicks.
- **Start gate.** Signalsmith's STFT spreads an onset up to half a block (~60 ms at 48 kHz) earlier than it occurs. Every playback start (and the count-in downbeat) mutes the stretched output until the exact frame at which the start frame becomes audible, then ramps in over 1 ms. Without this, the count-in "first audio frame" landed ~125 ms early at 50 % speed.
- **Start latency.** After play, the first audio is heard `inputLatency/rate + outputLatency` output frames later (≈120 ms at 100 %, 48 kHz). The playhead holds at the start frame for that time, because it shows what is audible. A seek-based pre-roll could halve this but would either play audio from before the start frame or need a long burst of extra processing in one render quantum; accuracy and glitch-free rendering win.
- **Position reports** come from a 1024-quantum history in the worklet, looked up `baseLatency + outputLatency` back, so `sourceFrame` is what is coming out of the speakers at `contextTime`. The main thread extrapolates with `audioContext.currentTime` and the reported velocity, and wraps at the loop end if the report was inside an engaged loop.
- **AudioContext runs at the file's native sample rate.** `decodeAudioData` resamples to the context rate, which would make "source frames" differ from the file's frames and soften sample-level display. A header sniffer (WAV, AIFF, FLAC, MP3, MP4/M4A, Ogg) reads the native rate and the context is recreated at that rate when it differs; the browser resamples to the device at the very end.
- **Enter starts playback.** "Jump to loop start" also starts playback (with count-in if on), since the count-in section lists Enter as a way of starting playback.
- **Debug page** uses plain buttons/inputs; it is a test tool, not product UI.
- **Ping is answered outside the render loop.** In an `OfflineAudioContext` nothing renders until `startRendering()`, so the worklet acknowledges `ping` from its message handler (after queuing all earlier messages in order) rather than at the next quantum.

## Waveform

- **Device-pixel columns.** Peaks are drawn per device pixel column (1 device px wide), so on Retina the waveform has twice the detail and every line sits on the device grid.
- **Exact column min/max.** Each column's range is covered by the coarsest whole buckets that fit, recursing to finer levels and raw samples at the edges (`rangeMinMax`). The drawn min/max is exactly the samples in the column, not the overlapping buckets.
- **Stereo.** Peaks are the envelope of both channels. At sample level both channels are drawn as polylines (they coincide for mono content).
- **AudioContexts are pre-warmed at startup** for 44.1 and 48 kHz. Constructing an AudioContext blocked Chromium's main thread for ~250 ms, which broke the 50 ms budget during load. Other rates are created on demand.
- **Vertical wheel pans** as well as horizontal (mouse users have no horizontal wheel). ⌘ + wheel and pinch zoom; Safari pinch uses `gesturechange`.
- **`=` / `-` zoom ×2** anchored at the playhead when visible, else the view centre.

## Loop editing

- **Zero crossings are measured about the local DC level** (Hann-weighted mean over ±2048 frames). With a DC offset the raw signal may never cross zero; crossings of the AC component are what make a seamless loop edge.
- **Nudges snap directionally.** `←`/`→` move 1 ms (10 ms with Shift) and then snap to the nearest zero crossing _beyond_ the current edge, so repeated nudges always progress instead of snapping back. Alt moves exactly one sample, unsnapped.
- **Typed and scrubbed values snap to zero crossings only.** Onset snapping depends on zoom (8 px), which makes no sense for a value typed to the millisecond.
- **Creating a region turns looping on** (drag-create, or I/O when no region exists). Toggling with `L` afterwards keeps the region.
- **I with no region** creates `[playhead, track end)`; **O with no region** creates `[0, playhead)`. The next I/O completes the region.
- **Clicks inside the loop band seek** as well (no drag = seek); only clicks on an edge select it instead.
- **Minimum loop length** is 1 ms.
- **Overview playhead is `--fg-muted`**, keeping the accent count at four.

## Speed, pitch, tempo, count-in

- **Speed slider spacing.** Detents are evenly spaced along the slider (25, 50, 60, 70, 75, 80, 90, 100, 150 as equal segments, piecewise-linear between). On a proportional scale 70/75/80 would be 7 px apart at 1280 px and their labels would overlap; even spacing also gives the 50–100 % practice range most of the travel. Values between detents still move in 1 % steps.
- **essentia.js 0.1.3 (AGPL-3.0) verified** in module workers in Chromium, Firefox and WebKit: the 120 BPM click fixture reads 120.04 BPM, the 5-minute song 120.00. It analyses up to the first 120 s, resampled to 44.1 kHz (the rate RhythmExtractor2013 assumes), `multifeature` method; ~1.2 s for 30 s, ~4 s for 120 s. The fallback (`web-audio-beat-detector`) is not needed and not installed.
- **Tempo shows one decimal**, rounded; typed values override detection and are kept per track.
- **Quick pitch values and detent labels use mono 11** (`--fs-xs`): the type scale has no 13 px mono, and 15 px would not fit the row at 1280 px.
- **Knob detent** is a 12 px dead band (±6 px) around 0 in drag space; crossing it costs 6 px. Alt drags straight through.
- **Beat indicator** lights the Count-in dot for 100 ms from each click's audible time (click time + output latency), instant on and off, driven from the rAF loop.
- **`,` / `.` below 50 % or above 100 %** go to the nearest preset in that direction and stop at the ends of the preset list; Shift steps 1 %.

## Visualiser

- **Feature scaling.** Band powers are mapped to 0..1 on fixed dB windows (low −70…−20, mid −80…−30, high −90…−40 dBFS; RMS −40…−6 dBFS) and smoothed with one-pole envelopes (attack 40 ms, release 300 ms). Exposure additionally slews at most 1.5 per second, so loud transients cannot strobe.
- **Five fields**: a large `--viz-1` wash, the largest deep `--viz-2` field (swells with low energy), a `--viz-3` field, a smaller `--viz-2` field and a small `--viz-4` highlight lifted by high energy. Mid energy speeds up the motion (time integrates at up to 3.5× the paused rate) and drives a domain warp. Base colour is `--bg-sunken`.
- **Paused drift**: one primary cycle per 20 s; exposure 0.5.
- **Reduced motion**: time is frozen and the frame re-renders once a second.
- **Fallback**: without WebGL2 a static frame is drawn with 2D radial gradients from the same tokens.

## Persistence

- **Layout.** `looper/recent.json` and `looper/tracks/<sha256>/{original, peaks.bin, onsets.bin, analysis.json, settings.json, stems/}`. `stems/` is created empty on ingest; `settings.json` has no `stems` field until phase 8 writes one.
- **Hashing happens in the OPFS worker** during ingest (the bytes are transferred there), in parallel with decoding on the main thread.
- **Cached analysis.** Peaks, onsets and the detected tempo are stored and reused, so reopening a track skips the peaks, onset and tempo workers (the mono downmix for zero-crossing snaps is still computed).
- **pagehide durability.** A worker write may not complete while the page unloads, so `pagehide` also stashes the settings synchronously in `localStorage` (`looper:pending:<id>`); the next load moves it into OPFS if it is newer. All OPFS writes still go through the worker. Settings also save on `visibilitychange → hidden`.
- **Position and view** are not reactive, so a 1 s poll schedules a save when they differ from the last save; everything else triggers the 500 ms debounce reactively.
- **Frames are stored with their sample rate** and rescaled if a track is ever reopened at a different rate.
- **Removing the open track** from Recent unloads it (empty state).
- **WebKit tests use a persistent context**: Playwright's ephemeral WebKit contexts have no OPFS (`UnknownError`); persistent ones work, so the persistence test runs in a persistent context there. Real Safari is not affected.
- **Stale position reports.** Reports carry an epoch (count of load/play/pause/seek commands applied); the engine ignores reports older than the last such command it sent.
