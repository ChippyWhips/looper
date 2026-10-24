import { BrowserSeparator } from './browser/browser-separator';
import { CacheModelStore } from './browser/model-store';
import { NullSeparator } from './null-separator';
import { StubSeparator } from './stub-separator';
import type { Separator } from './types';

/**
 * The one place that chooses a separator. The browser runtime (demucs-rs WASM on WebGPU) is the
 * default; `?separator=stub|stub-slow|stub-fail|stub-broken` selects the deterministic stub for tests, and
 * `?separator=none` (or a `?test` run without `separator`) selects no separator.
 * A native shell would return its own implementation here.
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
	if (kind === 'stub-broken') return new StubSeparator({ durationMs: 200, breaks: true });
	return new BrowserSeparator(new CacheModelStore());
}

export * from './types';
