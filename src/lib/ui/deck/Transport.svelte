<script lang="ts">
	import { onMount } from 'svelte';
	import type { App } from '../../state/app.svelte';
	import { formatTime } from '../../time';
	import PlayButton from '../components/PlayButton.svelte';
	import TextToggle from '../components/TextToggle.svelte';
	import Value from '../components/Value.svelte';

	interface Props {
		app: App;
	}
	let { app }: Props = $props();
	const t = $derived(app.track);
	const tr = $derived(app.transport);
	let pos: HTMLSpanElement | undefined = $state();

	onMount(() => {
		let raf = 0;
		let last = '';
		let el: HTMLSpanElement | undefined;
		const frame = () => {
			raf = requestAnimationFrame(frame);
			if (pos !== el) {
				el = pos;
				last = '';
			}
			const text = app.track.loaded ? formatTime(app.position(), app.track.sampleRate) : '—';
			if (pos && text !== last) {
				last = text;
				// eslint-disable-next-line svelte/no-dom-manipulating -- rAF-driven readout, not reactive state
				pos.textContent = text;
			}
		};
		raf = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(raf);
	});
</script>

<div class="module transport">
	<div class="head">
		<PlayButton playing={tr.playing} disabled={!t.loaded} onclick={() => app.togglePlay()} />
		<div class="readout">
			{#key t.loaded}
				<span
					class="pos"
					class:empty={!t.loaded}
					class:appear={t.loaded}
					bind:this={pos}
					data-testid="position">—</span
				>
			{/key}
			<span class="dur">/ {t.loaded ? formatTime(t.length, t.sampleRate) : '—'}</span>
		</div>
	</div>
	<div class="mid"></div>
	<div class="foot">
		<TextToggle
			label="Count-in"
			on={tr.countIn}
			counting={tr.state === 'counting'}
			flash={tr.beatLit}
			disabled={!t.loaded || tr.tempo === null}
			onclick={() => app.toggleCountIn()}
			testid="countin"
		/>
		<Value
			value={t.loaded ? tr.tempo : null}
			format={(v) => v.toFixed(1)}
			parse={(s) => {
				const n = Number(s.trim());
				return Number.isFinite(n) && n > 0 ? n : null;
			}}
			step={0.1}
			min={20}
			max={300}
			label="Tempo"
			suffix="BPM"
			onchange={(v) => app.setTempo(v)}
			testid="tempo"
		/>
	</div>
</div>

<style>
	.head {
		display: flex;
		align-items: flex-start;
		gap: var(--s3);
	}
	.readout {
		display: flex;
		flex-direction: column;
		gap: var(--s1);
		font-family: var(--font-mono);
		min-width: 0;
	}
	.pos {
		font-size: var(--fs-lg);
		line-height: var(--lh-lg);
		color: var(--fg-primary);
		margin-top: calc(-1 * var(--s1));
		&.empty {
			color: var(--fg-subtle);
		}
	}
	.appear {
		animation: appear var(--dur-slow) var(--ease-out);
	}
	@keyframes appear {
		from {
			opacity: 0;
		}
	}
	.dur {
		font-size: var(--fs-xs);
		line-height: var(--lh-xs);
		color: var(--fg-subtle);
	}
	.foot {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--s3);
	}
</style>
