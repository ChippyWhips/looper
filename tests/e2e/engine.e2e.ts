import { expect, test, type Page } from '@playwright/test';
import type { HarnessRender } from '../../src/lib/audio/harness';

test.describe('audio engine (real worklet, OfflineAudioContext) @audio', () => {
	test.skip(({ browserName }) => browserName !== 'chromium', 'audio tests run in Chromium');

	async function open(page: Page) {
		await page.goto('/harness');
		await page.waitForSelector('main[data-ready="true"]', { state: 'attached' });
	}

	for (const sr of [44100, 48000]) {
		test(`wrap lands within ±1 frame at rate 1.0, pitch 0 (${sr} Hz)`, async ({ page }) => {
			await open(page);
			const beat = sr / 2;
			const loopStart = beat * 2 - Math.round(sr / 100);
			const loopLen = Math.round(sr * 1.875);
			const r = await page.evaluate(
				async ({ o, loopLen, beat }) => {
					const h = window.looperHarness;
					const out = await h.render(o);
					const on = h.measure.onsets(out, 0.1, Math.round(beat / 12));
					return { on, loopLen };
				},
				{
					o: {
						fixture: `/fixtures/click-120-${sr}.wav`,
						sampleRate: sr,
						seconds: 12,
						setup: [
							{ type: 'loop', start: loopStart, end: loopStart + loopLen, on: true },
							{ type: 'play', from: loopStart, countInBpm: null }
						]
					} satisfies HarnessRender,
					loopLen,
					beat
				}
			);
			// Each cycle has clicks at offsets 10 ms + k·beat for k = 0..3.
			const firsts = r.on.filter((_, i) => i % 4 === 0);
			expect(firsts.length).toBeGreaterThan(4);
			for (let k = 1; k < firsts.length; k++) {
				expect(Math.abs(firsts[k] - firsts[k - 1] - loopLen)).toBeLessThanOrEqual(1);
			}
			for (let k = 0; k + 3 < r.on.length; k += 4) expect(r.on[k + 3] - r.on[k]).toBe(beat * 3);
		});
	}

	for (const rate of [0.5, 0.75]) {
		test(`cycle length = loopLength / rate ±1 ms at rate ${rate}`, async ({ page }) => {
			await open(page);
			const sr = 48000;
			const loopStart = 48000 - 480;
			const loopLen = 90000;
			const ms = await page.evaluate(
				async ({ o, loopLen, rate, sr }) => {
					const h = window.looperHarness;
					const out = await h.render(o);
					const on = h.measure
						.onsets(out, 0.1, 4000)
						.map((x) => h.measure.centroid(out, x - 2000, x + 4000));
					const firsts = on.filter((_, i) => i % 4 === 0);
					const d: number[] = [];
					for (let k = 1; k < firsts.length; k++)
						d.push(((firsts[k] - firsts[k - 1] - loopLen / rate) / sr) * 1000);
					return d;
				},
				{
					o: {
						fixture: `/fixtures/click-120-${sr}.wav`,
						sampleRate: sr,
						seconds: 2 + (loopLen / rate / sr) * 5,
						setup: [
							{ type: 'params', speed: rate, cents: 0 },
							{ type: 'loop', start: loopStart, end: loopStart + loopLen, on: true },
							{ type: 'play', from: loopStart, countInBpm: null }
						]
					} satisfies HarnessRender,
					loopLen,
					rate,
					sr
				}
			);
			expect(ms.length).toBeGreaterThan(3);
			for (const d of ms) expect(Math.abs(d)).toBeLessThanOrEqual(1);
		});
	}

	for (const rate of [1, 0.5]) {
		test(`no wrap jump exceeds the natural slope by >10% (rate ${rate})`, async ({ page }) => {
			await open(page);
			const sr = 48000;
			const r = await page.evaluate(
				async ({ o, start }) => {
					const h = window.looperHarness;
					const src = await (await fetch(o.fixture)).arrayBuffer();
					const buf = await new OfflineAudioContext(1, 1, o.sampleRate).decodeAudioData(src);
					const natural = h.measure.maxJump(buf.getChannelData(0));
					const out = await h.render(o);
					// Skip the start-of-playback fade and stretcher warm-up.
					return { natural, wrap: h.measure.maxJump(out, Math.round(o.sampleRate * 0.5)), start };
				},
				{
					o: {
						fixture: `/fixtures/sine-440-${sr}.wav`,
						sampleRate: sr,
						seconds: 6,
						setup: [
							{ type: 'params', speed: rate, cents: 0 },
							{ type: 'loop', start: 12345, end: 12345 + 40037, on: true },
							{ type: 'play', from: 12345, countInBpm: null }
						]
					} satisfies HarnessRender,
					start: 12345
				}
			);
			expect(r.wrap).toBeLessThanOrEqual(r.natural * 1.1);
		});
	}

	test('1 kHz at 50 % measures 1 kHz ±1 ct', async ({ page }) => {
		await open(page);
		const c = await page.evaluate(
			async (o) => {
				const h = window.looperHarness;
				const out = await h.render(o);
				const f = h.measure.peakFrequency(
					out.subarray(o.sampleRate, o.sampleRate * 5),
					o.sampleRate,
					900,
					1100
				);
				return h.measure.cents(f, 1000);
			},
			{
				fixture: '/fixtures/sine-1k-48000.wav',
				sampleRate: 48000,
				seconds: 6,
				setup: [
					{ type: 'params', speed: 0.5, cents: 0 },
					{ type: 'play', from: 0, countInBpm: null }
				]
			} satisfies HarnessRender
		);
		expect(Math.abs(c)).toBeLessThan(1);
	});

	for (const speed of [1, 0.5]) {
		test(`440 Hz at −100 ct measures 415.3 Hz ±1 ct at ${speed * 100}%`, async ({ page }) => {
			await open(page);
			const c = await page.evaluate(
				async (o) => {
					const h = window.looperHarness;
					const out = await h.render(o);
					const f = h.measure.peakFrequency(
						out.subarray(o.sampleRate, o.sampleRate * 5),
						o.sampleRate,
						380,
						460
					);
					return h.measure.cents(f, 440 * Math.pow(2, -1 / 12));
				},
				{
					fixture: '/fixtures/sine-440-48000.wav',
					sampleRate: 48000,
					seconds: 6,
					setup: [
						{ type: 'params', speed, cents: -100 },
						{ type: 'play', from: 0, countInBpm: null }
					]
				} satisfies HarnessRender
			);
			expect(Math.abs(c)).toBeLessThan(1);
		});
	}

	for (const speed of [1, 0.5]) {
		test(`count-in clicks 60/(BPM·speed) apart; audio one beat after the 4th (${speed})`, async ({
			page
		}) => {
			await open(page);
			const sr = 48000;
			const bpm = 120;
			const on = await page.evaluate(
				async (o) => {
					const h = window.looperHarness;
					const out = await h.render(o);
					return h.measure.onsets(out, 0.005, 1000);
				},
				{
					fixture: `/fixtures/sine-440-${sr}.wav`,
					sampleRate: sr,
					seconds: 6,
					setup: [
						{ type: 'params', speed, cents: 0 },
						{ type: 'play', from: 0, countInBpm: bpm }
					]
				} satisfies HarnessRender
			);
			const beat = (60 / (bpm * speed)) * sr;
			const tol = sr / 1000;
			expect(on.length).toBeGreaterThanOrEqual(5);
			for (let k = 1; k < 4; k++)
				expect(Math.abs(on[k] - on[0] - k * beat)).toBeLessThanOrEqual(tol);
			expect(Math.abs(on[4] - on[3] - beat)).toBeLessThanOrEqual(tol);
		});
	}
});
