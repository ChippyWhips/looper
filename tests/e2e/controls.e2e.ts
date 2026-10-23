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
		expect(await cents(page)).toBe(-1);
		await page.keyboard.press('Shift+ArrowDown');
		expect(await cents(page)).toBe(-11);
		await knob.dblclick();
		expect(await cents(page)).toBe(0);
		await page.getByRole('button', { name: '−100' }).click();
		expect(await cents(page)).toBe(-100);
		await expect(page.getByTestId('pitch-value')).toHaveText('−100 ct');
		await page.getByTestId('pitch-value').click();
		await page.getByLabel('Pitch cents').fill('−250');
		await page.getByLabel('Pitch cents').press('Enter');
		expect(await cents(page)).toBe(-250);
		// Drag up from 0 holds at the centre detent for 6 px.
		await knob.dblclick();
		const b = (await knob.boundingBox())!;
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
		await page.mouse.down();
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 5);
		expect(await cents(page)).toBe(0);
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 6 - 40);
		await page.mouse.up();
		expect(await cents(page)).toBe(10);
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
		await page.keyboard.press(' ');
		// Typed tempo overrides detection.
		await page.getByTestId('tempo').click();
		await page.getByLabel('Tempo').fill('96.5');
		await page.getByLabel('Tempo').press('Enter');
		expect(await page.evaluate(() => window.looper.transport.tempo)).toBe(96.5);
	});
});
