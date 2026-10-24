import { BrowserSeparator } from './browser/browser-separator';
import { CacheModelStore } from './browser/model-store';
import { StubSeparator } from './stub-separator';
import type { Separator } from './types';

/**
 * The one place that chooses a separator. The browser runtime (demucs-rs WASM on WebGPU) is the
 * default; `?separator=stub|stub-slow|stub-fail` selects the deterministic stub for tests.
 * A native shell would return its own implementation here.
 */
export function createSeparator(
	search = typeof location === 'undefined' ? '' : location.search
): Separator {
	const kind = new URLSearchParams(search).get('separator');
	if (kind === 'stub') return new StubSeparator({ durationMs: 400 });
	if (kind === 'stub-slow') return new StubSeparator({ durationMs: 6000, steps: 60 });
	if (kind === 'stub-fail') return new StubSeparator({ durationMs: 200, fail: true });
	return new BrowserSeparator(new CacheModelStore());
}

export * from './types';
