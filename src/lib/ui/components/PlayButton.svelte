<script lang="ts">
	import Pause from '../icons/Pause.svelte';
	import Play from '../icons/Play.svelte';
	interface Props {
		playing: boolean;
		disabled: boolean;
		onclick: () => void;
	}
	let { playing, disabled, onclick }: Props = $props();
</script>

<button
	class="play"
	{disabled}
	{onclick}
	aria-label={playing ? 'Pause' : 'Play'}
	data-testid="play"
>
	{#if playing}<Pause />{:else}<Play />{/if}
</button>

<style>
	.play {
		flex: none;
		width: var(--play-size);
		height: var(--play-size);
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--fg-primary);
		color: var(--fg-on-primary);
		transition: opacity var(--dur-fast) var(--ease-out);
		&:hover:not(:disabled) {
			opacity: 0.9;
		}
		&:disabled {
			background: var(--fg-subtle);
			cursor: default;
		}
	}
</style>
