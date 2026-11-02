import { defineConfig, type Plugin } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Exposes the Emscripten factory inside `signalsmith-stretch` as `virtual:signalsmith-core`,
 * without the package's own AudioWorkletProcessor, so our worklet can drive the core directly.
 */
function signalsmithCore(): Plugin {
	const id = 'virtual:signalsmith-core';
	const resolved = '\0' + id;
	return {
		name: 'signalsmith-core',
		resolveId(source) {
			return source === id ? resolved : null;
		},
		load(source) {
			if (source !== resolved) return null;
			const file = require.resolve('signalsmith-stretch');
			const text = readFileSync(file, 'utf8');
			const start = text.indexOf('var SignalsmithStretch');
			const end = text.indexOf('})();', start);
			if (start < 0 || end < 0) throw new Error('signalsmith-core: unexpected package layout');
			return text.slice(start, end + 5) + '\nexport default SignalsmithStretch;\n';
		}
	};
}

/** True when the Tauri CLI drives the build (desktop app); selects native storage and separation. */
const DESKTOP = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
	define: { __DESKTOP__: JSON.stringify(DESKTOP) },
	plugins: [
		signalsmithCore(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	worker: {
		format: 'es',
		plugins: () => [signalsmithCore()]
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.{test,spec}.ts'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
