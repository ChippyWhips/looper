/** Half-width (frames) of the Hann window used to estimate the local DC level. */
const DC_HALF = 2048;

/** Hann-weighted local mean; the taper keeps a tone's own cycles from biasing the estimate. */
function localMean(x: Float32Array, frame: number): number {
	let s = 0;
	let w = 0;
	for (let k = -DC_HALF + 1; k < DC_HALF; k++) {
		const i = frame + k;
		if (i < 0 || i >= x.length) continue;
		const h = 0.5 + 0.5 * Math.cos((Math.PI * k) / DC_HALF);
		s += h * x[i];
		w += h;
	}
	return w > 0 ? s / w : 0;
}

/**
 * Nearest zero crossing of `x` (relative to its local DC level) within ±radius frames of
 * `frame`, as the frame whose value is closest to the crossing. With `dir` set, only
 * crossings strictly after (dir > 0) or before (dir < 0) `frame` are considered.
 * Returns null when there is none, or `frame` itself in digital silence.
 */
export function nearestZeroCrossing(
	x: Float32Array,
	frame: number,
	radius: number,
	dir: -1 | 0 | 1 = 0
): number | null {
	const f = Math.round(frame);
	if (f < 0 || f >= x.length) return null;
	const dc = localMean(x, f);
	const lo = Math.max(1, f - Math.ceil(radius));
	const hi = Math.min(x.length - 1, f + Math.ceil(radius));
	let silent = true;
	for (let i = lo - 1; i <= hi; i++) {
		if (x[i] !== 0) {
			silent = false;
			break;
		}
	}
	if (silent) return dir === 0 ? f : null;
	let best: number | null = null;
	let bestDist = Infinity;
	for (let i = lo; i <= hi; i++) {
		const a = x[i - 1] - dc;
		const b = x[i] - dc;
		if (!((a < 0 && b >= 0) || (a > 0 && b <= 0))) continue;
		const at = Math.abs(a) < Math.abs(b) ? i - 1 : i;
		if (dir > 0 && at <= f) continue;
		if (dir < 0 && at >= f) continue;
		const d = Math.abs(at - frame);
		if (d < bestDist) {
			bestDist = d;
			best = at;
		}
	}
	return best;
}
