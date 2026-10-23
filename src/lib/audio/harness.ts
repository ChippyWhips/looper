import workletUrl from './player.worklet.ts?worker&url';
import * as measure from './measure';
import { detectTempo } from '../analysis/tempo-harness';
import type { FromWorklet, ToWorklet } from './protocol';

export interface HarnessRender {
	fixture: string;
	sampleRate: number;
	seconds: number;
	setup: ToWorklet[];
}

/** Render the real worklet in an OfflineAudioContext. Returns channel 0. */
async function render(o: HarnessRender): Promise<Float32Array> {
	const frames = Math.round(o.seconds * o.sampleRate);
	const ctx = new OfflineAudioContext(2, frames, o.sampleRate);
	const bytes = await (await fetch(o.fixture)).arrayBuffer();
	const buffer = await ctx.decodeAudioData(bytes);
	await ctx.audioWorklet.addModule(workletUrl);
	const node = new AudioWorkletNode(ctx, 'looper-player', {
		numberOfInputs: 0,
		numberOfOutputs: 1,
		outputChannelCount: [2]
	});
	node.connect(ctx.destination);
	const port = node.port;
	await new Promise<void>((resolve, reject) => {
		port.onmessage = (e: MessageEvent<FromWorklet>) => {
			if (e.data.type === 'ready') resolve();
			if (e.data.type === 'error') reject(new Error(e.data.message));
		};
	});
	const channels = [buffer.getChannelData(0).slice(), buffer.getChannelData(1).slice()];
	const send = (m: ToWorklet, t: Transferable[] = []) => port.postMessage(m, t);
	send(
		{
			type: 'load',
			sources: [
				{ id: 'mix', kind: 'mix', label: 'Mix', channels, gain: 1, muted: false, soloed: false }
			]
		},
		channels.map((c) => c.buffer)
	);
	for (const m of o.setup) send(m);
	await new Promise<void>((resolve) => {
		port.onmessage = (e: MessageEvent<FromWorklet>) => {
			if (e.data.type === 'pong') resolve();
		};
		send({ type: 'ping', id: 1 });
	});
	const out = await ctx.startRendering();
	return out.getChannelData(0);
}

export const harness = { render, measure, detectTempo };

declare global {
	interface Window {
		looperHarness: typeof harness;
	}
}
