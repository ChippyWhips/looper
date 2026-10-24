import { describe, expect, it } from 'vitest';
import { centroid, cents, maxJump, onsets, peakFrequency } from './measure';
import { renderCore } from './test-render';
import type { ToWorklet } from './protocol';

const SR = 48000;

function clickTrack(seconds: number, bpm = 120): Float32Array {
	const x = new Float32Array(seconds * SR);
	const beat = (60 / bpm) * SR;
	for (let b = 0; b * beat < x.length; b++) {
		const s = Math.round(b * beat);
		for (let i = 0; i < 1440 && s + i < x.length; i++) {
			x[s + i] = 0.8 * Math.cos((2 * Math.PI * 1500 * i) / SR) * Math.exp(-i / 192);
		}
	}
	return x;
}

function sine(seconds: number, hz: number, amp = 0.5): Float32Array {
	const x = new Float32Array(seconds * SR);
	for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
	return x;
}

describe('loop wrap', () => {
	const track = clickTrack(10);
	const loopStart = 48000 - 480;
	const loopLen = 90000;
	const loopEnd = loopStart + loopLen;

	it('lands within ±1 frame at rate 1.0, pitch 0', async () => {
		const { out } = await renderCore({
			sampleRate: SR,
			channels: [track, track],
			frames: SR * 12,
			setup: [
				{ type: 'loop', start: loopStart, end: loopEnd, on: true },
				{ type: 'play', from: loopStart, countInBpm: null }
			]
		});
		const on = onsets(out, 0.1, 2000);
		// Each cycle holds clicks at source offsets 480, 24480, 48480, 72480.
		const firsts = on.filter((_, i) => i % 4 === 0);
		expect(firsts.length).toBeGreaterThan(4);
		for (let k = 1; k < firsts.length; k++) {
			expect(Math.abs(firsts[k] - firsts[k - 1] - loopLen)).toBeLessThanOrEqual(1);
		}
		for (let k = 0; k + 3 < on.length; k += 4) {
			expect(on[k + 1] - on[k]).toBe(24000);
			expect(on[k + 3] - on[k]).toBe(72000);
		}
	});

	for (const rate of [0.5, 0.75]) {
		it(`cycle length is loopLength / rate within ±1 ms at rate ${rate}`, async () => {
			const { out } = await renderCore({
				sampleRate: SR,
				channels: [track, track],
				frames: Math.round((SR * 2 + (loopLen / rate) * 5) / 128) * 128,
				setup: [
					{ type: 'params', speed: rate, cents: 0 },
					{ type: 'loop', start: loopStart, end: loopEnd, on: true },
					{ type: 'play', from: loopStart, countInBpm: null }
				]
			});
			// Stretched clicks smear, so time each by its energy centroid.
			const on = onsets(out, 0.1, 4000).map((o) => centroid(out, o - 2000, o + 4000));
			const firsts = on.filter((_, i) => i % 4 === 0);
			expect(firsts.length).toBeGreaterThan(3);
			for (let k = 1; k < firsts.length; k++) {
				const ms = ((firsts[k] - firsts[k - 1] - loopLen / rate) / SR) * 1000;
				expect(Math.abs(ms)).toBeLessThanOrEqual(1);
			}
		});
	}

	it('wraps without clicks on a sine looped at arbitrary points', async () => {
		const x = sine(4, 440);
		const natural = maxJump(x);
		const start = 12345;
		const end = 12345 + 40000 + 37;
		const { out } = await renderCore({
			sampleRate: SR,
			channels: [x, x],
			frames: SR * 4,
			setup: [
				{ type: 'loop', start, end, on: true },
				{ type: 'play', from: start, countInBpm: null }
			]
		});
		// Skip the initial fade-in; compare everywhere after.
		expect(maxJump(out, 12000)).toBeLessThanOrEqual(natural * 1.1);
	});
});

