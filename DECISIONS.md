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
