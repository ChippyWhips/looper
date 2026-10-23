import { PlayerCore } from './player-core';
import type { FromWorklet, ToWorklet } from './protocol';
import { loadSignalsmith, SignalsmithStretcher } from './stretcher/signalsmith';

export interface RenderOptions {
	sampleRate: number;
	channels: Float32Array[];
	frames: number;
	/** Commands applied before the first quantum. */
	setup: ToWorklet[];
	/** Commands applied at given output frames. */
	at?: { frame: number; msg: ToWorklet }[];
}

/** Render PlayerCore offline in Node (same DSP as the worklet). Returns left channel and messages. */
export async function renderCore(
	o: RenderOptions
): Promise<{ out: Float32Array; msgs: FromWorklet[] }> {
	const mod = await loadSignalsmith();
	const msgs: FromWorklet[] = [];
	const core = new PlayerCore(o.sampleRate, new SignalsmithStretcher(mod, 2, o.sampleRate), (m) =>
		msgs.push(m)
	);
	core.enqueue({
		type: 'load',
		sources: [
			{
				id: 'mix',
				kind: 'mix',
				label: 'Mix',
				channels: o.channels,
				gain: 1,
				muted: false,
				soloed: false
			}
		]
	});
	for (const m of o.setup) core.enqueue(m);
	const out = new Float32Array(o.frames);
	const L = new Float32Array(128);
	const R = new Float32Array(128);
	const pending = [...(o.at ?? [])].sort((a, b) => a.frame - b.frame);
	for (let f = 0; f < o.frames; f += 128) {
		while (pending.length && pending[0].frame <= f) core.enqueue(pending.shift()!.msg);
		core.process([L, R], f);
		out.set(L.subarray(0, Math.min(128, o.frames - f)), f);
	}
	return { out, msgs };
}
