import { describe, expect, it } from 'vitest';
import { NullSeparator, startJob } from './null-separator';
import { StubSeparator } from './stub-separator';
import { EMPTY_STEM_DB, rmsDb, toInt16, type SeparationInput } from './types';

const input = (n = 4800): SeparationInput => {
	const l = new Float32Array(n).map((_, i) => 0.5 * Math.sin(i / 7));
	return { trackId: 't', sampleRate: 48000, channels: [l, l.slice()] };
};

describe('separation contract', () => {
	it('NullSeparator is unavailable and rejects', async () => {
		const s = new NullSeparator();
		expect(await s.availability()).toBe('unavailable');
		const job = startJob(s, input(), 'htdemucs_6s');
		await expect(job.result).rejects.toThrow();
		expect(job.status).toBe('failed');
	});

	it('stub stems are 16-bit, sum to the mix and include near-silent stems', async () => {
		const inp = input();
		const progress: number[] = [];
		const set = await new StubSeparator({ durationMs: 20 }).separate(
			inp,
			'htdemucs_6s',
			(p) => progress.push(p.fraction),
			new AbortController().signal
		);
		expect(set.stems.map((s) => s.name)).toEqual([
			'vocals',
			'guitar',
			'bass',
			'drums',
			'piano',
			'other'
		]);
		expect(progress.at(-1)).toBe(1);
		for (let i = 0; i < 4800; i += 97) {
			const sum = set.stems.reduce((a, s) => a + s.channels[0][i] / 32767, 0);
			expect(Math.abs(sum - inp.channels[0][i])).toBeLessThan(3 / 32767);
		}
		expect(set.stems.filter((s) => s.rmsDb < EMPTY_STEM_DB).map((s) => s.name)).toEqual([
			'drums',
			'piano',
			'other'
		]);
	});

	it('jobs report progress and cancel through AbortSignal', async () => {
		const stub = new StubSeparator({ durationMs: 1000, steps: 20 });
		const seen: number[] = [];
		const job = startJob(stub, input(), 'htdemucs_ft', (p) => seen.push(p.fraction));
		await new Promise((r) => setTimeout(r, 120));
		expect(job.progress.fraction).toBeGreaterThan(0);
		job.cancel();
		await expect(job.result).rejects.toMatchObject({ name: 'AbortError' });
		expect(job.status).toBe('stopped');
		const n = seen.length;
		await new Promise((r) => setTimeout(r, 120));
		expect(seen.length).toBe(n);
	});

	it('failures are reported as failed', async () => {
		const job = startJob(new StubSeparator({ durationMs: 10, fail: true }), input(), 'htdemucs_6s');
		await expect(job.result).rejects.toThrow('stub failure');
		expect(job.status).toBe('failed');
	});

	it('pcm helpers', () => {
		expect(Array.from(toInt16(new Float32Array([0, 1, -1, 2])))).toEqual([0, 32767, -32767, 32767]);
		expect(rmsDb([new Int16Array(10)])).toBeLessThan(-150);
	});
});
