/// <reference lib="webworker" />
import init, { separate } from '../../../../vendor/demucs-wasm/demucs_wasm.js';
import wasmUrl from '../../../../vendor/demucs-wasm/demucs_wasm_bg.wasm?url';
import { rmsDb, toInt16 } from '../types';

export type WorkerRequest = {
	weights: Uint8Array;
	model: string;
	stems: string[];
	left: Float32Array;
	right: Float32Array;
	sampleRate: number;
};

export type WorkerResponse =
	| { type: 'progress'; fraction: number }
	| { type: 'done'; names: string[]; channels: Int16Array[][]; rms: number[] }
	| { type: 'error'; message: string };

const post = (m: WorkerResponse, t: Transferable[] = []) =>
	(self as DedicatedWorkerGlobalScope).postMessage(m, t);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
	const r = e.data;
	try {
		await init({ module_or_path: wasmUrl });
		const length = r.left.length;
		const result = await separate(
			r.weights,
			r.model,
			r.stems,
			r.left,
			r.right,
			r.sampleRate,
			(ev: { type: string; index: number; total: number }) => {
				if (ev.type === 'chunk_done')
					post({ type: 'progress', fraction: (ev.index + 1) / ev.total });
			}
		);
		const names = result.stem_names() as string[];
		const n = result.n_samples;
		const audio = result.take_audio();
		const channels: Int16Array[][] = [];
		const rms: number[] = [];
		names.forEach((_, k) => {
			// Output length can differ by a few frames after internal resampling; fit to the input.
			const fit = (off: number) => {
				const x = new Float32Array(length);
				x.set(audio.subarray(off, off + Math.min(n, length)));
				return toInt16(x);
			};
			const pair = [fit(2 * k * n), fit((2 * k + 1) * n)];
			channels.push(pair);
			rms.push(rmsDb(pair));
		});
		post(
			{ type: 'done', names, channels, rms },
			channels.flat().map((c) => c.buffer)
		);
	} catch (err) {
		post({ type: 'error', message: String(err) });
	}
};
