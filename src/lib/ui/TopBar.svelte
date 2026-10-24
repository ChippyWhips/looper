<script lang="ts">
	import { APP_NAME } from '../config';
	import type { App } from '../state/app.svelte';
	import { formatDuration } from '../time';
	import Chevron from './icons/Chevron.svelte';
	import TextButton from './components/TextButton.svelte';
	import Recent from './Recent.svelte';
	import TextToggle from './components/TextToggle.svelte';

	interface Props {
		app: App;
		onopen: () => void;
	}
	let { app, onopen }: Props = $props();
	const t = $derived(app.track);
	const st = $derived(app.stems);
</script>

<header class="top">
	<span class="name">{APP_NAME}</span>
	{#if t.loaded || t.name || app.recent.length}
		<span class="anchor">
			<button
				class="title"
				onclick={() => (app.view.recentOpen = !app.view.recentOpen)}
				aria-expanded={app.view.recentOpen}
				aria-haspopup="menu"
				data-testid="title"
			>
				<span class="track">{t.name}</span>
				<span class="dur">{formatDuration(t.length, t.sampleRate)}</span>
				<span class="chev"><Chevron /></span>
			</button>
			{#if app.recent.length}
				<Recent {app} open={app.view.recentOpen} />
			{/if}
		</span>
	{/if}
	{#if t.loaded}
		<span class="stems" data-testid="stems-status">
			{#if st.status === 'running'}
				<span class="dot" aria-hidden="true"></span>
				<span class="mono">Stems{st.slow ? ' (slow)' : ''} {Math.floor(st.fraction * 100)}%</span>
				<TextButton onclick={() => st.stop()} testid="stems-stop">Stop</TextButton>
			{:else if st.status === 'stopped'}
				<TextButton onclick={() => st.start()} testid="stems-separate">Separate</TextButton>
			{:else if st.status === 'failed'}
				<span class="mono">Stems failed</span>
				<TextButton onclick={() => st.start()} testid="stems-retry">Retry</TextButton>
			{:else if st.status === 'unavailable'}
				<span class="mono subtle">Stems unavailable in this browser</span>
			{:else if st.hasLanes}
				<TextToggle
					label="Stems"
					on={st.open}
					dot="primary"
					onclick={() => (st.open = !st.open)}
					testid="stems-toggle"
				/>
			{/if}
		</span>
	{/if}
	<span class="actions">
		<TextButton onclick={onopen} testid="open">Open</TextButton>
		<TextButton onclick={() => (app.view.shortcutsOpen = !app.view.shortcutsOpen)} label="Shortcuts"
			>?</TextButton
		>
	</span>
</header>

<style>
	.top {
		display: flex;
		align-items: center;
		gap: var(--s5);
		height: var(--topbar-h);
		padding: 0 var(--s4);
		border-bottom: var(--line) solid var(--border-subtle);
		background: var(--bg-default);
	}
	.name {
		font-size: var(--fs-sm);
		line-height: var(--lh-sm);
		font-weight: var(--fw-medium);
		color: var(--fg-muted);
	}
	.anchor {
		position: relative;
		display: flex;
		align-items: center;
		height: 100%;
		min-width: 0;
	}
	.title {
		display: inline-flex;
		align-items: baseline;
		gap: var(--s2);
		min-width: 0;
		& .track {
			font-size: var(--fs-sm);
			line-height: var(--lh-sm);
			color: var(--fg-primary);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			max-width: 40vw;
		}
		& .dur {
			font-family: var(--font-mono);
			font-size: var(--fs-xs);
			line-height: var(--lh-xs);
			color: var(--fg-subtle);
		}
		& .chev {
			align-self: center;
			display: inline-flex;
			color: var(--fg-subtle);
			transition: color var(--dur-fast) var(--ease-out);
		}
		&:hover .chev {
			color: var(--fg-primary);
		}
	}
	.stems {
		display: inline-flex;
		align-items: center;
		gap: var(--s2);
		& :global(button) {
			margin-left: var(--s1);
		}
	}
	.dot {
		width: var(--dot);
		height: var(--dot);
		border-radius: 50%;
		background: var(--accent);
	}
	.mono {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		line-height: var(--lh-xs);
		color: var(--fg-muted);
		&.subtle {
			color: var(--fg-subtle);
		}
	}
	.actions {
		margin-left: auto;
		display: flex;
		gap: var(--s3);
	}
</style>
