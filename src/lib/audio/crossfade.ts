/** Equal-power fade-in gain at progress t ∈ [0, 1]. */
export function fadeIn(t: number): number {
	return Math.sin((Math.min(1, Math.max(0, t)) * Math.PI) / 2);
}

/** Equal-power fade-out gain at progress t ∈ [0, 1]. */
export function fadeOut(t: number): number {
	return Math.cos((Math.min(1, Math.max(0, t)) * Math.PI) / 2);
}

/**
 * Power-preserving crossfade gains for two signals with normalised correlation r.
 * r = 0 gives the equal-power curve; r = 1 gives a linear (equal-gain) fade.
 * Satisfies gIn² + gOut² + 2·r·gIn·gOut = 1 for every t.
 */
export function correlatedGains(t: number, r: number): [gOut: number, gIn: number] {
	const rc = Math.min(1, Math.max(0, r));
	const tc = Math.min(1, Math.max(0, t));
	const o = 0.5 * Math.sin(Math.PI * (tc - 0.5));
	const e = Math.sqrt(Math.max(0, 0.5 / (1 + rc) - ((1 - rc) / (1 + rc)) * o * o));
	return [e - o, e + o];
}

/** Normalised correlation of a[aStart..aStart+n) and b[bStart..bStart+n), 0 if either is silent. */
export function correlation(a: (i: number) => number, b: (i: number) => number, n: number): number {
	let ab = 0;
	let aa = 0;
	let bb = 0;
	for (let i = 0; i < n; i++) {
		const x = a(i);
		const y = b(i);
		ab += x * y;
		aa += x * x;
		bb += y * y;
	}
	const d = Math.sqrt(aa * bb);
	return d > 1e-12 ? ab / d : 0;
}
