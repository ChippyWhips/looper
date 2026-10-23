/** Stem separation seam (SPEC phase 8). Interfaces only; nothing calls a separator in this run. */

export type StemName = 'drums' | 'bass' | 'vocals' | 'guitar' | 'piano' | 'other';

export type SeparationModel = 'htdemucs_6s' | 'htdemucs_ft';

export interface Stem {
	name: StemName;
	/** Planar PCM at the track's sample rate, same length as the mix. */
	channels: Float32Array[];
	/** Overall RMS in dBFS; stems under −50 dBFS get no lane. */
	rmsDb: number;
}

export interface StemSet {
	model: SeparationModel;
	sampleRate: number;
	length: number;
	stems: Stem[];
}

export interface SeparationProgress {
	/** 0..1 */
	fraction: number;
	/** True when running on the CPU/WASM path rather than WebGPU. */
	slow: boolean;
}

export interface Separator {
	separate(
		file: Blob,
		model: SeparationModel,
		onProgress: (p: SeparationProgress) => void,
		signal: AbortSignal
	): Promise<StemSet>;
}

export type SeparationStatus = 'idle' | 'running' | 'done' | 'stopped' | 'failed' | 'unavailable';

/** A running or finished separation for one track. One job runs at a time. */
export interface SeparationJob {
	trackId: string;
	model: SeparationModel;
	status: SeparationStatus;
	progress: SeparationProgress;
	cancel(): void;
	result: Promise<StemSet>;
}

export const EMPTY_STEM_DB = -50;
