<script lang="ts">
	interface Props {
		value: number;
		min: number;
		max: number;
		/** Value of the centre detent and double-click reset. */
		centre?: number;
		/** Coarse step: drag, scroll and arrows move along this grid. */
		step?: number;
		/** Shift step. */
		fineStep?: number;
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
		fineStep = 1,
		disabled = false,
		label,
		onchange
	}: Props = $props();

	const TICKS = 25;
	const SWEEP = 270;
	const PX_PER_STEP = 10;
	const PX_PER_FINE = 4;
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

	let drag: { y: number; base: number; shift: boolean } | null = null;
	let wheelAcc = 0;

	/**
	 * Move n coarse steps from v along the step grid (anchored at centre). Off-grid values go to
	 * the nearest grid point in the direction of travel first.
	 */
	function stepFrom(v: number, n: number): number {
		if (n === 0) return v;
		const g = (v - centre) / step;
		const k = n > 0 ? Math.floor(g + 1e-9) + n : Math.ceil(g - 1e-9) + n;
		return clamp(centre + k * step);
	}

	function move(e: PointerEvent) {
		if (!drag) return;
		// Re-anchor when Shift changes so switching resolution mid-drag never jumps.
		if (e.shiftKey !== drag.shift) drag = { y: e.clientY, base: value, shift: e.shiftKey };
		const dy = drag.y - e.clientY;
		const v = e.shiftKey
			? clamp(
					Math.round((drag.base + Math.trunc(dy / PX_PER_FINE) * fineStep) / fineStep) * fineStep
				)
			: stepFrom(drag.base, Math.trunc(dy / PX_PER_STEP));
		if (v !== value) onchange(v);
	}

	function down(e: PointerEvent) {
		if (disabled || e.button !== 0) return;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		drag = { y: e.clientY, base: value, shift: e.shiftKey };
	}

	function wheel(e: WheelEvent) {
		if (disabled) return;
		e.preventDefault();
		wheelAcc += e.deltaY;
		const n = Math.trunc(wheelAcc / 16);
		if (!n) return;
		wheelAcc -= n * 16;
		onchange(e.shiftKey ? clamp(value - n * fineStep) : stepFrom(value, -n));
	}

	function key(e: KeyboardEvent) {
		if (disabled) return;
		const up = e.key === 'ArrowUp' || e.key === 'ArrowRight';
		const dn = e.key === 'ArrowDown' || e.key === 'ArrowLeft';
		if (!up && !dn) return;
		e.preventDefault();
		e.stopPropagation();
		const d = up ? 1 : -1;
		onchange(e.shiftKey ? clamp(value + d * fineStep) : stepFrom(value, d));
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
