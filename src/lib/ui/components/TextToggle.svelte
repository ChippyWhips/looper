<script lang="ts">
	interface Props {
		label: string;
		on: boolean;
		/** Dot colour when on: accent for Loop / Count-in, primary for Snap. */
		dot?: 'accent' | 'primary';
		/** Dot lit independently of `on` (count-in beat flash). */
		flash?: boolean;
		/** Count-in running: the dot shows only the beat flash. */
		counting?: boolean;
		disabled?: boolean;
		onclick: () => void;
		testid?: string;
	}
	let {
		label,
		on,
		dot = 'accent',
		flash = false,
		counting = false,
		disabled = false,
		onclick,
		testid
	}: Props = $props();
</script>

<button
	class="toggle"
	class:on
	class:flash
	class:counting
	aria-pressed={on}
	{disabled}
	{onclick}
	data-testid={testid}
>
	<span class="dot {dot}" aria-hidden="true"></span>{label}
</button>

<style>
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--s2);
		font-size: var(--fs-sm);
		line-height: var(--lh-sm);
		color: var(--fg-muted);
		transition: color var(--dur-fast) var(--ease-out);
		&:hover:not(:disabled) {
			color: var(--fg-primary);
		}
		&:disabled {
			color: var(--fg-subtle);
			cursor: default;
		}
	}
	.dot {
		width: var(--dot);
		height: var(--dot);
		border-radius: 50%;
		box-sizing: border-box;
		border: var(--line) solid var(--fg-subtle);
	}
	.on .dot.accent,
	.flash .dot.accent {
		border: 0;
		background: var(--accent);
	}
	.on .dot.primary {
		border: 0;
		background: var(--fg-primary);
	}
	/* While counting in, the dot is off between beats even though the toggle is on. */
	.on.counting:not(.flash) .dot.accent {
		background: none;
		border: var(--line) solid var(--fg-subtle);
	}
</style>
