<script lang="ts">
	import { onMount } from 'svelte';
	import type { App } from '../state/app.svelte';
	import { drawLanes, readColors, type Colors } from './waveform/render';

	import type { WaveformInput } from './waveform/input.svelte';

	interface Props {
		app: App;
		input: WaveformInput;
	}
	let { app, input }: Props = $props();
	let canvas: HTMLCanvasElement | undefined = $state();
	let host: HTMLElement;
	const stems = $derived(app.stems);
	const lanes = $derived(stems.lanes);
	const shown = $derived(stems.open && lanes.length > 0);
	const LANE_H = 40;

	onMount(() => {
		let colors: Colors = readColors(host);
		let last = '';
		let raf = 0;
		const frame = () => {
			raf = requestAnimationFrame(frame);
			if (!canvas || !app.stems.open || !app.stems.lanes.length) return;
			const t = app.track;
			const ph = t.loaded ? app.position() : null;
			const vp = app.viewport;
			const l = app.loop;
			const audible = app.stems.audibleNames();
			const key = [
				vp.version,
				vp.start,
				vp.fpp,
				ph,
				l.start,
				l.end,
				l.on,
				app.stems.version,
				app.stems.lanes.map((x) => `${x.name}${audible.includes(x.name)}`).join(),
				canvas.clientWidth,
				canvas.clientHeight
			].join('|');
			if (key === last) return;
			last = key;
			drawLanes(canvas, {
				viewport: vp,
				lanes: app.stems.lanes.map((x) => ({
					levels: x.levels,
					audible: audible.includes(x.name)
				})),
				laneHeight: LANE_H,
				loop: l.exists ? { start: l.start, end: l.end, on: l.on, selected: null } : null,
				playhead: ph,
				colors
			});
		};
		raf = requestAnimationFrame(frame);
		const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
		const onDpr = () => {
			colors = readColors(host);
			last = '';
		};
		mq.addEventListener('change', onDpr);
		return () => {
			cancelAnimationFrame(raf);
			mq.removeEventListener('change', onDpr);
		};
	});
</script>

<section
	class="lanes"
	class:shown
	bind:this={host}
	style:--lanes={shown ? lanes.length : 0}
	data-testid="lanes"
	aria-label="Stems"
>
	{#if lanes.length}
		<canvas
			bind:this={canvas}
			style:cursor={input.cursor}
			onpointerdown={(e) => canvas && input.mainDown(e, canvas)}
			onpointermove={(e) => canvas && input.mainMove(e, canvas)}
			onpointerup={(e) => canvas && input.mainUp(e, canvas)}
			onpointerleave={() => input.mainLeave()}
			onwheel={(e) => canvas && input.wheel(e, canvas)}
		></canvas>
		<div class="gutters">
			{#each lanes as lane (lane.name)}
				<div class="gutter" data-testid="lane-{lane.name}">
					<span class="name">{lane.label}</span>
					<button
						class="ms"
						class:on={lane.muted}
						aria-pressed={lane.muted}
						aria-label="Mute {lane.label}"
						onclick={() => app.stems.toggleMute(lane.name)}>M</button
					>
					<button
						class="ms"
						class:on={lane.soloed}
						aria-pressed={lane.soloed}
						aria-label="Solo {lane.label}"
						onclick={() => app.stems.toggleSolo(lane.name)}>S</button
					>
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	.lanes {
		position: relative;
		height: calc(var(--lanes) * (var(--lane-h) + var(--line)));
		background: var(--bg-sunken);
		overflow: hidden;
		opacity: 0;
		transition: opacity var(--dur-slow) var(--ease-out);
		&.shown {
			opacity: 1;
		}
	}
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}
	.gutters {
		position: absolute;
		inset: 0 auto 0 0;
		width: var(--gutter-w);
		display: flex;
		flex-direction: column;
	}
	.gutter {
		height: calc(var(--lane-h) + var(--line));
		border-top: var(--line) solid var(--border-subtle);
		display: flex;
		align-items: center;
		gap: var(--s1);
		padding: 0 var(--s2) 0 var(--s4);
		background: var(--bg-sunken);
		border-right: var(--line) solid var(--border-subtle);
	}
	.name {
		flex: 1;
		margin-right: var(--s1);
		min-width: 0;
		font-size: var(--fs-sm);
		line-height: var(--lh-sm);
		color: var(--fg-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ms {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		line-height: var(--lh-xs);
		color: var(--fg-subtle);
		transition: color var(--dur-fast) var(--ease-out);
		&:hover {
			color: var(--fg-muted);
		}
		&.on {
			color: var(--fg-primary);
		}
	}
</style>
