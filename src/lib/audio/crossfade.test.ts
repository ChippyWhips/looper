import { describe, expect, it } from 'vitest';
import { correlatedGains, correlation, fadeIn, fadeOut } from './crossfade';

describe('crossfade', () => {
	it('equal-power curves sum to unit power', () => {
		for (let t = 0; t <= 1; t += 0.01) expect(fadeIn(t) ** 2 + fadeOut(t) ** 2).toBeCloseTo(1, 12);
		expect(fadeIn(0)).toBe(0);
		expect(fadeOut(1)).toBeCloseTo(0, 12);
	});

	for (const r of [0, 0.3, 0.7, 1]) {
		it(`correlated gains preserve power at r=${r}`, () => {
			for (let t = 0; t <= 1; t += 0.01) {
				const [o, i] = correlatedGains(t, r);
				expect(i * i + o * o + 2 * r * i * o).toBeCloseTo(1, 9);
			}
			const [o0, i0] = correlatedGains(0, r);
			const [o1, i1] = correlatedGains(1, r);
			expect(o0).toBeCloseTo(1, 9);
			expect(i0).toBeCloseTo(0, 9);
			expect(o1).toBeCloseTo(0, 9);
			expect(i1).toBeCloseTo(1, 9);
		});
	}

	it('r = 0 is the equal-power fade and r = 1 is linear at the midpoint', () => {
		expect(correlatedGains(0.5, 0)[1]).toBeCloseTo(Math.SQRT1_2, 9);
		expect(correlatedGains(0.5, 1)[1]).toBeCloseTo(0.5, 9);
	});

	it('measures correlation', () => {
		const s = (i: number) => Math.sin(i / 5);
		expect(correlation(s, s, 500)).toBeCloseTo(1, 9);
		expect(correlation(s, (i) => -s(i), 500)).toBeCloseTo(-1, 9);
		expect(correlation(s, () => 0, 500)).toBe(0);
	});
});
