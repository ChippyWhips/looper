/** Time-stretch and pitch-shift stage. Speed and pitch are independent. */
export interface Stretcher {
	/** Playback rate: input frames consumed per output frame. */
	setRate(rate: number): void;
	setPitchCents(cents: number): void;
	/** Consume `inputFrames` of `input`, write exactly `outputFrames` to `output`. */
	process(
		input: readonly Float32Array[],
		inputFrames: number,
		output: Float32Array[],
		outputFrames: number
	): void;
	/** Input frames between the newest frame fed and the frame now being output. */
	latencyFrames(): number;
	reset(): void;
}
