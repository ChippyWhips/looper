import {
	abortError,
	rmsDb,
	toInt16,
	type SeparationInput,
	type SeparationModel,
	type SeparationProgress,
	type Separator,
	type StemName,
	type StemPcm,
	type StemSet
} from './types';

export interface StubOptions {
	/** Total job time in ms, spread over `steps` progress callbacks. */
	durationMs?: number;
	steps?: number;
	fail?: boolean;
	/** After failing, report 'unavailable' (as a crashed runtime does). */
	breaks?: boolean;
}

/**
 * Deterministic stand-in for tests. Splits the mix into stems that sum back to it exactly
 * (before 16-bit rounding): vocals = 0.5·mix, guitar = 0.3·mix, bass = 0.2·mix, and drums,
 * piano, other near-silent. htdemucs_ft returns the four fine-tuned stems.
 */
export class StubSeparator implements Separator {
	calls = 0;
	private broken = false;
	constructor(private o: StubOptions = {}) {}

	async availability() {
		return this.broken ? ('unavailable' as const) : ('gpu' as const);
	}

	async separate(
		input: SeparationInput,
		model: SeparationModel,
		onProgress: (p: SeparationProgress) => void,
		signal: AbortSignal
	): Promise<StemSet> {
		this.calls++;
		const steps = this.o.steps ?? 10;
		const dt = (this.o.durationMs ?? 200) / steps;
		for (let i = 0; i < steps; i++) {
			if (signal.aborted) throw abortError();
			await new Promise((r) => setTimeout(r, dt));
			if (signal.aborted) throw abortError();
			onProgress({ fraction: (i + 1) / steps, stage: 'separate', slow: false });
		}
		if (this.o.fail || this.o.breaks) {
			if (this.o.breaks) this.broken = true;
			throw new Error('stub failure');
		}
		const split: [StemName, number][] =
			model === 'htdemucs_ft'
				? [
						['vocals', 0.6],
						['bass', 0.4],
						['drums', 0],
						['other', 0]
					]
				: [
						['vocals', 0.5],
						['guitar', 0.3],
						['bass', 0.2],
						['drums', 0],
						['piano', 0],
						['other', 0]
					];
		const ch =
			input.channels.length === 1 ? [input.channels[0], input.channels[0]] : input.channels;
		const stems: StemPcm[] = split.map(([name, g]) => {
			const channels = ch.map((c) => toInt16(c.map((v) => v * g)));
			return { name, channels, rmsDb: rmsDb(channels) };
		});
		return { model, sampleRate: input.sampleRate, length: ch[0].length, stems };
	}
}
