import { BrowserSeparator } from './browser/browser-separator';
import { CacheModelStore } from './browser/model-store';
import { NativeSeparator } from './native/native-separator';
import { NullSeparator } from './null-separator';
import { computePeaks, levelCount } from '../analysis/peaks';
import { TrackStore } from '../storage/track-store';
import { StubSeparator } from './stub-separator';
import type { Separator } from './types';

/**
 * The one place that chooses a separator: demucs-rs natively on Metal in the desktop build,
 * its WASM runtime on WebGPU in the browser. `?separator=stub|stub-slow|stub-fail|stub-broken`
 * (and `stub-persisted`, which stores its stems like the native
 * separator) selects the deterministic stub for tests; `?separator=none` (or `?test` without `separator`)
 * selects none.
 */
export function createSeparator(
	search = typeof location === 'undefined' ? '' : location.search
): Separator {
	const q = new URLSearchParams(search);
	const kind = q.get('separator') ?? (q.has('test') ? 'none' : null);
	if (kind === 'none') return new NullSeparator();
	if (kind === 'stub') return new StubSeparator({ durationMs: 400 });
	if (kind === 'stub-slow') return new StubSeparator({ durationMs: 6000, steps: 60 });
	if (kind === 'stub-fail') return new StubSeparator({ durationMs: 200, fail: true });
	if (kind === 'stub-persisted')
		return new StubSeparator({ durationMs: 400, persist: persistLikeNative });
	if (kind === 'stub-broken') return new StubSeparator({ durationMs: 200, breaks: true });
	// __DESKTOP__ is a build-time constant, so the desktop bundle drops the browser runtime.
	if (__DESKTOP__) return new NativeSeparator();
	return new BrowserSeparator(new CacheModelStore());
}

export * from './types';

/** What the native separator does after separating: stems, peaks and meta into the store. */
async function persistLikeNative(trackId: string, set: import('./types').StemSet): Promise<void> {
	const store = new TrackStore();
	const peaks = set.stems.map((s) => ({
		name: s.name,
		peaks: computePeaks(s.channels, levelCount(set.length, 1280))
	}));
	await store.saveStems(
		trackId,
		{
			model: set.model,
			sampleRate: set.sampleRate,
			length: set.length,
			channels: 2,
			stems: set.stems.map((s) => ({ name: s.name, rmsDb: s.rmsDb }))
		},
		set.stems,
		peaks
	);
}
