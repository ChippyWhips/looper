import type { SeparationJob, SeparationModel, Separator, StemSet } from './types';

/** Separator that is never available. Placeholder until phase 8. */
export class NullSeparator implements Separator {
	separate(
		_file: Blob,
		_model: SeparationModel,
		_onProgress: unknown,
		signal: AbortSignal
	): Promise<StemSet> {
		if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
		return Promise.reject(new Error('Stem separation is not available'));
	}
}

/** Start a job with cancellation via AbortController. */
export function startJob(
	separator: Separator,
	trackId: string,
	file: Blob,
	model: SeparationModel
): SeparationJob {
	const controller = new AbortController();
	const job: SeparationJob = {
		trackId,
		model,
		status: 'running',
		progress: { fraction: 0, slow: false },
		cancel: () => {
			controller.abort();
			job.status = 'stopped';
		},
		result: Promise.resolve() as unknown as Promise<StemSet>
	};
	job.result = separator.separate(file, model, (p) => (job.progress = p), controller.signal);
	job.result.then(
		() => (job.status = 'done'),
		() => {
			if (job.status === 'running') job.status = controller.signal.aborted ? 'stopped' : 'failed';
		}
	);
	return job;
}
