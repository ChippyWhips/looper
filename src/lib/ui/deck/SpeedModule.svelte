<script lang="ts">
	import type { App } from '../../state/app.svelte';
	import { SPEED_MAX, SPEED_MIN, SPEED_PRESETS } from '../../state/transport.svelte';
	import StepSlider from '../components/StepSlider.svelte';
	import Value from '../components/Value.svelte';

	interface Props {
		app: App;
	}
	let { app }: Props = $props();
	const loaded = $derived(app.track.loaded);
</script>

<div class="module speed">
	<div class="head">
		<span class="label">Speed</span>
		<Value
			value={loaded ? app.transport.speed : null}
			format={(v) => `${v}%`}
			parse={(s) => {
				const n = Number(s.replace('%', '').trim());
				return Number.isFinite(n) ? Math.round(n) : null;
			}}
			step={1}
			min={SPEED_MIN}
			max={SPEED_MAX}
			label="Speed"
			onchange={(v) => app.setSpeed(v)}
			testid="speed-value"
		/>
	</div>
	<div class="mid">
		<StepSlider
			value={app.transport.speed}
			min={SPEED_MIN}
			max={SPEED_MAX}
			detents={SPEED_PRESETS}
			disabled={!loaded}
			label="Speed slider"
			onchange={(v) => app.setSpeed(v)}
		/>
	</div>
	<div></div>
</div>

<style>
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.label {
		font-size: var(--fs-sm);
		line-height: var(--lh-sm);
		color: var(--fg-muted);
	}
</style>
