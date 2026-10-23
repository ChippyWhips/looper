<script lang="ts">
	import type { App } from '../state/app.svelte';
	import LoopModule from './deck/LoopModule.svelte';
	import Transport from './deck/Transport.svelte';

	interface Props {
		app: App;
	}
	let { app }: Props = $props();
</script>

<footer class="deck" data-testid="deck">
	<Transport {app} />
	<LoopModule {app} />
	<div class="module speed"></div>
	<div class="module pitch"></div>
	<div class="viz"></div>
</footer>

<style>
	.deck {
		display: grid;
		grid-template-columns: var(--transport-w) minmax(var(--loop-min-w), 1fr) 1fr 1fr var(--viz-w);
		height: var(--deck-h);
		border-top: var(--line) solid var(--border-subtle);
		background: var(--bg-default);
		& > :global(* + *) {
			border-left: var(--line) solid var(--border-subtle);
		}
		& :global(.module) {
			padding: var(--s4);
			min-width: 0;
		}
	}
</style>
