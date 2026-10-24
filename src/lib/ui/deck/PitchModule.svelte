<script lang="ts">
	import type { App } from '../../state/app.svelte';
	import { PITCH_MAX, PITCH_MIN } from '../../state/transport.svelte';
	import { parseNumber, signed } from '../../time';
	import Knob from '../components/Knob.svelte';
	import Value from '../components/Value.svelte';

	interface Props {
		app: App;
	}
	let { app }: Props = $props();
	const loaded = $derived(app.track.loaded);
	const cents = $derived(app.transport.cents);
	const QUICK: { v: number; hint?: string }[] = [
		{ v: 0 },
		{ v: -25 },
		{ v: -50 },
		{ v: -100, hint: 'E♭' },
		{ v: -200, hint: 'D' }
	];
</script>

<div class="module pitch">
	<span class="label">Pitch</span>
	<div class="knob-row mid">
		<Knob
			value={cents}
			min={PITCH_MIN}
			max={PITCH_MAX}
			step={100}
			fineStep={1}
			disabled={!loaded}
			label="Pitch"
			onchange={(v) => app.setPitch(v)}
		/>
		<Value
			value={loaded ? cents : null}
			format={(v) => `${signed(v)} ct`}
			parse={(s) => {
				const n = parseNumber(s.replace(/ct/i, ''));
				return n === null ? null : Math.round(n);
			}}
			step={1}
			min={PITCH_MIN}
			max={PITCH_MAX}
			label="Pitch cents"
			onchange={(v) => app.setPitch(v)}
			testid="pitch-value"
		/>
	</div>
	<div class="quick">
		{#each QUICK as q (q.v)}
			<span class="q">
				<button
					class:active={loaded && cents === q.v}
					disabled={!loaded}
					onclick={() => app.setPitch(q.v)}>{signed(q.v)}</button
				>
				{#if q.hint}<span class="hint">{q.hint}</span>{/if}
			</span>
		{/each}
	</div>
</div>

<style>
	.label {
		font-size: var(--fs-sm);
		line-height: var(--lh-sm);
		color: var(--fg-muted);
	}
	.knob-row {
		display: flex;
		align-items: center;
		gap: var(--s3);
		margin-left: calc(-1 * var(--s2));
	}
	.quick {
		display: flex;
		gap: var(--s3);
		align-items: flex-start;
	}
	.q {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--s1);
	}
	button {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		line-height: var(--lh-xs);
		color: var(--fg-subtle);
		transition: color var(--dur-fast) var(--ease-out);
		&:hover:not(:disabled) {
			color: var(--fg-muted);
		}
		&.active {
			color: var(--fg-primary);
		}
		&:disabled {
			cursor: default;
		}
	}
	.hint {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		line-height: var(--lh-xs);
		color: var(--fg-subtle);
	}
</style>
