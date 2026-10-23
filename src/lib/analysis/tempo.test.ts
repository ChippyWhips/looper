import { describe, expect, it } from 'vitest';
import { foldTempo, resampleLinear } from './tempo';

describe('tempo folding', () => {
	it('folds into 70–180 by doubling or halving', () => {
		expect(foldTempo(60)).toBe(120);
		expect(foldTempo(240)).toBe(120);
		expect(foldTempo(35)).toBe(70);
		expect(foldTempo(34)).toBe(136);
		expect(foldTempo(179.9)).toBe(179.9);
		expect(foldTempo(180)).toBe(90);
		expect(foldTempo(70)).toBe(70);
		expect(Number.isNaN(foldTempo(0))).toBe(true);
	});

	it('resamples length proportionally', () => {
		const x = new Float32Array(48000).fill(1);
		expect(resampleLinear(x, 48000, 44100).length).toBe(44100);
	});
});
