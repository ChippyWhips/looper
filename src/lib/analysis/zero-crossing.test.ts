import { describe, expect, it } from 'vitest';
import { nearestZeroCrossing } from './zero-crossing';

const SR = 48000;
const R = Math.round(0.002 * SR);

function sine(n: number, hz: number, amp = 0.5, dc = 0, phase = 0) {
	const x = new Float32Array(n);
	for (let i = 0; i < n; i++) x[i] = dc + amp * Math.sin((2 * Math.PI * hz * i) / SR + phase);
	return x;
}

describe('zero crossings', () => {
	it('silence: the frame itself', () => {
		expect(nearestZeroCrossing(new Float32Array(SR), 12345, R)).toBe(12345);
	});

	it('pure sine: nearest crossing, within half a sample of the analytic zero', () => {
		const x = sine(SR, 440, 0.5, 0, 0.3);
		for (const f of [1000, 5000, 20000, 33333]) {
			const z = nearestZeroCrossing(x, f, R)!;
			expect(z).not.toBeNull();
			expect(Math.abs(z - f)).toBeLessThanOrEqual(R);
			// Analytic zeros at t where 2π·440·t + 0.3 = kπ.
			const k = Math.round(((2 * Math.PI * 440 * z) / SR + 0.3) / Math.PI);
			const exact = ((k * Math.PI - 0.3) * SR) / (2 * Math.PI * 440);
			expect(Math.abs(z - exact)).toBeLessThanOrEqual(0.5);
			// Nearest: no crossing strictly closer exists.
			const half = SR / 440 / 2;
			expect(Math.abs(z - f)).toBeLessThanOrEqual(half / 2 + 1);
		}
	});

	it('DC offset: crossings of the signal about its DC level', () => {
		const x = sine(SR, 440, 0.4, 0.3);
		const z = nearestZeroCrossing(x, 10000, R)!;
		expect(Math.abs(x[z] - 0.3)).toBeLessThan(0.4 * Math.sin((Math.PI * 440) / SR) + 1e-3);
	});

	it('constant DC with no AC: no crossing', () => {
		expect(nearestZeroCrossing(new Float32Array(SR).fill(0.3), 1000, R)).toBeNull();
	});

	it('directional search never returns the starting frame', () => {
		const x = sine(SR, 440);
		const z0 = nearestZeroCrossing(x, 10000, R)!;
		const next = nearestZeroCrossing(x, z0, R, 1)!;
		const prev = nearestZeroCrossing(x, z0, R, -1)!;
		expect(next).toBeGreaterThan(z0);
		expect(prev).toBeLessThan(z0);
	});
});
