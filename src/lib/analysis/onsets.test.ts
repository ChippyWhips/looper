import { describe, expect, it } from 'vitest';
import { FFT } from './fft';
import { detectOnsets } from './onsets';

const SR = 48000;

describe('fft', () => {
	it('finds a bin-centred tone', () => {
		const f = new FFT(256);
		const re = new Float64Array(256);
		const im = new Float64Array(256);
		for (let i = 0; i < 256; i++) re[i] = Math.cos((2 * Math.PI * 10 * i) / 256);
		f.transform(re, im);
		expect(re[10]).toBeCloseTo(128, 6);
		expect(Math.abs(re[11])).toBeLessThan(1e-9);
	});
});

describe('onsets', () => {
	it('finds every click of a click track to within 1 ms', () => {
		const x = new Float32Array(SR * 6);
		const starts: number[] = [];
		for (let b = 0; b < 12; b++) {
			const s = Math.round(b * 0.5 * SR) + 1000;
			starts.push(s);
			for (let i = 0; i < 1440; i++)
				x[s + i] = 0.8 * Math.cos((2 * Math.PI * 1500 * i) / SR) * Math.exp(-i / 192);
		}
		const on = Array.from(detectOnsets(x, SR));
		expect(on.length).toBe(starts.length);
		for (let k = 0; k < starts.length; k++)
			expect(Math.abs(on[k] - starts[k])).toBeLessThanOrEqual(48);
	});

	it('finds nothing in a steady 16-bit sine', () => {
		const x = new Float32Array(SR * 5);
		for (let i = 0; i < x.length; i++)
			x[i] = Math.round(0.5 * Math.sin((2 * Math.PI * 440 * i) / SR) * 32767) / 32767;
		expect(detectOnsets(x, SR).length).toBe(0);
	});

	it('finds nothing in silence', () => {
		expect(detectOnsets(new Float32Array(SR), SR).length).toBe(0);
	});
});
