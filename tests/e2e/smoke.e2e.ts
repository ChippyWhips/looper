import { expect, test } from '@playwright/test';
import { loadFixture, watchErrors } from './helpers';

test('app loads without console errors @smoke', async ({ page }) => {
	const errors = watchErrors(page);
	await page.goto('/');
	await expect(page.getByTestId('deck')).toBeVisible();
	expect(errors).toEqual([]);
});

test('app: load a fixture, play, set a loop, change speed without console errors @smoke', async ({
	page
}) => {
	const errors = watchErrors(page);
	await page.goto('/?test');
	await loadFixture(page, 'sine-440-44100.wav');
	await page.keyboard.press(' ');
	await expect
		.poll(() => page.evaluate(() => window.looper.position()), { timeout: 5000 })
		.toBeGreaterThan(0);
	const main = page.getByTestId('wave-main');
	const box = (await main.boundingBox())!;
	await page.mouse.move(box.x + 300, box.y + 100);
	await page.mouse.down();
	await page.mouse.move(box.x + 600, box.y + 100, { steps: 4 });
	await page.mouse.up();
	expect(await page.evaluate(() => window.looper.loop.on)).toBe(true);
	await page.keyboard.press(',');
	await page.keyboard.press(',');
	expect(await page.evaluate(() => window.looper.transport.speed)).toBe(80);
	await page.waitForTimeout(1000);
	await page.keyboard.press(' ');
	expect(errors).toEqual([]);
});
