import { correlatedGains, correlation } from './crossfade';
import type { Mixer } from './sources';

export interface LoopRegion {
	start: number;
	end: number;
	on: boolean;
}

/**
 * Produces the source-domain stream: mixed source frames at the read position, with
 * sample-exact loop wraps and seeks blended by a short correlation-aware crossfade.
 * Every frame written is labelled with the source frame it came from.
 */
export class Reader {
	pos = 0;
	loop: LoopRegion = { start: 0, end: 0, on: false };
	/** True once the read position is inside the loop; wraps only happen while engaged. */
	engaged = false;
	/** Silent frames to emit before reading (count-in pre-roll). */
	zeros = 0;
	ended = false;
	readonly xfadeFrames: number;
	private tailFrom = 0;
	private tailLeft = 0;
	private tailR = 0;
	private mixer: Mixer;

	constructor(mixer: Mixer, sampleRate: number, xfadeMs = 5) {
		this.mixer = mixer;
		this.xfadeFrames = Math.max(1, Math.round((xfadeMs / 1000) * sampleRate));
	}

	get length(): number {
		return this.mixer.length;
	}

	private inLoop(p: number): boolean {
		return (
			this.loop.on && this.loop.end > this.loop.start && p >= this.loop.start && p < this.loop.end
		);
	}

	/** Jump without crossfade (stream restarts from silence). */
	place(frame: number): void {
		this.pos = Math.max(0, Math.min(this.length, Math.round(frame)));
		this.tailLeft = 0;
		this.ended = this.pos >= this.length;
		this.engaged = this.inLoop(this.pos);
	}

	/** Fade the next frames in from silence (used when a stream starts). */
	fadeInFromSilence(): void {
		this.tailFrom = -1e12;
		this.tailR = 0;
		this.tailLeft = this.xfadeFrames;
	}

	/** Jump while streaming, crossfading from the current position. */
	seek(frame: number): void {
		const target = Math.max(0, Math.min(this.length, Math.round(frame)));
		this.startTail(this.pos, target);
		this.pos = target;
		this.ended = this.pos >= this.length;
		this.engaged = this.inLoop(this.pos);
	}

	setLoop(region: LoopRegion): void {
		const wasEngaged = this.engaged && this.loop.on;
		this.loop = { ...region };
		if (!region.on || region.end <= region.start) {
			this.engaged = false;
			return;
		}
		// Inside the new region, or was looping and is now past a moved-in end: wrap at next frame.
		this.engaged = this.inLoop(this.pos) || (wasEngaged && this.pos >= region.start);
	}

	private startTail(from: number, to: number): void {
		const n = this.xfadeFrames;
		const m = this.mixer;
		this.tailR = correlation(
			(i) => m.sample(0, from + i) + m.sample(1, from + i),
			(i) => m.sample(0, to + i) + m.sample(1, to + i),
			n
		);
		this.tailFrom = from;
		this.tailLeft = n;
	}

	/**
	 * Write n frames to out[0..1] and their source-frame labels to labels(i, frame).
	 */
	read(out: Float32Array[], n: number, label: (i: number, frame: number) => void): void {
		const m = this.mixer;
		const L = out[0];
		const R = out[1];
		for (let i = 0; i < n; i++) {
			if (this.zeros > 0) {
				this.zeros--;
				L[i] = 0;
				R[i] = 0;
				label(i, this.pos);
				continue;
			}
			if (this.engaged && this.pos >= this.loop.end) {
				this.startTail(this.pos, this.loop.start);
				this.pos = this.loop.start;
			}
			if (this.pos >= this.length && this.tailLeft === 0) {
				this.ended = true;
				L[i] = 0;
				R[i] = 0;
				label(i, this.length);
				m.tick();
				continue;
			}
			let l = m.sample(0, this.pos);
			let r = m.sample(1, this.pos);
			if (this.tailLeft > 0) {
				const k = this.xfadeFrames - this.tailLeft;
				const [gOut, gIn] = correlatedGains((k + 0.5) / this.xfadeFrames, this.tailR);
				const tf = this.tailFrom + k;
				l = gIn * l + gOut * m.sample(0, tf);
				r = gIn * r + gOut * m.sample(1, tf);
				this.tailLeft--;
			}
			L[i] = l;
			R[i] = r;
			label(i, this.pos);
			m.tick();
			this.pos++;
			if (!this.engaged && this.inLoop(this.pos)) this.engaged = true;
		}
	}
}
