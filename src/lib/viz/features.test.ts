import { describe, expect, it } from 'vitest';
import { bandPower, Envelope, level, rms } from './features';

describe('visualiser features', () => {
	it('envelope attacks in ~40 ms and releases in ~300 ms', () => {
		const e = new Envelope(40, 300);
		e.step(1, 40);
		expect(e.value).toBeCloseTo(1 - Math.exp(-1), 6);
		const r = new Envelope(40, 300);
		r.value = 1;
		r.step(0, 300);
		expect(r.value).toBeCloseTo(Math.exp(-1), 6);
	});

	it('band power picks the right bins', () => {
		const db = new Float32Array(1024).fill(-120);
		const sr = 48000;
		const bin = Math.round(1000 / (sr / 2 / 1024));
		db[bin] = 0;
		expect(bandPower(db, sr, 250, 2000)).toBeGreaterThan(bandPower(db, sr, 20, 250) * 100);
	});

	it('level maps dB to 0..1', () => {
		expect(level(1, -60, 0)).toBe(1);
		expect(level(1e-6, -60, 0)).toBeCloseTo(0, 6);
		expect(level(1e-3, -60, 0)).toBeCloseTo(0.5, 6);
	});

	it('rms', () => {
		expect(rms(new Float32Array([1, -1, 1, -1]))).toBe(1);
	});
});
