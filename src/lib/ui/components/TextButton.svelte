<script lang="ts">
	import type { Snippet } from 'svelte';
	interface Props {
		onclick: () => void;
		label?: string;
		children: Snippet;
		testid?: string;
	}
	let { onclick, label, children, testid }: Props = $props();
</script>

<button class="text" {onclick} aria-label={label} data-testid={testid}>{@render children()}</button>

<style>
	.text {
		font-size: var(--fs-sm);
		line-height: var(--lh-sm);
		color: var(--fg-muted);
		transition: color var(--dur-fast) var(--ease-out);
		&:hover {
			color: var(--fg-primary);
		}
	}
</style>
