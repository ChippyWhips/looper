/**
 * Stem separation contract. Transport-agnostic: inputs and outputs are plain data (typed
 * arrays and JSON-able metadata), so an implementation can live in a worker, in WASM, or
 * behind a native IPC command without changing callers.
 */

export type StemName = 'drums' | 'bass' | 'vocals' | 'guitar' | 'piano' | 'other';

export const STEM_ORDER: readonly StemName[] = [
	'vocals',
	'guitar',
	'bass',
	'drums',
	'piano',
	'other'
];

export type SeparationModel = 'htdemucs_6s' | 'htdemucs_ft';

export const DEFAULT_MODEL: SeparationModel = 'htdemucs_6s';
export const FINE_MODEL: SeparationModel = 'htdemucs_ft';

export interface SeparationInput {
	trackId: string;
	sampleRate: number;
	/** Planar PCM, one array per channel (mono is treated as stereo). */
	channels: Float32Array[];
}

export type SeparationStage = 'model' | 'load' | 'separate' | 'encode';

export interface SeparationProgress {
	/** 0..1 over the whole job. */
	fraction: number;
	stage: SeparationStage;
	/** True on a CPU/WASM path rather than the GPU. */
	slow: boolean;
}

export interface StemPcm {
	name: StemName;
	/** Planar 16-bit PCM at the input sample rate, input length. */
	channels: Int16Array[];
	/** Overall RMS in dBFS; stems under EMPTY_STEM_DB get no lane. */
	rmsDb: number;
}

export interface StemSet {
	model: SeparationModel;
	sampleRate: number;
	length: number;
	stems: StemPcm[];
}

export type SeparatorAvailability = 'gpu' | 'cpu' | 'unavailable';

export interface Separator {
	availability(): Promise<SeparatorAvailability>;
	separate(
		input: SeparationInput,
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

/** Model weights download/caching, kept behind an interface so a native shell can bundle them. */
export interface ModelStore {
	/** Cached weights, or null. */
	get(model: SeparationModel): Promise<Uint8Array | null>;
	/** Cached weights, downloading once if needed. */
	load(
		model: SeparationModel,
		onProgress: (fraction: number) => void,
		signal: AbortSignal
	): Promise<Uint8Array>;
}

export function abortError(): DOMException {
	return new DOMException('Aborted', 'AbortError');
}

export function isAbort(e: unknown): boolean {
	return e instanceof DOMException && e.name === 'AbortError';
}

/** RMS of planar 16-bit PCM in dBFS. */
export function rmsDb(channels: Int16Array[]): number {
	let s = 0;
	let n = 0;
	for (const ch of channels) {
		for (let i = 0; i < ch.length; i++) {
			const v = ch[i] / 32768;
			s += v * v;
		}
		n += ch.length;
	}
	return n ? 10 * Math.log10(s / n + 1e-20) : -Infinity;
}

/** Float32 → Int16 with clipping and rounding. */
export function toInt16(x: Float32Array): Int16Array {
	const out = new Int16Array(x.length);
	for (let i = 0; i < x.length; i++) {
		const v = x[i] < -1 ? -1 : x[i] > 1 ? 1 : x[i];
		out[i] = Math.round(v * 32767);
	}
	return out;
}
