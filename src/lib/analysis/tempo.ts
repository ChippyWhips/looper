/** Fold a tempo into [70, 180) BPM by doubling or halving. */
export function foldTempo(bpm: number): number {
	if (!Number.isFinite(bpm) || bpm <= 0) return NaN;
	let b = bpm;
	while (b < 70) b *= 2;
	while (b >= 180) b /= 2;
	return b;
}

/** Linear resample of mono audio (adequate for tempo analysis). */
export function resampleLinear(x: Float32Array, from: number, to: number): Float32Array {
	if (from === to) return x;
	const n = Math.floor((x.length * to) / from);
	const out = new Float32Array(n);
	const r = from / to;
	for (let i = 0; i < n; i++) {
		const p = i * r;
		const k = Math.floor(p);
		const f = p - k;
		out[i] = x[k] * (1 - f) + (x[k + 1] ?? x[k]) * f;
	}
	return out;
}
