import { expect, type Page } from '@playwright/test';
import { loadFixture, test } from './helpers';

const status = (page: Page) => page.evaluate(() => window.looper.stems.status);
const lanes = (page: Page) =>
	page.evaluate(() =>
		window.looper.stems.lanes.map((l) => `${l.name}${l.muted ? ':m' : ''}${l.soloed ? ':s' : ''}`)
	);

async function stemFiles(page: Page, id: string): Promise<string[]> {
	return page.evaluate(async (id) => (await window.looper.store.listStems(id)).sort(), id);
}

test.describe('stems @stems', () => {
	test('separates in the background, shows lanes, mute/solo switch the audible set, stems persist @smoke', async ({
		app: page
	}) => {
		await page.goto('/?test&separator=stub');
		await loadFixture(page, 'sine-440-48000.wav');
		await expect.poll(() => status(page)).toBe('running');
		await expect(page.getByTestId('stems-status')).toContainText(/Stems \d+%/);
		await expect.poll(() => status(page), { timeout: 10000 }).toBe('done');
		// Near-silent stems (drums, piano, other) get no lane.
		expect(await lanes(page)).toEqual(['vocals', 'guitar', 'bass']);
		await expect(page.getByTestId('lanes')).toBeVisible();
		await expect(page.getByTestId('stems-toggle')).toBeVisible();

		// Nothing muted or soloed: the mix is audible and drawn.
		expect(await page.evaluate(() => window.looper.track.audiblePeaks)).toBeNull();

		// Mute guitar: stems play; the main waveform switches to the stem sum.
		await page.getByRole('button', { name: 'Mute Guitar' }).click();
		expect(await lanes(page)).toEqual(['vocals', 'guitar:m', 'bass']);
		expect(await page.evaluate(() => [...window.looper.stems.audibleNames()].sort())).toEqual([
			'bass',
			'vocals'
		]);
		await expect.poll(() => page.evaluate(() => !!window.looper.track.audiblePeaks)).toBe(true);
		// Sum of vocals (0.5) + bass (0.2) of a 0.5 sine peaks near 0.35.
		const peak = await page.evaluate(() => {
			const lv = window.looper.track.audiblePeaks!.at(-1)!;
			return Math.max(...lv.data);
		});
		expect(peak).toBeGreaterThan(0.33);
		expect(peak).toBeLessThan(0.37);

		// Solo bass: only bass.
		await page.getByRole('button', { name: 'Solo Bass' }).click();
		expect(await page.evaluate(() => [...window.looper.stems.audibleNames()])).toEqual(['bass']);
		// Clear both: back to the mix.
		await page.getByRole('button', { name: 'Solo Bass' }).click();
		await page.getByRole('button', { name: 'Mute Guitar' }).click();
		await expect.poll(() => page.evaluate(() => window.looper.track.audiblePeaks)).toBeNull();

		// Storage: every stem (including silent ones) is stored as 16-bit PCM with peaks.
		const id = (await page.evaluate(() => window.looper.track.id))!;
		expect(await stemFiles(page, id)).toEqual([
			'bass.pcm',
			'bass.peaks',
			'drums.pcm',
			'drums.peaks',
			'guitar.pcm',
			'guitar.peaks',
			'meta.json',
			'other.pcm',
			'other.peaks',
			'piano.pcm',
			'piano.peaks',
			'vocals.pcm',
			'vocals.peaks'
		]);
		const pcmBytes = await page.evaluate(async (id) => {
			const meta = (await window.looper.store.loadStemMeta(id))!;
			const pcm = (await window.looper.store.loadStemPcm(id, 'vocals', meta))!;
			return { len: pcm[0].length, chans: pcm.length, length: meta.length, model: meta.model };
		}, id);
		expect(pcmBytes).toEqual({ len: 480000, chans: 2, length: 480000, model: 'htdemucs_6s' });

		// Mute state is saved; reload restores stems without separating again.
		await page.getByRole('button', { name: 'Mute Vocals' }).click();
		await expect
			.poll(() =>
				page.evaluate(async () => {
					const raw = await window.looper.store.rawSettings(window.looper.track.id!);
					return raw ? JSON.parse(raw).stems?.muted : null;
				})
			)
			.toEqual(['vocals']);
		await page.reload();
		await expect
			.poll(() => page.evaluate(() => window.looper?.stems.status ?? null), { timeout: 15000 })
			.toBe('done');
		expect(await lanes(page)).toEqual(['vocals:m', 'guitar', 'bass']);
	});

	test('opening another track cancels the running job', async ({ app: page }) => {
		await page.goto('/?test&separator=stub-slow');
		await loadFixture(page, 'sine-440-48000.wav');
		const first = await page.evaluate(() => window.looper.track.id!);
		await expect.poll(() => status(page)).toBe('running');
		await loadFixture(page, 'sine-1k-48000.wav');
		await expect.poll(() => status(page)).toBe('running');
		// Stop the second job too, then make sure nothing ever lands for the first track.
		await page.getByTestId('stems-stop').click();
		expect(await status(page)).toBe('stopped');
		await expect(page.getByTestId('stems-separate')).toBeVisible();
		await page.waitForTimeout(7000);
		expect(await page.evaluate((id) => window.looper.store.loadStemMeta(id), first)).toBeNull();
		expect(await lanes(page)).toEqual([]);
	});

	test('Stop offers Separate; failure offers Retry', async ({ app: page }) => {
		await page.goto('/?test&separator=stub-fail');
		await loadFixture(page, 'sine-440-48000.wav');
		await expect(page.getByTestId('stems-status')).toContainText('Stems failed', { timeout: 5000 });
		await expect(page.getByTestId('stems-retry')).toBeVisible();
	});

	test('Re-separate (fine) replaces the stems with the fine-tuned set', async ({ app: page }) => {
		await page.goto('/?test&separator=stub');
		await loadFixture(page, 'sine-440-48000.wav');
		await expect.poll(() => status(page), { timeout: 10000 }).toBe('done');
		await page.getByTestId('title').click();
		await page.getByTestId('recent-fine').click();
		await expect.poll(() => status(page)).toBe('running');
		await expect.poll(() => status(page), { timeout: 10000 }).toBe('done');
		expect(await lanes(page)).toEqual(['vocals', 'bass']);
		expect(await page.evaluate(() => window.looper.stems.model)).toBe('htdemucs_ft');
	});

	test('without a separator the top bar says stems are unavailable', async ({ app: page }) => {
		await page.goto('/?test&separator=none');
		await loadFixture(page, 'sine-440-48000.wav');
		await expect(page.getByTestId('stems-status')).toHaveText('Stems unavailable in this browser');
	});

	test('evicting a track removes its stems', async ({ app: page }) => {
		await page.goto('/?test&separator=stub');
		await loadFixture(page, 'sine-440-48000.wav');
		await expect.poll(() => status(page), { timeout: 10000 }).toBe('done');
		const id = (await page.evaluate(() => window.looper.track.id))!;
		for (const f of ['sine-1k-48000.wav', 'click-120-48000.wav', 'sweep-48000.wav']) {
			await loadFixture(page, f);
			await page
				.getByTestId('stems-stop')
				.click()
				.catch(() => {});
		}
		await expect
			.poll(() =>
				page.evaluate(async (id) => (await window.looper.store.listTracks()).includes(id), id)
			)
			.toBe(false);
		expect(await page.evaluate((id) => window.looper.store.loadStemMeta(id), id)).toBeNull();
	});
});
