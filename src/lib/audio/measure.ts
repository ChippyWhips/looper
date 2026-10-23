/** Measurement helpers shared by unit tests and the offline-render harness. */

/** Frames where |x| first exceeds threshold after at least `quiet` frames below it. */
export function onsets(x: Float32Array, threshold: number, quiet: number): number[] {
	const out: number[] = [];
	let below = quiet;
	for (let i = 0; i < x.length; i++) {
		if (Math.abs(x[i]) > threshold) {
			if (below >= quiet) out.push(i);
			below = 0;
		} else {
			below++;
		}
	}
	return out;
}

/** Hann-windowed DFT magnitude² at frequency f over x. */
function power(x: Float32Array, f: number, sampleRate: number): number {
	const n = x.length;
	let re = 0;
	let im = 0;
	const w = (2 * Math.PI * f) / sampleRate;
	// Rotating phasor avoids a sin/cos per sample.
	const cr = Math.cos(w);
	const ci = -Math.sin(w);
	let pr = 1;
	let pi = 0;
	for (let i = 0; i < n; i++) {
		const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
		const v = x[i] * win;
		re += v * pr;
		im += v * pi;
		const t = pr * cr - pi * ci;
		pi = pr * ci + pi * cr;
		pr = t;
	}
	return re * re + im * im;
}

/** Frequency of the strongest partial in [lo, hi] Hz, refined to ~1e-4 Hz. */
export function peakFrequency(x: Float32Array, sampleRate: number, lo: number, hi: number): number {
	const coarse = x.subarray(0, Math.min(x.length, 16384));
	const step = sampleRate / coarse.length / 2;
	let best = lo;
	let bestP = -1;
	for (let f = lo; f <= hi; f += step) {
		const p = power(coarse, f, sampleRate);
		if (p > bestP) {
			bestP = p;
			best = f;
		}
	}
	let a = best - step;
	let b = best + step;
	for (let k = 0; k < 50; k++) {
		const m1 = a + (b - a) * 0.382;
		const m2 = a + (b - a) * 0.618;
		if (power(x, m1, sampleRate) > power(x, m2, sampleRate)) b = m2;
		else a = m1;
	}
	return (a + b) / 2;
}

export function cents(f: number, ref: number): number {
	return 1200 * Math.log2(f / ref);
}

/** Largest |x[i] − x[i−1]| in [from, to). */
export function maxJump(x: Float32Array, from = 1, to = x.length): number {
	let m = 0;
	for (let i = Math.max(1, from); i < to; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
	return m;
}

/** Energy centroid (in frames) of x² over [from, to). */
export function centroid(x: Float32Array, from: number, to: number): number {
	let e = 0;
	let m = 0;
	for (let i = Math.max(0, from); i < Math.min(x.length, to); i++) {
		const p = x[i] * x[i];
		e += p;
		m += p * i;
	}
	return e > 0 ? m / e : from;
}
