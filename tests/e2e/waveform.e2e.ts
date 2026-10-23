import { expect, test } from '@playwright/test';
import { PHASE, loadFixture } from './helpers';

test.describe('waveform', () => {
	test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium');

	test('max zoom on a 440 Hz sine shows individual sample dots', async ({ page }) => {
		await page.goto('/?test');
		await loadFixture(page, 'sine-440-48000.wav');
		await page.evaluate(() => {
			const vp = window.looper.viewport;
			vp.zoomAt(1e9, 0);
			vp.setStart(1000);
		});
		await page.waitForTimeout(300);
		const canvas = page.getByTestId('wave-main');
		await canvas.screenshot({ path: `screenshots/phase-${PHASE}/sample-dots.png` });
		const r = await page.evaluate(() => {
			const app = window.looper;
			const c = document.querySelector<HTMLCanvasElement>('[data-testid=wave-main]')!;
			const ctx = c.getContext('2d')!;
			const dpr = window.devicePixelRatio;
			const vp = app.viewport;
			const ch = app.track.channels![0];
			const H = c.height;
			const mid = Math.floor(H / 2);
			const half = (H / 2) * 0.92;
			let dots = 0;
			let checked = 0;
			for (let f = Math.ceil(vp.start) + 1; f < vp.end - 1; f++) {
				const x = Math.round(((f - vp.start) / vp.fpp) * dpr);
				const y = Math.round(mid - ch[f] * half);
				const d = ctx.getImageData(x - 1, y - 1, 2, 2).data;
				checked++;
				let lit = 0;
				for (let i = 0; i < 16; i += 4) if (d[i + 3] > 0 && d[i] > 20) lit++;
				if (lit === 4) dots++;
			}
			return { dots, checked, pxPerSample: 1 / vp.fpp };
		});
		expect(r.pxPerSample).toBeGreaterThanOrEqual(16);
		expect(r.checked).toBeGreaterThan(50);
		expect(r.dots).toBe(r.checked);
	});

	test('follow playhead pages the view; manual pan stops following until F', async ({ page }) => {
		await page.goto('/?test');
		await loadFixture(page, 'song-48000.wav');
		await page.keyboard.press('=');
		await page.keyboard.press('=');
		await page.keyboard.press('=');
		await page.keyboard.press('=');
		await page.keyboard.press('=');
		const before = await page.evaluate(() => window.looper.viewport.start);
		await page.evaluate(() => window.looper.play(window.looper.viewport.end - 2000));
		await expect
			.poll(() => page.evaluate(() => window.looper.viewport.start), { timeout: 5000 })
			.toBeGreaterThan(before);
		const paged = await page.evaluate(() => {
			const vp = window.looper.viewport;
			return { start: vp.start, ph: window.looper.position(), end: vp.end };
		});
		expect(paged.ph).toBeGreaterThanOrEqual(paged.start);
		expect(paged.ph).toBeLessThan(paged.end);
		await page.getByTestId('wave-main').hover();
		await page.mouse.wheel(400, 0);
		const panned = await page.evaluate(() => window.looper.view.wave.follow);
		expect(panned).toBe(false);
		await page.keyboard.press('f');
		expect(await page.evaluate(() => window.looper.view.wave.follow)).toBe(true);
		await page.keyboard.press(' ');
		await page.keyboard.press('0');
		expect(await page.evaluate(() => window.looper.viewport.isFit)).toBe(true);
	});
});
