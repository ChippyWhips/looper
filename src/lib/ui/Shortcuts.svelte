<script lang="ts">
	import type { App } from '../state/app.svelte';

	interface Props {
		app: App;
	}
	let { app }: Props = $props();

	const ROWS: [string, string][] = [
		['Space', 'Play / pause'],
		['Enter', 'Jump to loop start'],
		['L', 'Loop on / off'],
		['I / O', 'Set loop in / out'],
		['[ / ]', 'Select in / out edge'],
		['← / →', 'Nudge edge 1 ms · seek 1 s'],
		['⇧ ← / →', 'Nudge 10 ms · seek 5 s'],
		['⌥ ← / →', 'Nudge 1 sample'],
		[', / .', 'Speed preset'],
		['⇧ , / .', 'Speed ±1%'],
		['C', 'Count-in on / off'],
		['⌘ scroll  = / -', 'Zoom'],
		['0', 'Zoom to fit'],
		['Z', 'Zoom to loop'],
		['F', 'Follow playhead'],
		['⌘O', 'Open track'],
		['Esc', 'Deselect edge · close'],
		['?', 'Shortcuts']
	];
	const open = $derived(app.view.shortcutsOpen);
</script>

<div
	class="scrim"
	class:open
	inert={!open}
	aria-hidden={!open}
	onpointerdown={(e) => {
		if (e.target === e.currentTarget) app.view.shortcutsOpen = false;
	}}
	data-testid="shortcuts"
>
	<div class="panel" role="dialog" aria-label="Keyboard shortcuts">
		{#each ROWS as [k, a] (k)}
			<span class="key">{k}</span><span class="act">{a}</span>
		{/each}
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		z-index: 20;
		opacity: 0;
		visibility: hidden;
		transition:
			opacity var(--dur-base) var(--ease-out),
			visibility var(--dur-instant) linear var(--dur-base);
		&.open {
			opacity: 1;
			visibility: visible;
			transition:
				opacity var(--dur-base) var(--ease-out),
				visibility var(--dur-instant);
		}
	}
	.panel {
		display: grid;
		grid-template-columns: auto auto;
		column-gap: var(--s6);
		row-gap: var(--s2);
		padding: var(--s5);
		background: var(--bg-raised);
		border: var(--line) solid var(--border-strong);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		line-height: var(--lh-xs);
	}
	.key {
		color: var(--fg-primary);
		text-align: right;
	}
	.act {
		color: var(--fg-muted);
	}
</style>
