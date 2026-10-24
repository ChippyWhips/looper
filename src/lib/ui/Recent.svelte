<script lang="ts">
	import type { App } from '../state/app.svelte';
	import { formatDuration } from '../time';
	import Close from './icons/Close.svelte';

	interface Props {
		app: App;
		open: boolean;
	}
	let { app, open }: Props = $props();

	const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
</script>

<div
	class="panel"
	class:open
	role="menu"
	aria-label="Recent tracks"
	aria-hidden={!open}
	inert={!open}
	data-testid="recent"
>
	{#each app.recent as e (e.id)}
		<div class="row" class:current={e.id === app.track.id}>
			<button class="item" role="menuitem" onclick={() => app.openRecent(e)}>
				<span class="name">{e.name}</span>
				<span class="meta">{formatDuration(e.length, e.sampleRate)} · {mb(e.size)}</span>
			</button>
			<button
				class="remove"
				aria-label="Remove {e.name}"
				onclick={() => app.removeRecent(e.id)}
				data-testid="recent-remove"><Close /></button
			>
		</div>
	{/each}
</div>

<style>
	.panel {
		position: absolute;
		top: 100%;
		left: 0;
		width: var(--panel-w);
		background: var(--bg-raised);
		border: var(--line) solid var(--border-strong);
		z-index: 10;
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
	.row {
		position: relative;
		display: flex;
		align-items: center;
		height: var(--row-h);
		transition: background-color var(--dur-fast) var(--ease-out);
		&:hover,
		&:focus-within {
			background: var(--bg-interactive-hover);
		}
	}
	.item {
		flex: 1;
		min-width: 0;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s3);
		padding: 0 var(--s3);
		text-align: left;
	}
	.name {
		font-size: var(--fs-sm);
		line-height: var(--lh-sm);
		color: var(--fg-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.current .name {
		color: var(--fg-primary);
	}
	.meta {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		line-height: var(--lh-xs);
		color: var(--fg-subtle);
	}
	.remove {
		flex: none;
		display: grid;
		place-items: center;
		width: var(--row-h);
		height: 100%;
		color: var(--fg-subtle);
		opacity: 0;
		transition:
			opacity var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
		&:hover {
			color: var(--fg-primary);
		}
	}
	.row:hover .remove,
	.row:focus-within .remove {
		opacity: 1;
	}
</style>
