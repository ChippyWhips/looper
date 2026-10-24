import { test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { FIXTURES, PHASE, loadFixture } from './helpers';

const SIZES = [
	{ width: 1280, height: 800 },
	{ width: 1512, height: 982 }
];

type State = { name: string; setup: (page: Page) => Promise<void> };

const STATES: State[] = [
	{
		name: 'empty',
		setup: async (page) => {
			await page.goto('/?test');
			await page.waitForTimeout(700);
		}
	},
	{
		name: 'loaded',
		setup: async (page) => {
			await page.goto('/?test');
			await loadFixture(page, 'song-44100.mp3');
			await page.waitForTimeout(900);
		}
	},
	{
		name: 'loop-on',
		setup: async (page) => {
			await page.goto('/?test');
			await loadFixture(page, 'song-44100.mp3');
			await page.evaluate(() => {
				const app = window.looper;
				const sr = app.track.sampleRate;
				app.setLoopRange(Math.round(42.118 * sr), Math.round(51.902 * sr), true);
				app.loop.selected = 'in';
				app.seek(Math.round(45.2 * sr));
				app.zoomToLoop();
				app.setSpeed(80);
				app.setPitch(-100);
			});
			await page.waitForFunction(() => window.looper.transport.tempo !== null, null, {
				timeout: 20000
			});
			await page.evaluate(() => (window.looper.transport.countIn = true));
			await page.waitForTimeout(900);
		}
	},
	{
		name: 'loop-off',
		setup: async (page) => {
			await page.goto('/?test');
			await loadFixture(page, 'song-44100.mp3');
			await page.evaluate(() => {
				const app = window.looper;
				const sr = app.track.sampleRate;
				app.setLoopRange(Math.round(42.118 * sr), Math.round(51.902 * sr), true);
				app.toggleLoop();
				app.seek(Math.round(60 * sr));
			});
			await page.waitForTimeout(900);
		}
	},
	{
		name: 'recent',
		setup: async (page) => {
			await page.goto('/?test');
			await loadFixture(page, 'click-120-44100.wav');
			await loadFixture(page, 'sine-1k-44100.wav');
			await loadFixture(page, 'song-44100.mp3');
			await page.getByTestId('title').click();
			await page.getByRole('menuitem').nth(1).hover();
			await page.waitForTimeout(700);
		}
	},
	{
		name: 'shortcuts',
		setup: async (page) => {
			await page.goto('/?test');
			await loadFixture(page, 'song-44100.mp3');
			await page.keyboard.press('?');
			await page.waitForTimeout(700);
		}
	},
	{
		name: 'error',
		setup: async (page) => {
			await page.goto('/?test');
			await page.locator('[data-testid=picker]').setInputFiles(join(FIXTURES, '..', 'robots.txt'));
			await page.waitForTimeout(700);
		}
	},
	{
		name: 'drop',
		setup: async (page) => {
			await page.goto('/?test');
			await page.waitForFunction(() => !!window.looper);
			await page.evaluate(() => (window.looper.view.dropActive = true));
			await page.waitForTimeout(700);
		}
	},
	{
		name: 'sample-zoom',
		setup: async (page) => {
			await page.goto('/?test');
			await loadFixture(page, 'sine-440-48000.wav');
			await page.evaluate(() => {
				const app = window.looper;
				app.viewport.zoomAt(1e9, 0);
				app.viewport.setStart(1000);
			});
			await page.waitForTimeout(900);
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
