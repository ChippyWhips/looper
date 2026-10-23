import { describe, expect, it } from 'vitest';
import { BASE_BUCKET, computePeaks, levelCount, rangeMinMax } from './peaks';

function noise(n: number, seed: number): Float32Array {
	let s = seed;
	const x = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		s = (s * 1664525 + 1013904223) >>> 0;
		x[i] = s / 2 ** 31 - 1;
	}
	return x;
}

function brute(chs: Float32Array[], a: number, b: number): [number, number] {
	let lo = Infinity;
	let hi = -Infinity;
	for (const c of chs) {
		for (let i = a; i < Math.min(b, c.length); i++) {
			lo = Math.min(lo, c[i]);
			hi = Math.max(hi, c[i]);
		}
	}
	return [lo, hi];
}

describe('peaks', () => {
	const n = 100_003;
	const chs = [noise(n, 1), noise(n, 2)];
	const peaks = computePeaks(chs, 9);

	it('every bucket at every level equals brute-force min/max', () => {
		for (const lvl of peaks.levels) {
			const buckets = lvl.data.length / 2;
			expect(buckets).toBe(Math.ceil(n / lvl.size));
			for (let b = 0; b < buckets; b++) {
				const [lo, hi] = brute(chs, b * lvl.size, (b + 1) * lvl.size);
				expect(lvl.data[b * 2]).toBe(lo);
				expect(lvl.data[b * 2 + 1]).toBe(hi);
			}
		}
		expect(peaks.levels.map((l) => l.size)).toEqual([
			32, 64, 128, 256, 512, 1024, 2048, 4096, 8192
		]);
	});

	it('range queries are exact for arbitrary ranges', () => {
		const out: [number, number] = [0, 0];
		const rnd = noise(2000, 7);
		for (let k = 0; k < 1000; k++) {
			const a = Math.floor(((rnd[k * 2] + 1) / 2) * n);
			const len = Math.floor(((rnd[k * 2 + 1] + 1) / 2) * 20000) + 1;
			const b = Math.min(n, a + len);
			rangeMinMax(peaks.levels, chs, a, b, out);
			expect(out).toEqual(brute(chs, a, b));
		}
	});

	it('stops once a bucket is under 1 px at fit-to-width', () => {
		const len = 14_400_000;
		const lv = levelCount(len, 1280);
		const top = BASE_BUCKET * 2 ** (lv - 1);
		expect(top).toBeLessThan(len / 1280);
		expect(top * 2).toBeGreaterThanOrEqual(len / 1280);
	});
});
