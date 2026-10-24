import { expect, test, type Page } from '@playwright/test';
import { loadFixture } from './helpers';

const loopOf = (page: Page) =>
	page.evaluate(() => {
		const l = window.looper.loop;
		return { start: l.start, end: l.end, on: l.on, selected: l.selected };
	});

test.describe('loop editing', () => {
	test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium');

	test.beforeEach(async ({ page }) => {
		await page.goto('/?test');
		await loadFixture(page, 'sine-440-48000.wav');
	});

	test('drag creates a snapped loop; click outside seeks without moving it', async ({ page }) => {
		const main = page.getByTestId('wave-main');
		const box = (await main.boundingBox())!;
		const y = box.y + box.height / 2;
		await page.mouse.move(box.x + 200, y);
		await page.mouse.down();
		await page.mouse.move(box.x + 400, y, { steps: 5 });
		await page.mouse.up();
		const l = await loopOf(page);
		expect(l.on).toBe(true);
		expect(l.end).toBeGreaterThan(l.start);
		// Snapped to zero crossings of the sine.
		const vals = await page.evaluate(
			({ a, b }) => {
				const x = window.looper.track.channels![0];
				return [x[a], x[b]];
			},
			{ a: l.start, b: l.end }
		);
		for (const v of vals) expect(Math.abs(v)).toBeLessThan(0.03);

		await page.mouse.click(box.x + 800, y);
		expect(await loopOf(page)).toMatchObject({ start: l.start, end: l.end });
		const pos = await page.evaluate(() => window.looper.position());
		const expected = await page.evaluate((x) => window.looper.viewport.frameAt(x), 800);
		expect(Math.abs(pos - expected)).toBeLessThan(2);
	});

	test('edge drag, move inside, selection, nudge and Alt sample nudge', async ({ page }) => {
		await page.evaluate(() => window.looper.setLoopRange(48000, 96000, true));
		const main = page.getByTestId('wave-main');
		const box = (await main.boundingBox())!;
		const y = box.y + box.height / 2;
		const xOf = (f: number) => page.evaluate((f) => window.looper.viewport.xAt(f), f);

		// Drag the out edge right.
		const xo = await xOf(96000);
		await page.mouse.move(box.x + xo, y);
		await page.mouse.down();
		await page.mouse.move(box.x + xo + 60, y, { steps: 4 });
		await page.mouse.up();
		let l = await loopOf(page);
		expect(l.start).toBe(48000);
		expect(l.end).toBeGreaterThan(96000);
		expect(l.selected).toBe('out');

		// Move the whole loop keeping its length.
		const len = l.end - l.start;
		const mid = await xOf((l.start + l.end) / 2);
		await page.mouse.move(box.x + mid, y);
		await page.mouse.down();
		await page.mouse.move(box.x + mid + 100, y, { steps: 4 });
		await page.mouse.up();
		l = await loopOf(page);
		expect(l.end - l.start).toBe(len);
		expect(l.start).toBeGreaterThan(48000);

		// [ selects in; Alt+→ moves exactly one sample.
		await page.keyboard.press('[');
		const before = (await loopOf(page)).start;
		await page.keyboard.press('Alt+ArrowRight');
		expect((await loopOf(page)).start).toBe(before + 1);
		await page.keyboard.press('Alt+ArrowLeft');
		expect((await loopOf(page)).start).toBe(before);
		// → moves forward by about 1 ms to the next zero crossing.
		await page.keyboard.press('ArrowRight');
		const after = (await loopOf(page)).start;
		expect(after).toBeGreaterThan(before);
		expect(after - before).toBeLessThanOrEqual(48 + 96);
		await page.keyboard.press('Escape');
		expect((await loopOf(page)).selected).toBe(null);
	});

	test('typed In / Out / Length; L toggles; Enter jumps to loop start', async ({ page }) => {
		await page.evaluate(() => window.looper.setLoopRange(48000, 96000, true));
		await page.getByTestId('loop-in').click();
		const field = page.getByLabel('Loop in');
		await field.fill('0:00.500');
		await field.press('Alt+Enter');
		expect((await loopOf(page)).start).toBe(24000);

		await page.getByTestId('loop-length').click();
		await page.getByLabel('Loop length').fill('0:01.250');
		await page.getByLabel('Loop length').press('Alt+Enter');
		expect((await loopOf(page)).end).toBe(24000 + 60000);

		await page.getByTestId('loop-out').click();
		await page.getByLabel('Loop out').fill('0:02.000');
		await page.getByLabel('Loop out').press('Escape');
		expect((await loopOf(page)).end).toBe(84000);

		await page.getByTestId('loop-out').click();
		await page.getByLabel('Loop out').fill('0:02.000');
		await page.getByLabel('Loop out').press('Enter');
		const end = (await loopOf(page)).end;
		expect(Math.abs(end - 96000)).toBeLessThanOrEqual(96);

		await page.keyboard.press('l');
		expect((await loopOf(page)).on).toBe(false);
		await page.keyboard.press('l');
		expect((await loopOf(page)).on).toBe(true);

		await page.keyboard.press('Enter');
		await expect.poll(() => page.evaluate(() => window.looper.transport.playing)).toBe(true);
		await page.waitForTimeout(400);
		const pos = await page.evaluate(() => window.looper.position());
		expect(pos).toBeGreaterThanOrEqual(24000);
		expect(pos).toBeLessThan(end);
		await page.keyboard.press(' ');
	});

	test('I and O set edges at the playhead', async ({ page }) => {
		await page.evaluate(() => window.looper.seek(100000));
		await page.waitForTimeout(100);
		await page.keyboard.press('i');
		await page.evaluate(() => window.looper.seek(200000));
		await page.waitForTimeout(100);
		await page.keyboard.press('o');
		const l = await loopOf(page);
		expect(Math.abs(l.start - 100000)).toBeLessThanOrEqual(96);
		expect(Math.abs(l.end - 200000)).toBeLessThanOrEqual(96);
		expect(l.on).toBe(true);
	});

	test('Space starts from the loop start when the loop is on', async ({ page }) => {
		await page.evaluate(() => {
			window.looper.setLoopRange(96000, 192000, true);
			window.looper.seek(300000);
		});
		await page.keyboard.press(' ');
		await page.waitForTimeout(500);
		const pos = await page.evaluate(() => window.looper.position());
		expect(pos).toBeGreaterThanOrEqual(96000);
		expect(pos).toBeLessThan(192000);
		await page.keyboard.press(' ');
	});
});
