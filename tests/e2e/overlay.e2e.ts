import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { FIXTURES, loadFixture } from './helpers';

test.describe('overlay, empty and error states', () => {
	test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium');

	test('? opens the shortcuts overlay; Esc and click outside close it', async ({ page }) => {
		await page.goto('/?test');
		const overlay = page.getByTestId('shortcuts');
		await expect(overlay).toBeHidden();
		await page.keyboard.press('?');
		await expect(overlay).toBeVisible();
		await expect(page.getByRole('dialog')).toContainText('Play / pause');
		await page.keyboard.press('Escape');
		await expect(overlay).toBeHidden();
		await page.keyboard.press('?');
		await expect(overlay).toBeVisible();
		await page.mouse.click(10, 400);
		await expect(overlay).toBeHidden();
	});

	test('shortcuts are suspended while a text field has focus', async ({ page }) => {
		await page.goto('/?test');
		await loadFixture(page, 'sine-440-48000.wav');
		await page.evaluate(() => window.looper.setLoopRange(48000, 96000, true));
		await page.getByTestId('loop-in').click();
		await page.keyboard.type('l');
		expect(await page.evaluate(() => window.looper.loop.on)).toBe(true);
		await page.keyboard.press('Escape');
		await page.keyboard.press('l');
		expect(await page.evaluate(() => window.looper.loop.on)).toBe(false);
	});

	test('empty state and unsupported files', async ({ page }) => {
		await page.goto('/?test');
		await expect(page.getByText('Drop a track or press ⌘O')).toBeVisible();
		await expect(page.getByTestId('position')).toHaveText('—');
		await page.locator('[data-testid=picker]').setInputFiles(join(FIXTURES, '..', 'robots.txt'));
		await expect(page.getByTestId('error')).toHaveText('Unsupported file');
		await expect(page.getByRole('dialog')).toBeHidden();
	});
});
