<script lang="ts">
	import { onMount } from 'svelte';
	import type { App } from '../state/app.svelte';
	import { FeatureTracker } from '../viz/features';
	import { drawStatic, GradientRenderer, readPalette } from '../viz/gradient';

	interface Props {
		app: App;
	}
	let { app }: Props = $props();
	let canvas: HTMLCanvasElement;

	const SCALE = 0.5;
	const PAUSED_RATE = (2 * Math.PI) / (20 * 1.0);
	const MAX_EXPOSURE_SLEW = 1.5;

	onMount(() => {
		const palette = readPalette(canvas);
		const gl = GradientRenderer.create(canvas);
		const reduce = matchMedia('(prefers-reduced-motion: reduce)');
		const tracker = new FeatureTracker();
		let raf = 0;
		let last = 0;
		let lastDraw = -Infinity;
		let time = 0;
		let exposure = 0.5;

		const size = () => {
			const r = canvas.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			canvas.width = Math.max(1, Math.round(r.width * dpr * SCALE));
			canvas.height = Math.max(1, Math.round(r.height * dpr * SCALE));
			if (!gl) drawStatic(canvas, palette);
			lastDraw = -Infinity;
		};
		const ro = new ResizeObserver(size);
		ro.observe(canvas);
		size();
		if (!gl) return () => ro.disconnect();
		gl.setPalette(palette);
		(window as unknown as { __vizFrames?: number }).__vizFrames = 0;

		const frame = (now: number) => {
			raf = requestAnimationFrame(frame);
			if (document.hidden) return;
			const playing = app.transport.state === 'playing';
			const minGap = reduce.matches ? 1000 : playing ? 1000 / 60 - 1 : 100;
			if (now - lastDraw < minGap) return;
			const dt = Math.min(250, last ? now - last : 16);
			last = now;
			lastDraw = now;
			const f = tracker.update(app.engine.analyser, app.engine.sampleRate, dt, playing);
			const rate = PAUSED_RATE * (playing ? 1 + 2.5 * f.mid : 1);
			if (!reduce.matches) time += (dt / 1000) * rate;
			const target = playing ? 0.45 + 0.5 * f.rms : 0.5;
			const maxStep = (MAX_EXPOSURE_SLEW * dt) / 1000;
			exposure += Math.max(-maxStep, Math.min(maxStep, target - exposure));
			gl.render({
				time,
				warp: playing ? f.mid : 0,
				low: f.low,
				high: f.high,
				exposure,
				grain: 0.04 + 0.04 * f.high,
				seed: reduce.matches ? 0 : (now % 1000) * 0.37
			});
			(window as unknown as { __vizFrames: number }).__vizFrames++;
		};
		raf = requestAnimationFrame(frame);
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
		};
	});
</script>

<canvas class="viz" bind:this={canvas} data-testid="visualiser" aria-hidden="true"></canvas>

<style>
	.viz {
		display: block;
		width: 100%;
		height: 100%;
		min-width: 0;
		background: var(--bg-sunken);
	}
</style>
