import SeparationWorker from './separation.worker.ts?worker';
import type { WorkerResponse } from './separation.worker';
import { MODEL_FILES } from './models';
import {
	abortError,
	type ModelStore,
	type SeparationInput,
	type SeparationModel,
	type SeparationProgress,
	type Separator,
	type SeparatorAvailability,
	type StemName,
	type StemSet
} from '../types';

type GpuNavigator = { gpu?: { requestAdapter(): Promise<unknown | null> } };

const MODEL_SHARE = 0.1;

/**
 * demucs-rs (WASM + WebGPU) in a dedicated worker. The web build has no CPU path, so without a
 * WebGPU adapter it reports 'unavailable'. Cancelling terminates the worker.
 */
export class BrowserSeparator implements Separator {
	private avail: Promise<SeparatorAvailability> | null = null;
	/** Set when the runtime itself crashes (e.g. WebKit: cubecl cannot map a timing buffer). */
	private broken = false;

	constructor(private models: ModelStore) {}

	availability(): Promise<SeparatorAvailability> {
		if (this.broken) return Promise.resolve('unavailable');
		this.avail ??= (async () => {
			const gpu = (navigator as unknown as GpuNavigator).gpu;
			if (!gpu) return 'unavailable';
			try {
				return (await gpu.requestAdapter()) ? 'gpu' : 'unavailable';
			} catch {
				return 'unavailable';
			}
		})();
		return this.avail;
	}

	async separate(
		input: SeparationInput,
		model: SeparationModel,
		onProgress: (p: SeparationProgress) => void,
		signal: AbortSignal
	): Promise<StemSet> {
		if ((await this.availability()) === 'unavailable') throw new Error('WebGPU unavailable');
		const weights = await this.models.load(
			model,
			(f) => onProgress({ fraction: f * MODEL_SHARE, stage: 'model', slow: false }),
			signal
		);
		if (signal.aborted) throw abortError();
		onProgress({ fraction: MODEL_SHARE, stage: 'load', slow: false });
		const left = input.channels[0].slice();
		const right = (input.channels[1] ?? input.channels[0]).slice();
		const worker = new SeparationWorker();
		try {
			const res = await new Promise<Extract<WorkerResponse, { type: 'done' }>>(
				(resolve, reject) => {
					const abort = () => reject(abortError());
					signal.addEventListener('abort', abort, { once: true });
					worker.onerror = (e) => {
						if (/unreachable|panicked/i.test(e.message ?? '')) this.broken = true;
						reject(new Error(e.message || 'separation worker failed'));
					};
					worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
						const m = e.data;
						if (m.type === 'progress')
							onProgress({
								fraction: MODEL_SHARE + (1 - MODEL_SHARE) * 0.97 * m.fraction,
								stage: 'separate',
								slow: false
							});
						else if (m.type === 'done') resolve(m);
						else {
							// A wasm panic means this browser's WebGPU cannot run the model; stop offering it.
							if (/unreachable|panicked/i.test(m.message)) this.broken = true;
							reject(new Error(m.message));
						}
					};
					worker.postMessage(
						{
							weights,
							model,
							stems: MODEL_FILES[model].stems,
							left,
							right,
							sampleRate: input.sampleRate
						},
						[weights.buffer, left.buffer, right.buffer]
					);
				}
			);
			onProgress({ fraction: 1, stage: 'encode', slow: false });
			return {
				model,
				sampleRate: input.sampleRate,
				length: left.length || input.channels[0].length,
				stems: res.names.map((name, k) => ({
					name: name as StemName,
					channels: res.channels[k],
					rmsDb: res.rms[k]
				}))
			};
		} finally {
			worker.terminate();
		}
	}
}
