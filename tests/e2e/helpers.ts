import { expect, type ConsoleMessage, type Page } from '@playwright/test';
import { join } from 'node:path';
import type { App } from '../../src/lib/state/app.svelte';

declare global {
	interface Window {
		looper: App;
	}
}

export const FIXTURES = join(import.meta.dirname, '..', '..', 'static', 'fixtures');

/** Open a fixture through the file picker and wait until it is ready with peaks. */
export async function loadFixture(page: Page, name: string): Promise<void> {
	await page.locator('[data-testid=picker]').setInputFiles(join(FIXTURES, name));
	const base = name.replace(/\.[^.]+$/, '');
	await expect
		.poll(
			() =>
				page.evaluate(
					(base) =>
						!!window.looper?.track.loaded &&
						window.looper.track.name === base &&
						!!window.looper.track.peaks,
					base
				),
			{ timeout: 15000 }
		)
		.toBe(true);
}

/** Collect console errors and page errors for later assertion. */
export function watchErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('console', (m: ConsoleMessage) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	page.on('pageerror', (e) => errors.push(String(e)));
	return errors;
}

export const PHASE = process.env.PHASE ?? 'dev';
