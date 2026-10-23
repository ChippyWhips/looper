import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers';

test('app loads without console errors @smoke', async ({ page }) => {
	const errors = watchErrors(page);
	await page.goto('/');
	await expect(page.getByTestId('deck')).toBeVisible();
	expect(errors).toEqual([]);
});
