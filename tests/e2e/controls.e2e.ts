import { expect, test } from '@playwright/test';
import { loadFixture } from './helpers';

test.describe('speed, pitch, tempo, count-in', () => {
	test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium');

	test.beforeEach(async ({ page }) => {
		await page.goto('/?test');
		await loadFixture(page, 'click-120-48000.wav');
	});

	const speed = (page: import('@playwright/test').Page) =>
		page.evaluate(() => window.looper.transport.speed);
	const cents = (page: import('@playwright/test').Page) =>
		page.evaluate(() => window.looper.transport.cents);

	test('speed keys, detent labels, typed value', async ({ page }) => {
		await page.keyboard.press(',');
		expect(await speed(page)).toBe(90);
		await page.keyboard.press(',');
		expect(await speed(page)).toBe(80);
		await page.keyboard.press('.');
		expect(await speed(page)).toBe(90);
		await page.keyboard.press('Shift+<');
		expect(await speed(page)).toBe(89);
		await page.getByRole('button', { name: '75', exact: true }).click();
		expect(await speed(page)).toBe(75);
		await page.getByTestId('speed-value').click();
		await page.getByLabel('Speed', { exact: true }).fill('63');
		await page.getByLabel('Speed', { exact: true }).press('Enter');
		expect(await speed(page)).toBe(63);
		// Dragging near a detent snaps to it.
		const slider = page.getByLabel('Speed slider');
		const box = (await slider.boundingBox())!;
		const x60 = await page.evaluate(() => {
			const el = document.querySelector('[aria-label="Speed slider"]')!;
			const lbl = [...el.parentElement!.querySelectorAll('button')].find(
				(b) => b.textContent === '60'
			)!;
			const r = lbl.getBoundingClientRect();
			return r.left + r.width / 2;
		});
		await page.mouse.move(x60 + 4, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.up();
		expect(await speed(page)).toBe(60);
	});

	test('pitch knob, typed value, quick values, reset', async ({ page }) => {
		const knob = page.getByTestId('knob');
		await knob.focus();
		await page.keyboard.press('ArrowDown');
		expect(await cents(page)).toBe(-100);
		await page.keyboard.press('Shift+ArrowDown');
		expect(await cents(page)).toBe(-101);
		// Off-grid: the next semitone step lands back on the grid.
		await page.keyboard.press('ArrowUp');
		expect(await cents(page)).toBe(-100);
		await knob.dblclick();
		expect(await cents(page)).toBe(0);
		await page.getByRole('button', { name: '\u221225' }).click();
		expect(await cents(page)).toBe(-25);
		await page.getByTestId('pitch-value').click();
		await page.getByLabel('Pitch cents').fill('\u2212250');
		await page.getByLabel('Pitch cents').press('Enter');
		expect(await cents(page)).toBe(-250);
		// Dragging moves one semitone per 10 px.
		await knob.dblclick();
		const b = (await knob.boundingBox())!;
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
		await page.mouse.down();
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 5);
		expect(await cents(page)).toBe(0);
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 31);
		await page.mouse.up();
		expect(await cents(page)).toBe(300);
		// Speed is unaffected by pitch.
		expect(await speed(page)).toBe(100);
	});

	test('tempo is detected as 120.0 and count-in plays four beats before audio', async ({
		page
	}) => {
		await expect(page.getByTestId('tempo')).toHaveText(/120\.0/, { timeout: 15000 });
		const bpm = await page.evaluate(() => window.looper.transport.tempo);
		expect(Math.abs(bpm! - 120)).toBeLessThanOrEqual(0.5);
		await page.keyboard.press('c');
		expect(await page.evaluate(() => window.looper.transport.countIn)).toBe(true);
		await page.keyboard.press(' ');
		await expect
			.poll(() => page.evaluate(() => window.looper.transport.state), { timeout: 2000 })
			.toBe('counting');
		await expect
			.poll(() => page.evaluate(() => window.looper.transport.state), { timeout: 4000 })
			.toBe('playing');
		// The dot keeps flashing on the beat during playback (a visual click).
		const samples = await page.evaluate(
			() =>
				new Promise<boolean[]>((resolve) => {
					const out: boolean[] = [];
					const id = setInterval(() => {
						out.push(window.looper.transport.beatLit);
						if (out.length >= 60) {
							clearInterval(id);
							resolve(out);
						}
					}, 25);
				})
		);
		const onsets = samples.filter((v, i) => v && !samples[i - 1]).length;
		expect(onsets).toBeGreaterThanOrEqual(2);
		expect(onsets).toBeLessThanOrEqual(4);
		await page.keyboard.press(' ');
		// Typed tempo overrides detection.
		await page.getByTestId('tempo').click();
		await page.getByLabel('Tempo').fill('96.5');
		await page.getByLabel('Tempo').press('Enter');
		expect(await page.evaluate(() => window.looper.transport.tempo)).toBe(96.5);
	});
});
