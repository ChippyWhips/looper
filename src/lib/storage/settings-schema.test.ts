import { describe, expect, it } from 'vitest';
import { defaultSettings, migrate, rescale } from './settings-schema';

describe('settings schema', () => {
	it('round-trips v1 and keeps stems absent', () => {
		const s = { ...defaultSettings(48000), loop: { start: 10, end: 20, on: true }, speed: 80 };
		const m = migrate(JSON.parse(JSON.stringify(s)))!;
		expect(m).toEqual(s);
		expect('stems' in m).toBe(false);
	});

	it('rejects garbage and unknown future versions', () => {
		expect(migrate(null)).toBeNull();
		expect(migrate({ version: 2 })).toBeNull();
		expect(migrate({ version: 1, sampleRate: 48000, loop: { start: 1.5, end: 2 } })).toBeNull();
	});

	it('runs the migration hook from older versions', () => {
		const v0 = { version: 0, rate: 44100, inFrame: 5, outFrame: 9 };
		const m = migrate(v0, {
			0: (r) => ({
				version: 1,
				sampleRate: r.rate,
				loop: { start: r.inFrame, end: r.outFrame, on: false }
			})
		})!;
		expect(m.loop).toEqual({ start: 5, end: 9, on: false });
		expect(m.speed).toBe(100);
	});

	it('rescales frames to a new sample rate', () => {
		const s = {
			...defaultSettings(44100),
			loop: { start: 44100, end: 88200, on: true },
			position: 22050
		};
		const r = rescale(s, 48000);
		expect(r.loop).toEqual({ start: 48000, end: 96000, on: true });
		expect(r.position).toBe(24000);
	});
});
