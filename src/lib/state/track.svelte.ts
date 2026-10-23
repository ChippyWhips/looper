import type { Peaks } from '../analysis/peaks';

export type TrackStatus = 'empty' | 'loading' | 'ready' | 'error';

/** The open track. Audio data and analysis results are plain fields, not reactive. */
export class TrackState {
	id = $state<string | null>(null);
	name = $state('');
	length = $state(0);
	sampleRate = $state(48000);
	size = $state(0);
	status = $state<TrackStatus>('empty');
	error = $state('');
	/** Bumped when peaks or onsets arrive, so views can redraw. */
	analysisVersion = $state(0);

	buffer: AudioBuffer | null = null;
	channels: Float32Array[] | null = null;
	peaks: Peaks | null = null;
	mono: Float32Array | null = null;
	onsets: Int32Array | null = null;
	file: Blob | null = null;

	get loaded(): boolean {
		return this.status === 'ready';
	}
}
