import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { FIXTURES } from './helpers';

test.describe('performance budgets @perf', () => {
	test.skip(({ browserName }) => browserName !== 'chromium', 'traces in Chromium');

	test('5-minute MP3: playable < 1.5 s, no main-thread task > 50 ms during load', async ({
		page
	}) => {
		await page.goto('/?test');
		await expect.poll(() => page.evaluate(() => window.looper?.engine.warm ?? false)).toBe(true);
		await page.waitForTimeout(300);
		await page.evaluate(() => {
			const w = window as unknown as { __long: number[] };
			w.__long = [];
			new PerformanceObserver((list) => {
				for (const e of list.getEntries()) w.__long.push(e.duration);
			}).observe({ type: 'longtask', buffered: false });
		});
		await page.locator('[data-testid=picker]').setInputFiles(join(FIXTURES, 'song-44100.mp3'));
		await expect
			.poll(() => page.evaluate(() => !!window.looper.track.mono), { timeout: 20000 })
			.toBe(true);
		await page.waitForTimeout(500);
		const r = await page.evaluate(() => ({
			openMs: window.looper.lastOpenMs,
			long: (window as unknown as { __long: number[] }).__long
		}));
		console.log(`load-to-playable ${r.openMs.toFixed(0)} ms; long tasks ${JSON.stringify(r.long)}`);
		expect(r.openMs).toBeLessThan(1500);
		expect(Math.max(0, ...r.long)).toBeLessThanOrEqual(50);
	});

	test('zooming fit → max holds 60 fps on a 5-minute track', async ({ page }) => {
		await page.goto('/?test');
		await page.locator('[data-testid=picker]').setInputFiles(join(FIXTURES, 'song-44100.wav'));
		await expect
			.poll(() => page.evaluate(() => !!window.looper.track.mono), { timeout: 20000 })
			.toBe(true);
		const frames = await page.evaluate(
			() =>
				new Promise<number[]>((resolve) => {
					const app = window.looper;
					const vp = app.viewport;
					vp.fit();
					const steps = 180;
					const total = Math.log(vp.fitFpp / vp.minFpp);
					const times: number[] = [];
					let i = 0;
					const tick = (t: number) => {
						times.push(t);
						if (i++ >= steps) return resolve(times);
						vp.zoomAt(Math.exp(total / steps), vp.width * 0.37);
						requestAnimationFrame(tick);
					};
					requestAnimationFrame(tick);
				})
		);
		const dts = frames.slice(1).map((t, i) => t - frames[i]);
		dts.sort((a, b) => a - b);
		const p95 = dts[Math.floor(dts.length * 0.95)];
		const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
		console.log(`zoom: mean ${mean.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`);
		expect(1000 / mean).toBeGreaterThanOrEqual(58);
		expect(p95).toBeLessThan(20);
	});
});
