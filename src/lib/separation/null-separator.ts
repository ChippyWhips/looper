import {
	abortError,
	isAbort,
	type SeparationInput,
	type SeparationJob,
	type SeparationModel,
	type SeparationProgress,
	type Separator,
	type StemSet
} from './types';

/** Separator for environments with no runtime (shows "Stems unavailable"). */
export class NullSeparator implements Separator {
	async availability() {
		return 'unavailable' as const;
	}

	separate(
		_input: SeparationInput,
		_model: SeparationModel,
		_onProgress: (p: SeparationProgress) => void,
		signal: AbortSignal
	): Promise<StemSet> {
		if (signal.aborted) return Promise.reject(abortError());
		return Promise.reject(new Error('Stem separation is not available'));
	}
}

/** Start a job with cancellation via AbortController. */
export function startJob(
	separator: Separator,
	input: SeparationInput,
	model: SeparationModel,
	onProgress: (p: SeparationProgress) => void = () => {}
): SeparationJob {
	const controller = new AbortController();
	let job: SeparationJob | undefined = undefined;
	const result = separator.separate(
		input,
		model,
		(p) => {
			if (job) job.progress = p;
			onProgress(p);
		},
		controller.signal
	);
	const j: SeparationJob = {
		trackId: input.trackId,
		model,
		status: 'running',
		progress: { fraction: 0, stage: 'model', slow: false },
		cancel: () => {
			if (j.status !== 'running') return;
			controller.abort();
			j.status = 'stopped';
		},
		result
	};
	job = j;
	result.then(
		() => {
			if (j.status === 'running') j.status = 'done';
		},
		(e) => {
			if (j.status === 'running')
				j.status = isAbort(e) || controller.signal.aborted ? 'stopped' : 'failed';
		}
	);
	return j;
}
