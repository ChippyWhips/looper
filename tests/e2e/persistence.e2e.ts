import { expect, test as base, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFixture } from './helpers';

/** Playwright's ephemeral WebKit contexts have no OPFS, so WebKit runs in a persistent context. */
const test = base.extend<{ app: Page }>({
	app: async ({ page, browserName, playwright, baseURL }, use) => {
		if (browserName !== 'webkit') return use(page);
		const dir = mkdtempSync(join(tmpdir(), 'looper-wk-'));
		const ctx = await playwright.webkit.launchPersistentContext(dir, {
			baseURL,
			viewport: { width: 1280, height: 800 }
		});
		const p = ctx.pages()[0] ?? (await ctx.newPage());
		// WebKit keeps OPFS outside the profile directory, so start from a clean slate.
		await p.goto('/harness');
		await p.evaluate(async () => {
			const root = await navigator.storage.getDirectory();
			await root.removeEntry('looper', { recursive: true }).catch(() => {});
			localStorage.clear();
		});
		await use(p);
		await ctx.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

const FILES = ['sine-440-48000.wav', 'sine-1k-48000.wav', 'click-120-48000.wav', 'sweep-48000.wav'];

async function settings(page: Page) {
	return page.evaluate(() => {
		const a = window.looper;
		return {
			id: a.track.id,
			loop: { start: a.loop.start, end: a.loop.end, on: a.loop.on },
			speed: a.transport.speed,
			cents: a.transport.cents,
			countIn: a.transport.countIn,
			tempoOverride: a.transport.tempoOverride
		};
	});
}

async function opfsTracks(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const d = await (await root.getDirectoryHandle('looper')).getDirectoryHandle('tracks');
		const out: string[] = [];
		for await (const k of (d as unknown as { keys(): AsyncIterable<string> }).keys()) out.push(k);
		return out;
	});
}

test.describe('persistence @smoke', () => {
	test('4 tracks opened → reload → 3 remain with settings; evicted directory is gone', async ({
		app: page
	}) => {
		await page.goto('/?test');
		const saved: Awaited<ReturnType<typeof settings>>[] = [];
		for (let i = 0; i < FILES.length; i++) {
			await loadFixture(page, FILES[i]);
			await expect
				.poll(() => page.evaluate(() => window.looper.recent.length))
				.toBe(Math.min(3, i + 1));
			await page.evaluate((i) => {
				const a = window.looper;
				a.setLoopRange(10000 + i * 1000, 60000 + i * 1000, true);
				a.setSpeed(60 + i * 10);
				a.setPitch(-10 * (i + 1));
				a.setTempo(100 + i);
				a.transport.countIn = i % 2 === 0;
				a.seek(30000 + i * 100);
			}, i);
			await page.waitForTimeout(900);
			saved.push(await settings(page));
		}
		const evicted = saved[0].id!;
		expect(new Set(saved.map((s) => s.id)).size).toBe(4);

		await page.reload();
		await expect
			.poll(() => page.evaluate(() => window.looper?.track.loaded ?? false), { timeout: 15000 })
			.toBe(true);
		// The most recent track reopens, paused at its last position.
		expect(await settings(page)).toEqual(saved[3]);
		expect(await page.evaluate(() => window.looper.transport.state)).toBe('stopped');
		expect(await page.evaluate(() => window.looper.position())).toBe(30300);

		const recent = await page.evaluate(() => window.looper.recent.map((e) => e.id));
		expect(recent).toEqual([saved[3].id, saved[2].id, saved[1].id]);

		// Each remaining track restores its settings from the Recent list.
		await page.getByTestId('title').click();
		await page.getByRole('menuitem').nth(2).click();
		await expect.poll(() => page.evaluate(() => window.looper.track.id)).toBe(saved[1].id);
		await expect.poll(() => settings(page)).toEqual(saved[1]);

		const dirs = await opfsTracks(page);
		expect(dirs).not.toContain(evicted);
		expect(dirs.sort()).toEqual([saved[1].id, saved[2].id, saved[3].id].sort());

		// Re-opening a file already in the list is recognised by content.
		await loadFixture(page, FILES[2]);
		await expect.poll(() => settings(page)).toEqual(saved[2]);
	});

	test('the stems directory is reserved and settings.json has no stems field', async ({
		app: page
	}) => {
		await page.goto('/?test');
		await loadFixture(page, FILES[0]);
		await page.evaluate(() => window.looper.setSpeed(70));
		await expect
			.poll(() =>
				page.evaluate(async () => {
					const raw = await window.looper.store.rawSettings(window.looper.track.id!);
					return raw ? JSON.parse(raw).speed : null;
				})
			)
			.toBe(70);
		const r = await page.evaluate(async () => {
			const a = window.looper;
			const id = a.track.id!;
			return {
				names: (await a.store.listTrack(id)).sort(),
				settings: JSON.parse((await a.store.rawSettings(id))!)
			};
		});
		expect(r.names).toContain('stems');
		expect(r.names).toContain('original');
		expect(r.names).toContain('peaks.bin');
		expect(r.settings.version).toBe(1);
		expect('stems' in r.settings).toBe(false);
		expect(r.settings.speed).toBe(70);
	});
});
