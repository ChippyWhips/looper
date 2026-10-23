import { describe, expect, it } from 'vitest';
import { NullSeparator, startJob } from './null-separator';
import type { SeparationProgress, Separator, StemSet } from './types';

describe('separation seam', () => {
	it('NullSeparator rejects', async () => {
		const job = startJob(new NullSeparator(), 't', new Blob(), 'htdemucs_6s');
		await expect(job.result).rejects.toThrow();
		expect(job.status).toBe('failed');
	});

	it('jobs report progress and cancel through AbortSignal', async () => {
		let seen: AbortSignal | null = null;
		const fake: Separator = {
			separate(_f, model, onProgress: (p: SeparationProgress) => void, signal) {
				seen = signal;
				onProgress({ fraction: 0.42, slow: false });
				return new Promise<StemSet>((_, reject) =>
					signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
				);
			}
		};
		const job = startJob(fake, 't', new Blob(), 'htdemucs_ft');
		expect(job.progress.fraction).toBe(0.42);
		job.cancel();
		await expect(job.result).rejects.toThrow();
		expect(seen!.aborted).toBe(true);
		expect(job.status).toBe('stopped');
	});
});
