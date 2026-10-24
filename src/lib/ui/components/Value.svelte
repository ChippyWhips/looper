<script lang="ts">
	interface Props {
		/** Current value; null shows an em dash. */
		value: number | null;
		format: (v: number) => string;
		/** Parse typed text; null rejects it. */
		parse: (text: string) => number | null;
		/** Change per scrub step; Shift multiplies by 10. */
		step: number;
		min?: number;
		max?: number;
		label: string;
		size?: 'md' | 'lg';
		disabled?: boolean;
		/** `typed` is true for Enter, `alt` for Alt+Enter / Alt-held scrubs. */
		onchange: (v: number, opts: { typed: boolean; alt: boolean }) => void;
		suffix?: string;
		testid?: string;
	}

	let {
		value,
		format,
		parse,
		step,
		min = -Infinity,
		max = Infinity,
		label,
		size = 'md',
		disabled = false,
		onchange,
		suffix,
		testid
	}: Props = $props();

	let editing = $state(false);
	let text = $state('');
	let input: HTMLInputElement | undefined = $state();
	let drag: { y: number; base: number; moved: boolean; acc: number } | null = null;
	let wheelAcc = 0;

	const clamp = (v: number) => Math.min(max, Math.max(min, v));
	const shown = $derived(value === null ? '—' : format(value));
	const inactive = $derived(disabled || value === null);

	function startEdit() {
		if (inactive) return;
		text = shown;
		editing = true;
		queueMicrotask(() => {
			input?.focus();
			input?.select();
		});
	}

	function commit(alt: boolean) {
		const v = parse(text);
		editing = false;
		if (v !== null) onchange(clamp(v), { typed: true, alt });
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commit(e.altKey);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			editing = false;
		}
		e.stopPropagation();
	}

	function onpointerdown(e: PointerEvent) {
		if (inactive || editing || e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = { y: e.clientY, base: value ?? 0, moved: false, acc: 0 };
	}

	function onpointermove(e: PointerEvent) {
		if (!drag || value === null) return;
		const dy = drag.y - e.clientY;
		if (!drag.moved && Math.abs(dy) < 3) return;
		drag.moved = true;
		const steps = Math.trunc(dy / 4);
		const v = clamp(drag.base + steps * step * (e.shiftKey ? 10 : 1));
		if (v !== value) onchange(v, { typed: false, alt: e.altKey });
	}

	function onpointerup() {
		const d = drag;
		drag = null;
		if (d && !d.moved) startEdit();
	}

	function onwheel(e: WheelEvent) {
		if (inactive || editing || value === null) return;
		e.preventDefault();
		wheelAcc += e.deltaY;
		const steps = Math.trunc(wheelAcc / 16);
		if (steps === 0) return;
		wheelAcc -= steps * 16;
		onchange(clamp(value - steps * step * (e.shiftKey ? 10 : 1)), { typed: false, alt: e.altKey });
	}

	function onkey(e: KeyboardEvent) {
		if (inactive) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			startEdit();
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			e.stopPropagation();
			const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
			onchange(clamp((value ?? 0) + d), { typed: false, alt: e.altKey });
		}
	}
</script>

<span class="value {size}" class:inactive class:editing data-testid={testid}>
	{#if editing}
		<input
			bind:this={input}
			bind:value={text}
			aria-label={label}
			spellcheck="false"
			autocomplete="off"
			{onkeydown}
			onblur={() => (editing = false)}
		/>
	{:else}
		<span
			class="read"
			role="spinbutton"
			tabindex={inactive ? -1 : 0}
			aria-label={label}
			aria-valuenow={value ?? undefined}
			aria-valuetext={shown}
			{onpointerdown}
			{onpointermove}
			{onpointerup}
			{onwheel}
			onkeydown={onkey}
			>{#key value === null}<span class="text" class:appear={value !== null}>{shown}</span
				>{/key}</span
		>
	{/if}{#if suffix}<span class="suffix">{suffix}</span>{/if}
</span>

<style>
	.value {
		display: inline-flex;
		align-items: baseline;
		gap: var(--s1);
		font-family: var(--font-mono);
		font-size: var(--fs-md);
		line-height: var(--lh-md);
		font-weight: var(--fw-regular);
		color: var(--fg-primary);
		white-space: nowrap;
	}
	.lg {
		font-size: var(--fs-lg);
		line-height: var(--lh-lg);
	}
	.read {
		cursor: ns-resize;
		transition: color var(--dur-fast) var(--ease-out);
	}
	/* Values fade in on the Slow tier when a track first loads; changes after that are instant. */
	.appear {
		animation: appear var(--dur-slow) var(--ease-out);
	}
	@keyframes appear {
		from {
			opacity: 0;
		}
	}
	.inactive {
		color: var(--fg-subtle);
		& .read {
			cursor: default;
		}
	}
	.value:not(.inactive) .read {
		color: var(--fg-primary);
	}
	input {
		font: inherit;
		color: var(--fg-primary);
		field-sizing: content;
		min-width: 2ch;
		padding: 0;
		outline: none;
		border-bottom: var(--line) solid var(--fg-primary);
		margin-bottom: calc(-1 * var(--line));
		user-select: text;
	}
	.suffix {
		font-size: var(--fs-xs);
		line-height: var(--lh-xs);
		color: var(--fg-subtle);
	}
</style>