describe('pitch and speed', () => {
	it('1 kHz at 50 % stays 1 kHz ±1 ct', async () => {
		const x = sine(6, 1000);
		const { out } = await renderCore({
			sampleRate: SR,
			channels: [x, x],
			frames: SR * 6,
			setup: [
				{ type: 'params', speed: 0.5, cents: 0 },
				{ type: 'play', from: 0, countInBpm: null }
			]
		});
		const f = peakFrequency(out.subarray(SR, SR * 5), SR, 900, 1100);
		expect(Math.abs(cents(f, 1000))).toBeLessThan(1);
	});

	for (const speed of [1, 0.5]) {
		it(`440 Hz at −100 ct is 415.3 Hz ±1 ct at speed ${speed}`, async () => {
			const x = sine(6, 440);
			const { out } = await renderCore({
				sampleRate: SR,
				channels: [x, x],
				frames: SR * 6,
				setup: [
					{ type: 'params', speed, cents: -100 },
					{ type: 'play', from: 0, countInBpm: null }
				]
			});
			const f = peakFrequency(out.subarray(SR, SR * 5), SR, 380, 460);
			expect(Math.abs(cents(f, 440 * Math.pow(2, -1 / 12)))).toBeLessThan(1);
		});
	}
});

describe('count-in', () => {
	for (const speed of [1, 0.5]) {
		it(`clicks are 60/(bpm·speed) apart and audio starts one beat after the 4th at speed ${speed}`, async () => {
			const x = sine(8, 440);
			const bpm = 120;
			const { out } = await renderCore({
				sampleRate: SR,
				channels: [x, x],
				frames: SR * 6,
				setup: [
					{ type: 'params', speed, cents: 0 },
					{ type: 'play', from: 0, countInBpm: bpm }
				]
			});
			const beat = (60 / (bpm * speed)) * SR;
			const on = onsets(out, 0.005, 1000);
			expect(on.length).toBeGreaterThanOrEqual(5);
			const tol = SR / 1000;
			for (let k = 1; k < 4; k++)
				expect(Math.abs(on[k] - on[0] - k * beat)).toBeLessThanOrEqual(tol);
			expect(Math.abs(on[4] - on[3] - beat)).toBeLessThanOrEqual(tol);
		});
	}
});

describe('mix vs stems', () => {
	it('loop, speed, pitch and count-in render the same from stems that sum to the mix', async () => {
		// Quantise the mix to 16-bit steps so 16-bit stems can sum to it exactly.
		const base = sine(3, 440, 0.5);
		const q = (x: number) => Math.round(x * 32768) / 32768;
		const mix = base.map(q);
		const a = new Int16Array(mix.length);
		const b = new Int16Array(mix.length);
		for (let i = 0; i < mix.length; i++) {
			const v = Math.round(mix[i] * 32768);
			a[i] = Math.round(v * 0.7);
			b[i] = v - a[i];
		}
		const silent = new Int16Array(mix.length);
		const common = [
			{ type: 'params', speed: 0.75, cents: -100 },
			{ type: 'loop', start: 10000, end: 50000, on: true },
			{ type: 'play', from: 10000, countInBpm: 120 }
		] as const;
		const stems: ToWorklet = {
			type: 'addSources',
			sources: [
				{
					id: 'a',
					kind: 'stem',
					label: 'A',
					channels: [a, a],
					gain: 1,
					muted: false,
					soloed: false
				},
				{
					id: 'b',
					kind: 'stem',
					label: 'B',
					channels: [b, b],
					gain: 1,
					muted: false,
					soloed: false
				},
				{
					id: 's',
					kind: 'stem',
					label: 'S',
					channels: [silent, silent],
					gain: 1,
					muted: false,
					soloed: false
				}
			]
		};
		const fromMix = await renderCore({
			sampleRate: SR,
			channels: [mix, mix],
			frames: SR * 5,
			setup: [...common]
		});
		const fromStems = await renderCore({
			sampleRate: SR,
			channels: [mix, mix],
			frames: SR * 5,
			setup: [
				stems,
				// Muting the silent stem switches playback to the stem sum before play starts.
				{
					type: 'sources',
					states: [{ id: 's', kind: 'stem', label: 'S', gain: 1, muted: true, soloed: false }]
				},
				...common
			]
		});
		let maxDiff = 0;
		for (let i = 0; i < fromMix.out.length; i++)
			maxDiff = Math.max(maxDiff, Math.abs(fromMix.out[i] - fromStems.out[i]));
		expect(maxDiff).toBeLessThan(1e-4);
		// And it is not trivially silent.
		expect(Math.max(...fromStems.out.subarray(SR * 3, SR * 4))).toBeGreaterThan(0.3);
	});
});
