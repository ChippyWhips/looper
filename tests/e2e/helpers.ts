import type { ConsoleMessage, Page } from '@playwright/test';

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
