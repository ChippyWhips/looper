<script lang="ts">
	import '@fontsource/geist-mono/400.css';
	import '#lib/ui/tokens.css';
	import favicon from '#lib/assets/favicon.svg';
	import { APP_NAME } from '#lib/config.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<title>{APP_NAME}</title>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
