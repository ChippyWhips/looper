import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { watchErrors } from './helpers';

const FIXTURES = join(import.meta.dirname, '..', '..', 'static', 'fixtures');

test('debug page: load, play, loop, speed without console errors @smoke', async ({ page }) => {
	const errors = watchErrors(page);
	await page.goto('/debug');
	await page.locator('input[type=file]').setInputFiles(join(FIXTURES, 'sine-440-44100.wav'));
	const play = page.getByRole('button', { name: 'Play' });
	await expect(play).toBeEnabled();
	await play.click();
	await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
	const readout = page.locator('span').first();
	await expect.poll(async () => readout.textContent(), { timeout: 5000 }).not.toBe('0:00.000');
	await page.getByLabel('In').fill('1');
	await page.getByLabel('Out').fill('2');
	await page.getByRole('button', { name: 'Loop off' }).click();
	await page.getByLabel('Speed').fill('75');
	await page.getByLabel('Pitch').fill('-100');
	await page.waitForTimeout(1500);
	await page.getByRole('button', { name: 'Pause' }).click();
	expect(errors).toEqual([]);
});
