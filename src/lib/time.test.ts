import { describe, expect, it } from 'vitest';
import {
	formatDuration,
	formatTime,
	msToFrames,
	parseNumber,
	parseTime,
	signed,
	framesToMs
} from './time';

describe('time formatting', () => {
	for (const sr of [44100, 48000]) {
		it(`typed m:ss.mmm round-trips through frames at ${sr} Hz`, () => {
			for (let ms = 0; ms < 400_000; ms += 7) {
				const text = formatTime(msToFrames(ms, sr), sr);
				expect(parseTime(text)).toBe(ms);
				expect(framesToMs(msToFrames(ms, sr), sr)).toBe(ms);
			}
		});
	}

	it('formats and parses', () => {
		expect(formatTime(48000 * 83.456, 48000)).toBe('1:23.456');
		expect(formatTime(0, 44100)).toBe('0:00.000');
		expect(formatDuration(44100 * 287.9, 44100)).toBe('4:47');
		expect(parseTime('1:23.456')).toBe(83456);
		expect(parseTime('23.4')).toBe(23400);
		expect(parseTime('2:5')).toBe(125000);
		expect(parseTime('1:75.000')).toBeNull();
		expect(parseTime('abc')).toBeNull();
	});

	it('uses the real minus sign', () => {
		expect(signed(-100)).toBe('−100');
		expect(signed(25)).toBe('+25');
		expect(signed(0)).toBe('0');
		expect(parseNumber('−100')).toBe(-100);
		expect(parseNumber('120.5')).toBe(120.5);
		expect(parseNumber('x')).toBeNull();
	});
});
