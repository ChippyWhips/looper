import createModule from 'virtual:signalsmith-core';
import { interpolate, RESAMPLER_REACH } from '../resampler';
import type { Stretcher } from './types';

interface SignalsmithModule {
	_main(): void;
	_presetDefault(channels: number, sampleRate: number): void;
	_inputLatency(): number;
	_outputLatency(): number;
	_setBuffers(channels: number, length: number): number;
	_setTransposeSemitones(semitones: number, tonalityLimit: number): void;
	_process(inputSamples: number, outputSamples: number): void;
	_reset(): void;
	HEAP8?: Int8Array;
	exports?: { memory: WebAssembly.Memory };
}

const WASM_BUFFER = 4096;
const FIFO = 8192;
const MASK = FIFO - 1;

export async function loadSignalsmith(): Promise<SignalsmithModule> {
	const mod = (await createModule()) as SignalsmithModule;
	mod._main();
	return mod;
}

/**
 * Signalsmith Stretch used for time-stretch only (at rate / p), followed by a windowed-sinc
 * resampler reading at step p = 2^(cents/1200). See DECISIONS.md for why pitch is not done
 * by Signalsmith's own transpose.
 */
export class SignalsmithStretcher implements Stretcher {
	private mod: SignalsmithModule;
	private channels: number;
	private ptr: number;
	private inLatency: number;
	private outLatency: number;
	private rate = 1;
	private pitch = 1;
	private fifo: Float32Array[];
	/** Intermediate frames written to the FIFO (absolute index). */
	private produced = 0;
	/** Fractional read position in the FIFO (absolute index). */
	private readPos = 0;

	constructor(mod: SignalsmithModule, channels: number, sampleRate: number) {
		this.mod = mod;
		this.channels = channels;
		mod._presetDefault(channels, sampleRate);
		mod._setTransposeSemitones(0, 0);
		this.inLatency = mod._inputLatency();
		this.outLatency = mod._outputLatency();
		this.ptr = mod._setBuffers(channels, WASM_BUFFER);
		this.fifo = Array.from({ length: channels }, () => new Float32Array(FIFO));
		this.reset();
	}

	setRate(rate: number): void {
		this.rate = rate;
	}

	setPitchCents(cents: number): void {
		this.pitch = Math.pow(2, cents / 1200);
	}

	private get innerRate(): number {
		return this.rate / this.pitch;
	}

	latencyFrames(): number {
		return this.inLatency + (this.outLatency + RESAMPLER_REACH) * this.innerRate;
	}

	reset(): void {
		this.mod._reset();
		for (const f of this.fifo) f.fill(0);
		this.produced = RESAMPLER_REACH;
		this.readPos = 0;
	}

	private heap(): Float32Array {
		const buf = this.mod.exports ? this.mod.exports.memory.buffer : this.mod.HEAP8!.buffer;
		return new Float32Array(buf);
	}

	process(
		input: readonly Float32Array[],
		inputFrames: number,
		output: Float32Array[],
		outputFrames: number
	): void {
		const step = this.pitch;
		const need = Math.max(
			0,
			Math.ceil(this.readPos + outputFrames * step + RESAMPLER_REACH) - this.produced
		);
		const nIn = Math.min(inputFrames, WASM_BUFFER);
		const nOut = Math.min(need, WASM_BUFFER);
		let heap = this.heap();
		const len = WASM_BUFFER;
		for (let c = 0; c < this.channels; c++) {
			const src = input[c < input.length ? c : input.length - 1];
			heap.set(src.subarray(0, nIn), this.ptr / 4 + len * c);
		}
		this.mod._process(nIn, nOut);
		heap = this.heap();
		for (let c = 0; c < this.channels; c++) {
			const base = this.ptr / 4 + len * (this.channels + c);
			const f = this.fifo[c];
			for (let i = 0; i < nOut; i++) f[(this.produced + i) & MASK] = heap[base + i];
		}
		this.produced += nOut;

		for (let c = 0; c < this.channels; c++) {
			const f = this.fifo[c];
			const read = (i: number) => f[i & MASK];
			const out = output[c];
			let pos = this.readPos;
			for (let j = 0; j < outputFrames; j++) {
				out[j] = interpolate(read, pos, step);
				pos += step;
			}
		}
		this.readPos += outputFrames * step;
		// Keep absolute indices small without changing their positions modulo FIFO.
		if (this.readPos > 1 << 30) {
			const shift = Math.floor(this.readPos / FIFO) * FIFO;
			this.readPos -= shift;
			this.produced -= shift;
		}
	}
}
