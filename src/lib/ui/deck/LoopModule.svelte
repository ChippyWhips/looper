<script lang="ts">
	import type { App } from '../../state/app.svelte';
	import { formatTime, msToFrames, parseTime } from '../../time';
	import TextToggle from '../components/TextToggle.svelte';
	import Value from '../components/Value.svelte';

	interface Props {
		app: App;
	}
	let { app }: Props = $props();
	const l = $derived(app.loop);
	const t = $derived(app.track);
	const has = $derived(t.loaded && l.exists);
	const sr = $derived(t.sampleRate);
	const fmt = (f: number) => formatTime(f, sr);
	const parse = (s: string) => {
		const ms = parseTime(s);
		return ms === null ? null : msToFrames(ms, sr);
	};
	const msStep = $derived(sr / 1000);
</script>

<div class="module loop">
	<div class="head">
		<TextToggle
			label="Loop"
			on={l.on && has}
			disabled={!has}
			onclick={() => app.toggleLoop()}
			testid="loop-toggle"
		/>
		<TextToggle
			label="Snap"
			on={l.snap}
			dot="primary"
			onclick={() => app.toggleSnap()}
			testid="snap-toggle"
		/>
	</div>
	<div class="fields mid">
		<div class="field">
			<span class="label">In</span>
			<Value
				value={has ? l.start : null}
				format={fmt}
				{parse}
				step={msStep}
				min={0}
				max={t.length}
				label="Loop in"
				onchange={(v, o) => app.setEdgeValue('in', v, o)}
				testid="loop-in"
			/>
		</div>
		<div class="field">
			<span class="label">Out</span>
			<Value
				value={has ? l.end : null}
				format={fmt}
				{parse}
				step={msStep}
				min={0}
				max={t.length}
				label="Loop out"
				onchange={(v, o) => app.setEdgeValue('out', v, o)}
				testid="loop-out"
			/>
		</div>
	</div>
	<div class="length">
		<span class="label">Length</span>
		<Value
			value={has ? l.length : null}
			format={fmt}
			{parse}
			step={msStep}
			min={1}
			max={t.length}
			label="Loop length"
			onchange={(v, o) => app.setLengthValue(v, o)}
			testid="loop-length"
		/>
	</div>
</div>

<style>
	.head {
		display: flex;
		gap: var(--s5);
	}
	.fields {
		display: flex;
		gap: var(--s6);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	.length {
		display: flex;
		align-items: baseline;
		gap: var(--s2);
	}
	.label {
		font-size: var(--fs-sm);
		line-height: var(--lh-sm);
		color: var(--fg-muted);
	}
</style>
