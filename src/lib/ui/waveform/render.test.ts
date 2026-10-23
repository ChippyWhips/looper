import { describe, expect, it } from 'vitest';
import { rulerStep } from './render';

describe('ruler steps', () => {
	const sr = 48000;
	it('uses minutes and seconds when zoomed out', () => {
		expect(rulerStep(14_400_000 / 1280, sr)).toEqual({ frames: 30 * sr, samples: false });
	});
	it('reaches milliseconds', () => {
		expect(rulerStep(1, sr).samples).toBe(false);
		expect(rulerStep(1, sr).frames).toBeCloseTo(0.002 * sr);
	});
	it('switches to sample numbers at the deepest zoom', () => {
		expect(rulerStep(1 / 16, sr)).toEqual({ frames: 5, samples: true });
	});
});
