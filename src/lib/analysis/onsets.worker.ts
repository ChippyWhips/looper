/// <reference lib="webworker" />
import { detectOnsets } from './onsets';

export type OnsetsRequest = { mono: Float32Array; sampleRate: number };
export type OnsetsResponse = { onsets: Int32Array };

self.onmessage = (e: MessageEvent<OnsetsRequest>) => {
	const onsets = detectOnsets(e.data.mono, e.data.sampleRate);
	(self as DedicatedWorkerGlobalScope).postMessage({ onsets } satisfies OnsetsResponse, [
		onsets.buffer
	]);
};
