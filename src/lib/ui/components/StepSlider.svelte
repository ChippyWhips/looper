<script lang="ts">
	interface Props {
		value: number;
		min: number;
		max: number;
		/** Detent values; each gets a tick and a clickable label. */
		detents: readonly number[];
		disabled?: boolean;
		label: string;
		onchange: (v: number) => void;
	}
	let { value, min, max, detents, disabled = false, label, onchange }: Props = $props();

	const SNAP_PX = 6;
	let track: HTMLDivElement;
	let width = $state(1);
	let dragging = false;

	/** Anchors are spaced evenly: min, each detent, max. Values map piecewise-linearly between them. */
	const anchors = $derived([min, ...detents, max]);

	function toT(v: number): number {
		const a = anchors;
		const seg = 1 / (a.length - 1);
		for (let i = 0; i < a.length - 1; i++) {
			if (v <= a[i + 1]) return (i + (v - a[i]) / (a[i + 1] - a[i])) * seg;
		}
		return 1;
	}

	function fromT(t: number): number {
		const a = anchors;
		const n = a.length - 1;
		const x = Math.min(1, Math.max(0, t)) * n;
		const i = Math.min(n - 1, Math.floor(x));
		return a[i] + (x - i) * (a[i + 1] - a[i]);
	}

	function valueAt(clientX: number, alt: boolean): number {
		const r = track.getBoundingClientRect();
		const px = clientX - r.left;
		if (!alt) {
			for (const d of detents) if (Math.abs(toT(d) * r.width - px) <= SNAP_PX) return d;
		}
		return Math.round(fromT(px / r.width));
	}

	function down(e: PointerEvent) {
		if (disabled || e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragging = true;
		onchange(valueAt(e.clientX, e.altKey));
	}

	function move(e: PointerEvent) {
		if (dragging) onchange(valueAt(e.clientX, e.altKey));
	}

	function key(e: KeyboardEvent) {
		if (disabled) return;
		const d =
			e.key === 'ArrowRight' || e.key === 'ArrowUp'
				? 1
				: e.key === 'ArrowLeft' || e.key === 'ArrowDown'
					? -1
					: 0;
		if (!d) return;
		e.preventDefault();
		e.stopPropagation();
		onchange(Math.min(max, Math.max(min, value + d)));
	}
</script>

<div class="slider" class:disabled>
	<div
		class="area"
		bind:this={track}
		bind:clientWidth={width}
		role="slider"
		tabindex={disabled ? -1 : 0}
		aria-label={label}
		aria-valuemin={min}
		aria-valuemax={max}
		aria-valuenow={value}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={() => (dragging = false)}
		onkeydown={key}
	>
		<span class="line"></span>
		{#each detents as d (d)}
			<span class="tick" style:left="{toT(d) * width}px"></span>
		{/each}
		<span class="handle" style:left="{toT(value) * width}px"></span>
	</div>
	<div class="labels">
		{#each detents as d (d)}
			<button
				class="detent"
				class:active={value === d}
				style:left="{toT(d) * width}px"
				{disabled}
				tabindex="-1"
				onclick={() => onchange(d)}>{d}</button
			>
		{/each}
	</div>
</div>

<style>
	.slider {
		position: relative;
	}
	.area {
		position: relative;
		height: var(--slider-handle-h);
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out);
		&:hover {
			background: var(--control-bg-hover);
		}
	}
	.disabled .area {
		cursor: default;
		&:hover {
			background: none;
		}
	}
	.line {
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: var(--line);
		background: var(--control-track);
	}
	.tick {
		position: absolute;
		top: 100%;
		width: var(--line);
		height: var(--tick-len);
		background: var(--control-track);
	}
	.handle {
		position: absolute;
		top: 0;
		width: var(--line-strong);
		height: var(--slider-handle-h);
		margin-left: calc(var(--line-strong) / -2);
		background: var(--control-fill);
	}
	.disabled .handle {
		background: var(--control-track);
	}
	.labels {
		position: relative;
		height: var(--lh-xs);
		margin-top: var(--s3);
	}
	.detent {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		line-height: var(--lh-xs);
		color: var(--fg-subtle);
		transition: color var(--dur-fast) var(--ease-out);
		&:hover:not(:disabled) {
			color: var(--fg-muted);
		}
		&.active:not(:disabled) {
			color: var(--fg-primary);
		}
		&:disabled {
			cursor: default;
		}
	}
</style>
