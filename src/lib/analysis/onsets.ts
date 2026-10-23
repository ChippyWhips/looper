import { FFT } from './fft';

const N = 1024;
const HOP = 256;
const FLOOR = 1e-4;
/** Absolute flux needed for an onset; a steady tone stays far below it. */
const MIN_FLUX = 5;

/** Spectral-flux onset detection, refined to the sample. Returns ascending onset frames. */
export function detectOnsets(x: Float32Array, sampleRate: number): Int32Array {
	const frames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
	const fft = new FFT(N);
	const re = new Float64Array(N);
	const im = new Float64Array(N);
	const win = new Float64Array(N);
	for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
	// Bin magnitudes scaled so a full-scale sine reads ~1.
	const scale = 4 / N;
	const bins = N / 2;
	let prev = new Float64Array(bins);
	let cur = new Float64Array(bins);
	const flux = new Float64Array(frames);
	for (let t = 0; t < frames; t++) {
		const o = t * HOP;
		for (let i = 0; i < N; i++) {
			re[i] = x[o + i] * win[i];
			im[i] = 0;
		}
		fft.transform(re, im);
		let f = 0;
		for (let k = 0; k < bins; k++) {
			const a = Math.hypot(re[k], im[k]) * scale;
			// Bins under −80 dBFS are noise floor; their log-magnitude jitter is not an onset.
			const m = a > FLOOR ? Math.log1p(1000 * a) : 0;
			cur[k] = m;
			const d = m - prev[k];
			if (d > 0) f += d;
		}
		flux[t] = t === 0 ? 0 : f;
		const tmp = prev;
		prev = cur;
		cur = tmp;
	}
	let max = 0;
	for (const v of flux) max = Math.max(max, v);
	if (max <= 0) return new Int32Array(0);

	const out: number[] = [];
	const minGap = Math.round((0.05 * sampleRate) / HOP);
	const W = 8;
	let last = -Infinity;
	for (let t = 1; t < frames - 1; t++) {
		const v = flux[t];
		if (v < flux[t - 1] || v < flux[t + 1]) continue;
		let mean = 0;
		let n = 0;
		for (let k = Math.max(0, t - W); k <= Math.min(frames - 1, t + W); k++) {
			mean += flux[k];
			n++;
		}
		mean /= n;
		if (v < mean + 0.08 * max || v < 0.05 * max || v < MIN_FLUX) continue;
		if (t - last < minGap) continue;
		last = t;
		out.push(refine(x, t * HOP + N / 2 - HOP / 2));
	}
	return Int32Array.from(out);
}

/** First sample of the attack near an approximate onset. */
function refine(x: Float32Array, approx: number): number {
	const a = Math.max(0, approx - N / 2);
	const b = Math.min(x.length, approx + N / 2);
	let peak = 0;
	let peakAt = approx;
	for (let i = a; i < b; i++) {
		const v = Math.abs(x[i]);
		if (v > peak) {
			peak = v;
			peakAt = i;
		}
	}
	// Walk back from the peak to where the short-term level falls under a quarter of it.
	const blk = 32;
	let i = peakAt;
	while (i - blk >= a) {
		let m = 0;
		for (let j = i - blk; j < i; j++) m = Math.max(m, Math.abs(x[j]));
		if (m < peak * 0.25) break;
		i -= blk;
	}
	for (let j = Math.max(a, i - blk); j <= peakAt; j++) if (Math.abs(x[j]) >= peak * 0.25) return j;
	return i;
}
