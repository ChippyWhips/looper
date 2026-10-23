/// <reference lib="webworker" />
import { coarsen, levelCount, levelFromSamples, BASE_BUCKET, type PeakLevel } from './peaks';

export type PeaksRequest = { channels: Float32Array[]; width: number };
export type PeaksResponse =
	{ type: 'levels'; levels: PeakLevel[]; final: boolean } | { type: 'mono'; mono: Float32Array };

const post = (msg: PeaksResponse, transfer: Transferable[] = []) =>
	(self as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<PeaksRequest>) => {
	const { channels, width } = e.data;
	const length = channels[0].length;
	const n = levelCount(length, width);
	// Coarsest first, straight from samples, so the overview can draw almost immediately.
	const top = levelFromSamples(channels, BASE_BUCKET * 2 ** (n - 1));
	post({ type: 'levels', levels: [top], final: false });
	const levels: PeakLevel[] = [levelFromSamples(channels, BASE_BUCKET)];
	while (levels.length < n) levels.push(coarsen(levels[levels.length - 1]));
	post(
		{ type: 'levels', levels, final: true },
		levels.map((l) => l.data.buffer)
	);
	const mono = new Float32Array(length);
	const k = 1 / channels.length;
	for (const ch of channels) for (let i = 0; i < length; i++) mono[i] += ch[i] * k;
	post({ type: 'mono', mono }, [mono.buffer]);
};
