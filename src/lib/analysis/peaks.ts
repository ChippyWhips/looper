/** Multi-resolution min/max peaks: level k holds buckets of BASE·2^k frames, aligned at frame 0. */
export const BASE_BUCKET = 32;

export interface PeakLevel {
	/** Frames per bucket. */
	size: number;
	/** Interleaved [min, max] per bucket, over all channels. */
	data: Float32Array;
}

export interface Peaks {
	length: number;
	levels: PeakLevel[];
}

/** Number of levels so that the coarsest bucket spans under 1 px at fit-to-width for `minWidth` px. */
export function levelCount(length: number, width = 1280): number {
	const fitFpp = length / width;
	let n = 1;
	while (BASE_BUCKET * 2 ** n < fitFpp) n++;
	return n;
}

/** Bucket min/max straight from samples. */
export function levelFromSamples(channels: readonly Float32Array[], size: number): PeakLevel {
	const length = channels[0]?.length ?? 0;
	const n = Math.ceil(length / size);
	const data = new Float32Array(n * 2);
	for (let b = 0; b < n; b++) {
		const a = b * size;
		const e = Math.min(length, a + size);
		let lo = Infinity;
		let hi = -Infinity;
		for (const ch of channels) {
			for (let i = a; i < e; i++) {
				const v = ch[i];
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
		}
		data[b * 2] = lo;
		data[b * 2 + 1] = hi;
	}
	return { size, data };
}

/** Next coarser level by pairing buckets. */
export function coarsen(level: PeakLevel): PeakLevel {
	const n = level.data.length / 2;
	const m = Math.ceil(n / 2);
	const data = new Float32Array(m * 2);
	const d = level.data;
	for (let b = 0; b < m; b++) {
		const i = b * 4;
		const j = i + 2;
		if (j < d.length) {
			data[b * 2] = Math.min(d[i], d[j]);
			data[b * 2 + 1] = Math.max(d[i + 1], d[j + 1]);
		} else {
			data[b * 2] = d[i];
			data[b * 2 + 1] = d[i + 1];
		}
	}
	return { size: level.size * 2, data };
}

export function computePeaks(channels: readonly Float32Array[], levels?: number): Peaks {
	const length = channels[0]?.length ?? 0;
	const n = levels ?? levelCount(length);
	const out: PeakLevel[] = [levelFromSamples(channels, BASE_BUCKET)];
	while (out.length < n) out.push(coarsen(out[out.length - 1]));
	return { length, levels: out };
}

/**
 * Exact min/max of frames [a, b) using the coarsest whole buckets available and raw samples
 * for the remainder. `levels` may be a prefix-free subset (e.g. only coarse levels so far).
 */
export function rangeMinMax(
	levels: readonly PeakLevel[],
	channels: readonly Float32Array[] | null,
	a: number,
	b: number,
	out: [number, number]
): void {
	let lo = Infinity;
	let hi = -Infinity;
	const scanRaw = (s: number, e: number) => {
		if (!channels) return;
		for (const ch of channels) {
			const end = Math.min(e, ch.length);
			for (let i = Math.max(0, s); i < end; i++) {
				const v = ch[i];
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
		}
	};
	const take = (lvl: PeakLevel, s: number, e: number) => {
		for (let k = s; k < e; k++) {
			const v0 = lvl.data[k * 2];
			const v1 = lvl.data[k * 2 + 1];
			if (v0 < lo) lo = v0;
			if (v1 > hi) hi = v1;
		}
	};
	// Recursive cover: largest level whose whole buckets fit inside [s, e).
	const cover = (s: number, e: number, li: number) => {
		if (s >= e) return;
		for (let i = li; i >= 0; i--) {
			const lvl = levels[i];
			const first = Math.ceil(s / lvl.size);
			const last = Math.floor(e / lvl.size);
			if (last > first) {
				take(lvl, first, last);
				cover(s, first * lvl.size, i - 1);
				cover(last * lvl.size, e, i - 1);
				return;
			}
		}
		if (channels) scanRaw(s, e);
		else if (levels.length) {
			// No raw data: fall back to the overlapping finest buckets (may overshoot slightly).
			const lvl = levels[0];
			take(lvl, Math.floor(s / lvl.size), Math.ceil(e / lvl.size));
		}
	};
	cover(a, b, levels.length - 1);
	out[0] = lo;
	out[1] = hi;
}
