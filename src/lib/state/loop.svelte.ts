export type Edge = 'in' | 'out';

/** One loop region per track, in integer source frames. */
export class LoopState {
	start = $state(0);
	end = $state(0);
	on = $state(false);
	snap = $state(true);
	selected = $state<Edge | null>(null);

	get exists(): boolean {
		return this.end > this.start;
	}

	get length(): number {
		return Math.max(0, this.end - this.start);
	}
}
