import { expect, test } from '@playwright/test';
import { loadFixture } from './helpers';

test('definition of done: MP3 opened, looped, 50 %, −100 ct, restored after reload', async ({
	page,
	browserName
}) => {
	test.skip(browserName !== 'chromium', 'Chromium');
	await page.goto('/?test');
	await loadFixture(page, 'song-44100.mp3');
	const main = page.getByTestId('wave-main');
	const box = (await main.boundingBox())!;
	await page.mouse.move(box.x + 300, box.y + 200);
	await page.mouse.down();
	await page.mouse.move(box.x + 420, box.y + 200, { steps: 5 });
	await page.mouse.up();
	await page.getByRole('button', { name: '50', exact: true }).click();
	await page.getByRole('button', { name: '−100' }).click();
	await page.keyboard.press('Enter');
	await page.waitForTimeout(1500);
	await page.keyboard.press(' ');
	const before = await page.evaluate(() => ({
		loop: {
			start: window.looper.loop.start,
			end: window.looper.loop.end,
			on: window.looper.loop.on
		},
		speed: window.looper.transport.speed,
		cents: window.looper.transport.cents
	}));
	expect(before.speed).toBe(50);
	expect(before.cents).toBe(-100);
	expect(before.loop.on).toBe(true);
	await page.waitForTimeout(800);
	await page.reload();
	await expect
		.poll(() => page.evaluate(() => window.looper?.track.loaded ?? false), { timeout: 15000 })
		.toBe(true);
	const after = await page.evaluate(() => ({
		loop: {
			start: window.looper.loop.start,
			end: window.looper.loop.end,
			on: window.looper.loop.on
		},
		speed: window.looper.transport.speed,
		cents: window.looper.transport.cents,
		name: window.looper.track.name
	}));
	expect(after.name).toBe('song-44100');
	expect(after.speed).toBe(50);
	expect(after.cents).toBe(-100);
	expect(after.loop.start).toBe(before.loop.start);
	expect(after.loop.end).toBe(before.loop.end);
	expect(after.loop.on).toBe(true);
	await expect(page.getByTestId('pitch-value')).toHaveText('−100 ct');
	await expect(page.getByTestId('speed-value')).toHaveText('50%');
});
