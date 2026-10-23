import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SRC = join(ROOT, 'src');
const TOKENS = join(SRC, 'lib', 'ui', 'tokens.css');

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

const PRIMITIVES = [
	'neutral-950',
	'neutral-925',
	'neutral-910',
	'neutral-900',
	'neutral-875',
	'neutral-850',
	'neutral-700',
	'neutral-600',
	'neutral-450',
	'neutral-100',
	'neutral-100-a04',
	'neutral-100-a06',
	'red-500',
	'ember-900',
	'ember-700',
	'ember-200'
];

const SEMANTIC = [
	'bg-sunken',
	'bg-default',
	'bg-raised',
	'bg-interactive-hover',
	'control-bg',
	'control-bg-hover',
	'control-track',
	'control-fill',
	'border-subtle',
	'border-strong',
	'border-focus',
	'fg-primary',
	'fg-muted',
	'fg-subtle',
	'fg-on-primary',
	'wave-default',
	'wave-active',
	'loop-band',
	'loop-edge',
	'accent',
	'viz-1',
	'viz-2',
	'viz-3',
	'viz-4'
];

/** Style text of a component file: <style> blocks and style attributes for .svelte, all of .css. */
function styleText(file: string, text: string): string {
	if (file.endsWith('.css')) return text;
	const blocks = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
	const attrs = [...text.matchAll(/style(?::[\w-]+)?="([^"]*)"/g)].map((m) => m[1]);
	return [...blocks, ...attrs].join('\n');
}

const components = walk(SRC).filter(
	(f) => (f.endsWith('.svelte') || f.endsWith('.css')) && f !== TOKENS
);
const scripts = walk(SRC).filter(
	(f) =>
		(f.endsWith('.ts') || f.endsWith('.svelte')) &&
		!f.endsWith('.test.ts') &&
		(f.includes('/ui/') ||
			f.includes('/viz/') ||
			f.includes('/routes/') ||
			f.includes('/waveform/'))
);

describe('design tokens', () => {
	const tokens = readFileSync(TOKENS, 'utf8');

	it('defines every primitive and semantic token', () => {
		for (const t of [...PRIMITIVES, ...SEMANTIC]) expect(tokens).toContain(`--${t}:`);
	});

	it('semantic tokens only point at primitives', () => {
		for (const t of SEMANTIC) {
			const m = tokens.match(new RegExp(`--${t}:\\s*([^;]+);`));
			expect(m?.[1]).toMatch(/^var\(--(neutral|red|ember)-[\w-]+\)$/);
		}
	});

	it('components never reference primitives or raw colours', () => {
		const offences: string[] = [];
		for (const f of components) {
			const css = styleText(f, readFileSync(f, 'utf8'));
			const rel = relative(ROOT, f);
			if (/--(neutral|red|ember)-\d/.test(css)) offences.push(`${rel}: primitive token`);
			if (/#[0-9a-fA-F]{3,8}\b/.test(css)) offences.push(`${rel}: hex colour`);
			if (/\b(rgba?|hsla?|oklch|oklab|lab|lch|color)\(/.test(css))
				offences.push(`${rel}: colour function`);
			if (/(?<![\w-])(white|black|red|blue|purple|gray|grey)(?![\w-])/.test(css))
				offences.push(`${rel}: named colour`);
		}
		for (const f of scripts) {
			const text = readFileSync(f, 'utf8');
			const rel = relative(ROOT, f);
			if (/['"`]#[0-9a-fA-F]{3,8}['"`]/.test(text)) offences.push(`${rel}: hex colour in script`);
			if (/['"`]rgba?\(/.test(text)) offences.push(`${rel}: rgb() in script`);
			if (/--(neutral|red|ember)-\d/.test(text)) offences.push(`${rel}: primitive token in script`);
		}
		expect(offences).toEqual([]);
	});

	it('components use type, spacing and motion tokens', () => {
		const offences: string[] = [];
		for (const f of components) {
			const css = styleText(f, readFileSync(f, 'utf8'));
			const rel = relative(ROOT, f);
			for (const m of css.matchAll(/font-size:\s*([^;]+);/g))
				if (!/^var\(--fs-/.test(m[1].trim())) offences.push(`${rel}: font-size ${m[1]}`);
			for (const m of css.matchAll(/font-weight:\s*([^;]+);/g))
				if (!/^var\(--fw-/.test(m[1].trim())) offences.push(`${rel}: font-weight ${m[1]}`);
			for (const m of css.matchAll(/transition[\w-]*:\s*([^;]+);/g))
				if (/\d+m?s\b/.test(m[1])) offences.push(`${rel}: raw duration ${m[1]}`);
			for (const m of css.matchAll(/border-radius:\s*([^;]+);/g))
				if (!/^(0|50%)$/.test(m[1].trim())) offences.push(`${rel}: radius ${m[1]}`);
			if (/box-shadow|backdrop-filter|linear-gradient|radial-gradient/.test(css))
				offences.push(`${rel}: shadow/blur/gradient`);
		}
		expect(offences).toEqual([]);
	});
});
