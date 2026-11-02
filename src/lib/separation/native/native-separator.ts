import {
	abortError,
	type SeparationInput,
	type SeparationModel,
	type SeparationProgress,
	type SeparationStage,
	type Separator,
	type StemName,
	type StemSet
} from '../types';

type NativeEvent =
	| { kind: 'progress'; job: number; fraction: number; stage: SeparationStage }
	| {
			kind: 'done';
			job: number;
			ms: number;
			meta: {
				model: SeparationModel;
				sampleRate: number;
				length: number;
				stems: { name: StemName; rmsDb: number }[];
			};
	  }
	| { kind: 'error'; job: number; message: string }
	| { kind: 'cancelled'; job: number };

/**
 * demucs-rs running natively on Metal (`src-tauri/src/separate.rs`). The decoded PCM goes over
 * as one binary body; stems are written by Rust into the track's directory, so the result is
 * metadata only (`persisted: true`).
 */
export class NativeSeparator implements Separator {
	/** Milliseconds the last job took on the native side. */
	lastMs = 0;

	async availability() {
		return 'gpu' as const;
	}

	async separate(
		input: SeparationInput,
		model: SeparationModel,
		onProgress: (p: SeparationProgress) => void,
		signal: AbortSignal
	): Promise<StemSet> {
		if (signal.aborted) throw abortError();
		const { invoke } = await import('@tauri-apps/api/core');
		const { listen } = await import('@tauri-apps/api/event');
		const length = input.channels[0].length;
		const channels = Math.min(2, input.channels.length);
		const body = new Float32Array(length * channels);
		for (let c = 0; c < channels; c++) body.set(input.channels[c], c * length);

		let job = 0;
		const early: NativeEvent[] = [];
		let handle: ((e: NativeEvent) => void) | null = null;
		const unlisten = await listen<NativeEvent>('separation', (e) => {
			if (handle) handle(e.payload);
			else early.push(e.payload);
		});
		try {
			job = await invoke<number>('separate_start', new Uint8Array(body.buffer), {
				headers: {
					'x-meta': JSON.stringify({
						trackId: input.trackId,
						model,
						sampleRate: input.sampleRate,
						length,
						channels
					})
				}
			});
			return await new Promise<StemSet>((resolve, reject) => {
				const onAbort = () => {
					void invoke('separate_cancel', { job });
					reject(abortError());
				};
				signal.addEventListener('abort', onAbort, { once: true });
				handle = (e) => {
					if (e.job !== job) return;
					if (e.kind === 'progress')
						onProgress({ fraction: e.fraction, stage: e.stage, slow: false });
					else if (e.kind === 'done') {
						this.lastMs = e.ms;
						resolve({
							model: e.meta.model,
							sampleRate: e.meta.sampleRate,
							length: e.meta.length,
							stems: e.meta.stems.map((s) => ({ name: s.name, rmsDb: s.rmsDb, channels: [] })),
							persisted: true
						});
					} else if (e.kind === 'error') reject(new Error(e.message));
					else reject(abortError());
				};
				for (const e of early.splice(0)) handle(e);
				if (signal.aborted) onAbort();
			});
		} finally {
			unlisten();
		}
	}
}
