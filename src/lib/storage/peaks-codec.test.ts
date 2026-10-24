import { describe, expect, it } from 'vitest';
import { computePeaks } from '../analysis/peaks';
import { decodePeaks, encodePeaks } from './peaks-codec';

describe('peaks codec', () => {
	it('round-trips', () => {
		const x = new Float32Array(50_000).map((_, i) => Math.sin(i / 7));
		const p = computePeaks([x], 6);
		const q = decodePeaks(encodePeaks(p))!;
		expect(q.length).toBe(p.length);
		expect(q.levels.map((l) => [l.size, Array.from(l.data)])).toEqual(
			p.levels.map((l) => [l.size, Array.from(l.data)])
		);
	});
	it('rejects other data', () => {
		expect(decodePeaks(new ArrayBuffer(16))).toBeNull();
	});
});
