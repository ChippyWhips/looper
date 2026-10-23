import { test, type Page } from '@playwright/test';
import { PHASE } from './helpers';

const SIZES = [
	{ width: 1280, height: 800 },
	{ width: 1512, height: 982 }
];

type State = { name: string; setup: (page: Page) => Promise<void> };

const STATES: State[] = [
	{
		name: 'empty',
		setup: async (page) => {
			await page.goto('/');
			await page.waitForTimeout(300);
		}
	}
];

test.describe('screenshots @shots', () => {
	test.skip(({ browserName }) => browserName !== 'chromium', 'screenshots in Chromium');
	for (const size of SIZES) {
		for (const s of STATES) {
			test(`${s.name} ${size.width}x${size.height}`, async ({ page }) => {
				await page.setViewportSize(size);
				await s.setup(page);
				await page.screenshot({
					path: `screenshots/phase-${PHASE}/${s.name}-${size.width}x${size.height}.png`
				});
			});
		}
	}
});
