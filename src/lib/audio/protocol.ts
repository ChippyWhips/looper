import type { SourceKind, SourceState } from './sources';

export interface SourcePayload extends SourceState {
	kind: SourceKind;
	channels: Float32Array[];
}

export type ToWorklet =
	| { type: 'load'; sources: SourcePayload[] }
	| { type: 'sources'; states: SourceState[] }
	| { type: 'play'; from: number; countInBpm: number | null }
	| { type: 'pause' }
	| { type: 'seek'; frame: number }
	| { type: 'loop'; start: number; end: number; on: boolean }
	| { type: 'params'; speed: number; cents: number }
	| { type: 'latency'; seconds: number }
	| { type: 'ping'; id: number };

/** Commands that change the position; reports older than the latest are ignored. */
export const POSITION_COMMANDS = ['load', 'play', 'pause', 'seek'] as const;

export type TransportState = 'stopped' | 'counting' | 'playing';

export type FromWorklet =
	| { type: 'ready' }
	| { type: 'pong'; id: number }
	| {
			type: 'pos';
			/** Audio-clock time at which sourceFrame is audible. */
			contextTime: number;
			sourceFrame: number;
			/** Source frames per second of audio clock while the audible position advances; 0 when still. */
			velocity: number;
			state: TransportState;
			/** Count of position-changing commands applied (load, play, pause, seek). */
			epoch: number;
	  }
	| { type: 'beats'; times: number[] }
	| { type: 'ended'; frame: number }
	| { type: 'error'; message: string };
