# DECISIONS

Every deviation from SPEC.md, and every judgement call on an ambiguity, with its reason.

## Setup

- **SPEC.md whitespace.** The `sv create` formatter re-aligned the Markdown tables in SPEC.md before it was ignored. Only table padding changed; content is identical. SPEC.md and `design/` are now in `.prettierignore`.
- **Lockfile committed.** The scaffold gitignored `package-lock.json`; it is committed for reproducible installs.
- **Toolchain versions.** SvelteKit 3, Svelte 5, Vite 8, TypeScript 6, Vitest 4, Playwright 1.60 (latest at scaffold time).

## Audio engine

- **Signalsmith Stretch (npm `signalsmith-stretch` 1.3.2, MIT) verified.** The package ships one file containing an Emscripten factory (WASM inlined as base64) plus its own AudioWorkletProcessor. Its bundled node takes loop points in seconds and seeks its input every render quantum; it cannot do a sample-exact, crossfaded, source-domain wrap. So we use its **core only**: a Vite plugin (`signalsmith-core`) slices the Emscripten factory out of the package and exposes it as a module, which our own `player.worklet.ts` instantiates. The same module runs in Node for unit tests.
- **Latency model (measured).** Streaming `process(nIn, nOut)`: an input impulse at index `i` appears at output `i/rate + inputLatency/rate + outputLatency`. At 48 kHz default preset, input and output latency are 2880 frames each.
- **Pitch via stretch + resample, not Signalsmith's transpose.** Measured on pure sines, Signalsmith's own transpose is off by 2–7 cents depending on frequency (440 Hz at −100 ct gave 416.17 Hz, +3.6 ct; 220 Hz at −100 ct gave +6.1 ct). That fails the ±1 ct requirement and would be audible against a tuned guitar. Its time-stretch alone is exact (1 kHz at 50 % measured −0.002 ct). The stretcher therefore time-stretches at `rate / p` (p = 2^(cents/1200)) and a windowed-sinc resampler then reads its output at step `p`. Frequency becomes exact to resampler precision; speed is unchanged because the two factors cancel.
- **Unity bypass.** At speed 100 % and 0 ct the stretcher is still fed (to stay warm) but the output reads the source-domain stream directly through the same latency, so the audio is bit-exact. Switching between bypass and stretched output crossfades over 20 ms once the stretcher output for the new setting arrives.
- **`#lib` imports need extensions.** SvelteKit 3 replaced `$lib` with package `imports` (`#lib/*`); TypeScript resolves them only with the file extension, so app code imports `#lib/x.ts`. Inside `src/lib`, relative imports are used.
- **Lint rule for tokens** is a Vitest test (`src/lib/ui/tokens.test.ts`): it fails on primitive references, hex/rgb/named colours, raw font sizes/weights/durations, non-zero radii, shadows and gradients in any component, and on hex/rgb literals in UI scripts.
- **Fixtures** are generated, not committed (`static/fixtures/`, ~150 MB). `npm run verify` generates them first. The 5-minute song also gets an MP3 (via `@breezystack/lamejs`, dev-only, LGPL) for the load-time test.
