import { expect, test } from '@playwright/test';
import { loadFixture } from './helpers';

const frames = (page: import('@playwright/test').Page) =>
	page.evaluate(() => (window as unknown as { __vizFrames?: number }).__vizFrames ?? 0);

test.describe('visualiser @perf', () => {
	test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium');

	test('runs at 60 fps while playing and ~10 fps paused', async ({ page }) => {
		await page.goto('/?test');
		await loadFixture(page, 'song-44100.wav');
		await page.waitForTimeout(500);
		const p0 = await frames(page);
		await page.waitForTimeout(2000);
		const pausedFps = ((await frames(page)) - p0) / 2;
		await page.keyboard.press(' ');
		await expect.poll(() => page.evaluate(() => window.looper.transport.state)).toBe('playing');
		await page.waitForTimeout(300);
		const dts = await page.evaluate(
			() =>
				new Promise<number[]>((resolve) => {
					const t: number[] = [];
					const f = (now: number) => {
						t.push(now);
						if (t.length > 120) resolve(t.slice(1).map((x, i) => x - t[i]));
						else requestAnimationFrame(f);
					};
					requestAnimationFrame(f);
				})
		);
		const v0 = await frames(page);
		await page.waitForTimeout(2000);
		const playingFps = ((await frames(page)) - v0) / 2;
		await page.keyboard.press(' ');
		const mean = dts.reduce((a, b) => a + b, 0) / dts.length;
		console.log(
			`viz: paused ${pausedFps} fps, playing ${playingFps} fps, page frame ${mean.toFixed(2)} ms`
		);
		expect(pausedFps).toBeGreaterThanOrEqual(8);
		expect(pausedFps).toBeLessThanOrEqual(11);
		expect(playingFps).toBeGreaterThanOrEqual(57);
		expect(playingFps).toBeLessThanOrEqual(61);
		expect(1000 / mean).toBeGreaterThanOrEqual(58);
	});

	test('reduced motion updates once a second', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/?test');
		await page.waitForTimeout(500);
		const a = await frames(page);
		await page.waitForTimeout(3000);
		const n = (await frames(page)) - a;
		expect(n).toBeGreaterThanOrEqual(2);
		expect(n).toBeLessThanOrEqual(4);
	});

	test('without WebGL2 a static frame is drawn', async ({ page }) => {
		await page.addInitScript(() => {
			const orig = HTMLCanvasElement.prototype.getContext;
			HTMLCanvasElement.prototype.getContext = function (
				this: HTMLCanvasElement,
				type: string,
				...rest: unknown[]
			) {
				if (type === 'webgl2') return null;
				return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
			} as typeof orig;
		});
		await page.goto('/?test');
		await page.waitForTimeout(300);
		const lit = await page.evaluate(() => {
			const c = document.querySelector<HTMLCanvasElement>('[data-testid=visualiser]')!;
			const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
			let red = 0;
			for (let i = 0; i < d.length; i += 4) if (d[i] > d[i + 2] + 10) red++;
			return red / (d.length / 4);
		});
		expect(lit).toBeGreaterThan(0.3);
	});
});
