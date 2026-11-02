<script lang="ts">
	import { onMount } from 'svelte';
	import { runAutotest } from '../platform/autotest';
	import { App } from '../state/app.svelte';
	import Deck from './Deck.svelte';
	import Lanes from './Lanes.svelte';
	import Shortcuts from './Shortcuts.svelte';
	import { handleKey } from './keyboard';
	import TopBar from './TopBar.svelte';
	import Waveform from './Waveform.svelte';
	import { WaveformInput } from './waveform/input.svelte';

	// Desktop window chrome (traffic lights over the top bar) keys off this class.
	if (__DESKTOP__) document.documentElement.classList.add('desktop');

	const app = new App();
	const input = new WaveformInput(app);
	let picker: HTMLInputElement;
	let dragDepth = 0;

	function openPicker() {
		picker.click();
	}

	function onPick(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		const file = el.files?.[0];
		if (file) void app.open(file);
		el.value = '';
	}

	function onkeydown(e: KeyboardEvent) {
		if (handleKey(app, e, openPicker)) e.preventDefault();
	}

	/**
	 * Mouse clicks on controls do not take focus, so a later shortcut key neither activates the
	 * clicked control again nor reveals its focus ring. Keyboard (Tab) focus is unaffected.
	 */
	function onmousedown(e: MouseEvent) {
		const el = e.target as Element | null;
		if (el?.closest('button, [role=slider], [role=spinbutton], [role=menuitem]'))
			e.preventDefault();
	}

	function hasFiles(e: DragEvent) {
		return e.dataTransfer?.types.includes('Files') ?? false;
	}

	onMount(() => {
		void app.engine.prewarm([48000, 44100]);
		void app.restore().then(() => runAutotest(app));
		const stopAutosave = app.startAutosave();
		const hide = () => app.onPageHide();
		const vis = () => document.hidden && app.flushSave();
		addEventListener('pagehide', hide);
		document.addEventListener('visibilitychange', vis);
		const closeMenu = (e: PointerEvent) => {
			if (!app.view.recentOpen) return;
			const el = e.target as Element | null;
			if (!el?.closest('[data-testid=recent], [data-testid=title]')) app.view.recentOpen = false;
		};
		addEventListener('pointerdown', closeMenu);
		if (import.meta.env.DEV || location.search.includes('test')) {
			(window as unknown as { looper: App }).looper = app;
		}
		return () => {
			stopAutosave();
			removeEventListener('pagehide', hide);
			document.removeEventListener('visibilitychange', vis);
			removeEventListener('pointerdown', closeMenu);
		};
	});
</script>

<svelte:window
	{onkeydown}
	{onmousedown}
	ondragenter={(e) => {
		if (!hasFiles(e)) return;
		e.preventDefault();
		dragDepth++;
		app.view.dropActive = true;
	}}
	ondragover={(e) => {
		if (hasFiles(e)) e.preventDefault();
	}}
	ondragleave={() => {
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) app.view.dropActive = false;
	}}
	ondrop={(e) => {
		e.preventDefault();
		dragDepth = 0;
		app.view.dropActive = false;
		const file = e.dataTransfer?.files[0];
		if (file) void app.open(file);
	}}
/>

<div class="app">
	<TopBar {app} onopen={openPicker} />
	<Waveform {app} {input} />
	<Lanes {app} {input} />
	<Deck {app} />
	<Shortcuts {app} />
	<input
		bind:this={picker}
		class="picker"
		type="file"
		accept="audio/*,.mp3,.wav,.aif,.aiff,.flac,.m4a,.aac,.ogg,.opus"
		onchange={onPick}
		data-testid="picker"
		tabindex="-1"
		aria-hidden="true"
	/>
</div>

<style>
	.app {
		display: grid;
		grid-template-rows: var(--topbar-h) 1fr auto auto;
		height: 100vh;
		min-width: 1280px;
		min-height: 800px;
	}
	.picker {
		display: none;
	}
</style>
