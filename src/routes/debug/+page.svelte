<script lang="ts">
	import { onMount } from 'svelte';
	import { Engine } from '#lib/audio/engine.ts';
	import { formatTime } from '#lib/time.ts';

	const engine = new Engine();
	let loaded = $state(false);
	let playing = $state(false);
	let loopStart = $state(0);
	let loopEnd = $state(0);
	let loopOn = $state(false);
	let speed = $state(100);
	let cents = $state(0);
	let readout: HTMLSpanElement;

	engine.events.state = (s) => (playing = s !== 'stopped');

	async function open(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		const buffer = await engine.decode(await file.arrayBuffer());
		await engine.load(buffer);
		loaded = true;
	}

	function toggle() {
		if (playing) engine.pause();
		else void engine.play(engine.position());
	}

	$effect(() => {
		const sr = engine.sampleRate;
		engine.setLoop({
			start: Math.round(loopStart * sr),
			end: Math.round(loopEnd * sr),
			on: loopOn
		});
	});
	$effect(() => engine.setParams(speed / 100, cents));

	onMount(() => {
		let raf = 0;
		const tick = () => {
			// rAF-driven readout bypasses reactive state by design.
			// eslint-disable-next-line svelte/no-dom-manipulating
			if (readout) readout.textContent = formatTime(engine.position(), engine.sampleRate);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});
</script>

<main class="debug">
	<input type="file" accept="audio/*" onchange={open} />
	<button onclick={toggle} disabled={!loaded}>{playing ? 'Pause' : 'Play'}</button>
	<span bind:this={readout}>0:00.000</span>
	<label>In <input type="number" step="0.001" bind:value={loopStart} /></label>
	<label>Out <input type="number" step="0.001" bind:value={loopEnd} /></label>
	<button onclick={() => (loopOn = !loopOn)}>Loop {loopOn ? 'on' : 'off'}</button>
	<label>Speed <input type="number" min="25" max="150" bind:value={speed} /></label>
	<label>Pitch <input type="number" min="-1200" max="1200" bind:value={cents} /></label>
</main>

<style>
	.debug {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
		padding: var(--s4);
		font-family: var(--font-mono);
		user-select: text;
		& input {
			border-bottom: var(--line) solid var(--border-strong);
		}
	}
</style>
