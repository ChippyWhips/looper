<script lang="ts">
	interface Props {
		value: number;
		min: number;
		max: number;
		/** Value of the centre detent and double-click reset. */
		centre?: number;
		step?: number;
		disabled?: boolean;
		label: string;
		onchange: (v: number) => void;
	}
	let {
		value,
		min,
		max,
		centre = 0,
		step = 1,
		disabled = false,
		label,
		onchange
	}: Props = $props();

	const TICKS = 25;
	const SWEEP = 270;
	const PX_PER_STEP = 4;
	const DETENT_PX = 6;
	const SIZE = 56;
	const GAP = 4;
	const TICK = 4;
	const R = SIZE / 2;
	const BOX = SIZE + 2 * (GAP + TICK);
	const C = BOX / 2;

	const clamp = (v: number) => Math.min(max, Math.max(min, v));
	const angleOf = (v: number) => -SWEEP / 2 + ((v - min) / (max - min)) * SWEEP;
	const tickValue = (i: number) => min + (i / (TICKS - 1)) * (max - min);

	const ticks = $derived(
		Array.from({ length: TICKS }, (_, i) => {
			const tv = tickValue(i);
			const lit = value >= centre ? tv >= centre && tv <= value : tv <= centre && tv >= value;
			const a = ((angleOf(tv) - 90) * Math.PI) / 180;
			const r0 = R + GAP;
			const r1 = r0 + TICK;
			return {
				x1: C + r0 * Math.cos(a),
				y1: C + r0 * Math.sin(a),
				x2: C + r1 * Math.cos(a),
				y2: C + r1 * Math.sin(a),
				lit
			};
		})
	);
	const ind = $derived.by(() => {
		const a = ((angleOf(value) - 90) * Math.PI) / 180;
		return {
			x1: C + R * 0.3 * Math.cos(a),
			y1: C + R * 0.3 * Math.sin(a),
			x2: C + R * 0.85 * Math.cos(a),
			y2: C + R * 0.85 * Math.sin(a)
		};
	});

	let drag: { y: number; base: number } | null = null;
	let wheelAcc = 0;

	/** Value for a drag of dy px (up positive), with a ±6 px dead band at the centre detent. */
	function dragValue(dy: number, fine: number, alt: boolean): number {
		const base = drag!.base;
		const perPx = (step * fine) / PX_PER_STEP;
		if (alt) return clamp(Math.round((base + dy * perPx) / step) * step);
		const z = (centre - base) / perPx;
		const rel = dy - z;
		if (Math.abs(rel) <= DETENT_PX) return centre;
		// Passing through the detent costs its dead band.
		const crossed = Math.abs(z) <= DETENT_PX || Math.sign(rel) !== Math.sign(-z);
		const p = crossed ? dy - Math.sign(rel) * DETENT_PX : dy;
		return clamp(Math.round((base + p * perPx) / step) * step);
	}

	function down(e: PointerEvent) {
		if (disabled || e.button !== 0) return;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		drag = { y: e.clientY, base: value };
	}

	function move(e: PointerEvent) {
		if (!drag) return;
		const v = dragValue(drag.y - e.clientY, e.shiftKey ? 10 : 1, e.altKey);
		if (v !== value) onchange(v);
	}

	function wheel(e: WheelEvent) {
		if (disabled) return;
		e.preventDefault();
		wheelAcc += e.deltaY;
		const n = Math.trunc(wheelAcc / 16);
		if (!n) return;
		wheelAcc -= n * 16;
		onchange(clamp(value - n * step * (e.shiftKey ? 10 : 1)));
	}

	function key(e: KeyboardEvent) {
		if (disabled) return;
		const up = e.key === 'ArrowUp' || e.key === 'ArrowRight';
		const dn = e.key === 'ArrowDown' || e.key === 'ArrowLeft';
		if (!up && !dn) return;
		e.preventDefault();
		e.stopPropagation();
		onchange(clamp(value + (up ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
	}
</script>

<svg
	class="knob"
	class:disabled
	width={BOX}
	height={BOX}
	viewBox="0 0 {BOX} {BOX}"
	role="slider"
	tabindex={disabled ? -1 : 0}
	aria-label={label}
	aria-valuemin={min}
	aria-valuemax={max}
	aria-valuenow={value}
	onpointerdown={down}
	onpointermove={move}
	onpointerup={() => (drag = null)}
	onwheel={wheel}
	onkeydown={key}
	ondblclick={() => !disabled && onchange(centre)}
	data-testid="knob"
>
	{#each ticks as t, i (i)}
		<line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} class="tick" class:lit={t.lit} />
	{/each}
	<circle cx={C} cy={C} r={R} class="body" />
	<circle cx={C} cy={C} r={R} class="wash" />
	<line x1={ind.x1} y1={ind.y1} x2={ind.x2} y2={ind.y2} class="ind" />
</svg>

<style>
	.knob {
		display: block;
		flex: none;
		cursor: ns-resize;
		touch-action: none;
		&.disabled {
			cursor: default;
		}
	}
	.tick {
		stroke: var(--control-track);
		stroke-width: var(--line);
		&.lit {
			stroke: var(--control-fill);
		}
	}
	.body {
		fill: var(--control-bg);
	}
	.wash {
		fill: var(--control-bg-hover);
		opacity: 0;
		transition: opacity var(--dur-fast) var(--ease-out);
	}
	.knob:hover:not(.disabled) .wash {
		opacity: 1;
	}
	.ind {
		stroke: var(--control-fill);
		stroke-width: var(--line-strong);
	}
	.disabled .ind,
	.disabled .tick.lit {
		stroke: var(--control-track);
	}
</style>
