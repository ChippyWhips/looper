<script lang="ts">
	import { onMount } from 'svelte';
	import type { App } from '../state/app.svelte';
	import { drawMain, drawOverview, drawRuler, readColors, type Colors } from './waveform/render';
	import type { WaveformInput } from './waveform/input.svelte';

	interface Props {
		app: App;
		input: WaveformInput;
	}
	let { app, input }: Props = $props();

	let area: HTMLElement;
	let ruler: HTMLCanvasElement;
	let overview: HTMLCanvasElement;
	let main: HTMLCanvasElement;

	const track = $derived(app.track);
	// analysisVersion makes the non-reactive peaks field observable.
	const shown = $derived(
		track.analysisVersion >= 0 && track.loaded && (track.peaks?.levels.length ?? 0) > 0
	);

	onMount(() => {
		let colors: Colors = readColors(area);
		const monoFont = getComputedStyle(area).getPropertyValue('--font-mono').trim();
		let last = '';
		let raf = 0;
		const vp = app.viewport;

		const ro = new ResizeObserver(() => {
			vp.setWidth(main.getBoundingClientRect().width);
			last = '';
		});
		ro.observe(main);
		const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
		const onDpr = () => {
			colors = readColors(area);
			last = '';
		};
		mq.addEventListener('change', onDpr);
		// Safari reports trackpad pinch as gesture events rather than ctrl + wheel.
		type Gesture = Event & { scale: number; clientX: number };
		const gs = (e: Event) => {
			e.preventDefault();
			input.gestureStart();
		};
		const gc = (e: Event) => {
			e.preventDefault();
			const g = e as Gesture;
			input.gestureChange(g.scale, g.clientX - main.getBoundingClientRect().left);
		};
		main.addEventListener('gesturestart', gs);
		main.addEventListener('gesturechange', gc);

		const frame = () => {
			raf = requestAnimationFrame(frame);
			const t = app.track;
			const ph = t.loaded ? app.tick() : null;
			const l = app.loop;
			const key = [
				vp.version,
				vp.start,
				vp.fpp,
				t.analysisVersion,
				t.length,
				ph,
				l.start,
				l.end,
				l.on,
				l.selected,
				input.preview?.start,
				input.preview?.end
			].join('|');
			if (key === last) return;
			last = key;
			const levels = t.peaks?.levels ?? [];
			const loopDraw =
				input.preview ??
				(l.exists ? { start: l.start, end: l.end, on: l.on, selected: l.selected } : null);
			drawRuler(ruler, { viewport: vp, sampleRate: t.sampleRate, playhead: ph, colors, monoFont });
			drawOverview(overview, { viewport: vp, levels, loop: loopDraw, playhead: ph, colors });
			drawMain(main, {
				viewport: vp,
				levels,
				channels: t.channels,
				sampleRate: t.sampleRate,
				loop: loopDraw,
				playhead: ph,
				colors,
				monoFont
			});
		};
		raf = requestAnimationFrame(frame);
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			mq.removeEventListener('change', onDpr);
			main.removeEventListener('gesturestart', gs);
			main.removeEventListener('gesturechange', gc);
		};
	});
</script>

<section class="wave" bind:this={area} class:drop={app.view.dropActive} data-testid="waveform">
	<canvas class="ruler" bind:this={ruler}></canvas>
	<canvas
		class="overview"
		bind:this={overview}
		class:shown
		onpointerdown={(e) => input.overviewDown(e, overview)}
		onpointermove={(e) => input.overviewMove(e, overview)}
		onpointerup={(e) => input.overviewUp(e)}
	></canvas>
	<div class="main-wrap">
		<canvas
			class="main"
			class:shown
			bind:this={main}
			style:cursor={input.cursor}
			data-testid="wave-main"
			onpointerdown={(e) => input.mainDown(e, main)}
			onpointermove={(e) => input.mainMove(e, main)}
			onpointerup={(e) => input.mainUp(e, main)}
			onpointerleave={() => input.mainLeave()}
			onwheel={(e) => input.wheel(e, main)}
		></canvas>
		{#if app.view.dropActive}
			<p class="msg">Drop</p>
		{:else if track.status === 'error'}
			<p class="msg error" data-testid="error"><span class="dot"></span>{track.error}</p>
		{:else if track.status === 'empty'}
			<p class="msg empty">Drop a track or press ⌘O</p>
		{/if}
	</div>
</section>

<style>
	.wave {
		position: relative;
		display: grid;
		grid-template-rows: var(--ruler-h) var(--overview-h) 1fr;
		background: var(--bg-sunken);
		min-height: 0;
		outline: var(--line) solid transparent;
		outline-offset: calc(-1 * var(--line));
		&.drop {
			outline-color: var(--fg-primary);
		}
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		min-width: 0;
	}
	.overview {
		border-bottom: var(--line) solid var(--border-subtle);
		cursor: pointer;
	}
	.overview,
	.main {
		opacity: 0;
		transition: opacity var(--dur-slow) var(--ease-out);
		&.shown {
			opacity: 1;
		}
	}
	.main-wrap {
		position: relative;
		min-height: 0;
	}
	.msg {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--s2);
		pointer-events: none;
		font-size: var(--fs-sm);
		line-height: var(--lh-sm);
		color: var(--fg-muted);
	}
	.error {
		color: var(--fg-primary);
	}
	.dot {
		width: var(--dot);
		height: var(--dot);
		border-radius: 50%;
		background: var(--accent);
	}
</style>
