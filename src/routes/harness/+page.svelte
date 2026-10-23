<script lang="ts">
	import { onMount } from 'svelte';
	import { harness } from '#lib/audio/harness.ts';

	let ready = $state(false);
	onMount(() => {
		window.looperHarness = harness;
		ready = true;
	});
</script>

<main data-ready={ready}></main>
