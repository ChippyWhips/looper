import { fadeIn, fadeOut } from './crossfade';

export type SourceKind = 'mix' | 'stem';

export interface AudioSource {
	id: string;
	kind: SourceKind;
	label: string;
	channels: Float32Array[];
	gain: number;
	muted: boolean;
	soloed: boolean;
}

export type SourceState = Omit<AudioSource, 'channels'>;

/**
 * Target gain per source. With no mute or solo anywhere, only the mix plays.
 * Otherwise the stems play by DAW rules: any solo → soloed stems only, else unmuted stems.
 */
export function resolveTargets(sources: readonly SourceState[]): Map<string, number> {
	const stems = sources.filter((s) => s.kind === 'stem');
	const anySolo = stems.some((s) => s.soloed);
	const anyMute = stems.some((s) => s.muted);
	const useStems = stems.length > 0 && (anySolo || anyMute);
	const out = new Map<string, number>();
	for (const s of sources) {
		let on: boolean;
		if (s.kind === 'mix') on = !useStems;
		else if (!useStems) on = false;
		else if (anySolo) on = s.soloed;
		else on = !s.muted;
		out.set(s.id, on ? s.gain : 0);
	}
	return out;
}

interface Voice {
	source: AudioSource;
	from: number;
	to: number;
	/** Frames elapsed in the current ramp; ≥ rampFrames when settled. */
	t: number;
}

/** N-source mixer. Changes to the active set ramp each gain over ~20 ms on equal-power curves. */
export class Mixer {
	readonly rampFrames: number;
	private voices: Voice[] = [];
	length = 0;

	constructor(sampleRate: number, rampMs = 20) {
		this.rampFrames = Math.max(1, Math.round((rampMs / 1000) * sampleRate));
	}

	setSources(sources: AudioSource[]): void {
		const targets = resolveTargets(sources);
		this.voices = sources.map((s) => {
			const g = targets.get(s.id) ?? 0;
			return { source: s, from: g, to: g, t: this.rampFrames };
		});
		this.length = sources.reduce((m, s) => Math.max(m, s.channels[0]?.length ?? 0), 0);
	}

	/** Update gain / mute / solo; ramps start from each voice's current gain. */
	update(states: readonly SourceState[]): void {
		for (const st of states) {
			const v = this.voices.find((x) => x.source.id === st.id);
			if (!v) continue;
			v.source.gain = st.gain;
			v.source.muted = st.muted;
			v.source.soloed = st.soloed;
		}
		const targets = resolveTargets(this.voices.map((v) => v.source));
		for (const v of this.voices) {
			const to = targets.get(v.source.id) ?? 0;
			if (to === v.to) continue;
			v.from = this.gainOf(v);
			v.to = to;
			v.t = 0;
		}
	}

	private gainOf(v: Voice): number {
		if (v.t >= this.rampFrames) return v.to;
		const p = v.t / this.rampFrames;
		return v.from * fadeOut(p) + v.to * fadeIn(p);
	}

	/** Mixed sample of channel c at frame; does not advance ramps. */
	sample(c: number, frame: number): number {
		let s = 0;
		for (const v of this.voices) {
			const g = this.gainOf(v);
			if (g === 0) continue;
			const chans = v.source.channels;
			const ch = chans[c < chans.length ? c : chans.length - 1];
			if (frame >= 0 && frame < ch.length) s += g * ch[frame];
		}
		return s;
	}

	/** Advance gain ramps by one output frame. */
	tick(): void {
		for (const v of this.voices) if (v.t < this.rampFrames) v.t++;
	}

	get settled(): boolean {
		return this.voices.every((v) => v.t >= this.rampFrames);
	}
}
