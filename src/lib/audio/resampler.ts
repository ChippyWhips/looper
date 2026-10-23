/** Kaiser-windowed sinc kernel, tabulated. Exact passthrough at integer positions with step 1. */
const ZERO_CROSSINGS = 16;
const OVERSAMPLE = 512;
const BETA = 8.6;

function besselI0(x: number): number {
	let sum = 1;
	let term = 1;
	for (let k = 1; k < 40; k++) {
		term *= (x / (2 * k)) * (x / (2 * k));
		sum += term;
		if (term < 1e-12 * sum) break;
	}
	return sum;
}

const TABLE = (() => {
	const n = ZERO_CROSSINGS * OVERSAMPLE + 2;
	const t = new Float32Array(n);
	const i0b = besselI0(BETA);
	for (let i = 0; i < n; i++) {
		const x = i / OVERSAMPLE;
		const r = x / ZERO_CROSSINGS;
		const w = r >= 1 ? 0 : besselI0(BETA * Math.sqrt(1 - r * r)) / i0b;
		t[i] = (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * w;
	}
	return t;
})();

function kernel(x: number): number {
	const a = Math.abs(x) * OVERSAMPLE;
	const i = a | 0;
	if (i >= ZERO_CROSSINGS * OVERSAMPLE) return 0;
	const f = a - i;
	return TABLE[i] + (TABLE[i + 1] - TABLE[i]) * f;
}

/** Frames of input needed either side of a read position at step ≤ 2. */
export const RESAMPLER_REACH = ZERO_CROSSINGS * 2 + 2;

/**
 * Band-limited value of `read` at fractional position `pos`.
 * `step` is the read increment per output frame; above 1 the kernel widens to anti-alias.
 */
export function interpolate(read: (i: number) => number, pos: number, step: number): number {
	const fc = step > 1 ? 1 / step : 1;
	const base = Math.floor(pos);
	const frac = pos - base;
	if (frac === 0 && fc === 1) return read(base);
	const half = Math.ceil(ZERO_CROSSINGS / fc);
	let s = 0;
	for (let k = -half + 1; k <= half; k++) {
		const x = k - frac;
		const w = kernel(x * fc);
		if (w !== 0) s += read(base + k) * w;
	}
	return s * fc;
}
