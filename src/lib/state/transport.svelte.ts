import type { TransportState as EngineState } from '../audio/protocol';

export const SPEED_PRESETS = [50, 60, 70, 75, 80, 90, 100] as const;
export const SPEED_MIN = 25;
export const SPEED_MAX = 150;
export const PITCH_MIN = -1200;
export const PITCH_MAX = 1200;

export class TransportState {
	state = $state<EngineState>('stopped');
	/** Percent, integer. */
	speed = $state(100);
	/** Cents, integer. */
	cents = $state(0);
	countIn = $state(false);
	/** Detected tempo, BPM. */
	tempoDetected = $state<number | null>(null);
	/** User-typed tempo, overrides detection. */
	tempoOverride = $state<number | null>(null);
	/** Count-in beat indicator. */
	beatLit = $state(false);

	get playing(): boolean {
		return this.state !== 'stopped';
	}

	get tempo(): number | null {
		return this.tempoOverride ?? this.tempoDetected;
	}
}
