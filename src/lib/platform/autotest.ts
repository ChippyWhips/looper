import type { App } from '../state/app.svelte';

/**
 * Desktop measurement run (see src-tauri/src/autotest.rs): open the configured file, wait for
 * separation to finish, and report frame timing while it ran. No-op unless configured.
 */
export async function runAutotest(app: App): Promise<void> {
	if (!__DESKTOP__) return;
	const { invoke } = await import('@tauri-apps/api/core');
	const name = await invoke<string | null>('autotest_config');
	if (!name) return;
	const bytes = await invoke<ArrayBuffer>('autotest_read');
	await app.store.listTracks().then(async (ids) => {
		for (const id of ids) await app.store.forget(id);
	});
	const t0 = performance.now();
	await app.open(new File([bytes], name));
	const openMs = performance.now() - t0;

	const gaps: number[] = [];
	const perSecond: number[] = [];
	let frames = 0;
	let secStart = performance.now();
	let prev = secStart;
	let timerGap = 0;
	let tPrev = performance.now();
	const timer = setInterval(() => {
		const n = performance.now();
		timerGap = Math.max(timerGap, n - tPrev);
		tPrev = n;
	}, 50);
	await new Promise<void>((resolve) => {
		const tick = (now: number) => {
			gaps.push(now - prev);
			prev = now;
			frames++;
			if (now - secStart >= 1000) {
				perSecond.push(frames);
				frames = 0;
				secStart = now;
			}
			const s = app.stems.status;
			if (s === 'done' || s === 'failed' || s === 'unavailable' || s === 'stopped') resolve();
			else requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	clearInterval(timer);
	const sorted = [...perSecond].sort((a, b) => a - b);
	const report = {
		file: name,
		openMs: Math.round(openMs),
		status: app.stems.status,
		separationMs: Math.round(performance.now() - t0 - openMs),
		lanes: app.stems.lanes.map((l) => `${l.name} ${l.rmsDb.toFixed(1)}`),
		fps: {
			min: sorted[0],
			p5: sorted[Math.floor(sorted.length * 0.05)],
			median: sorted[Math.floor(sorted.length / 2)]
		},
		worstFrameGapMs: Math.round(Math.max(...gaps.slice(1))),
		worstTimerGapMs: Math.round(timerGap)
	};
	await invoke('autotest_report', { report: JSON.stringify(report) });
}
