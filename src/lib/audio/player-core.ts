import { clickSample, planCountIn } from './countin';
import {
	POSITION_COMMANDS,
	type FromWorklet,
	type ToWorklet,
	type TransportState
} from './protocol';
import { Reader } from './reader';
import { Mixer, type AudioSource } from './sources';
import type { Stretcher } from './stretcher/types';

const RING = 1 << 16;
const RMASK = RING - 1;
const HIST = 1024;
const HMASK = HIST - 1;
const MAX_IN = 2048;

/**
 * All player DSP, independent of AudioWorkletGlobalScope so it can run in Node tests.
 * Signal flow: mixer → reader (loop/seek) → stretcher → (bypass at unity) → clicks → out.
 */
export class PlayerCore {
	readonly sampleRate: number;
	private mixer: Mixer;
	private reader: Reader;
	private stretcher: Stretcher;
	private post: (msg: FromWorklet) => void;
	private queue: ToWorklet[] = [];

	private state: TransportState = 'stopped';
	private speed = 1;
	private cents = 0;
	private inAcc = 0;

	private inBuf = [new Float32Array(MAX_IN), new Float32Array(MAX_IN)];
	private sOut = [new Float32Array(128), new Float32Array(128)];
	private ring = [new Float32Array(RING), new Float32Array(RING)];
	private labels = new Float64Array(RING);
	private sFed = 0;
	private sessionStart = 0;
	private startLabel = 0;

	private bypass = 1;
	private readonly bypassStep: number;
	private fadeLeft = 0;
	private readonly fadeFrames: number;

	private clicks: number[] = [];
	private audioStart = -1;
	/** Output frame before which stretched audio is muted, so pre-echo never precedes the start. */
	private gateFrame = 0;
	private readonly gateRamp: number;

	private outLatency = 0;
	private histFrame = new Float64Array(HIST);
	private histLabel = new Float64Array(HIST);
	private histVel = new Float64Array(HIST);
	private histIdx = 0;
	private histCount = 0;
	private reportEvery: number;
	private reportCountdown = 0;
	private pausedFrame = 0;
	private loaded = false;

	constructor(sampleRate: number, stretcher: Stretcher, post: (msg: FromWorklet) => void) {
		this.sampleRate = sampleRate;
		this.stretcher = stretcher;
		this.post = post;
		this.mixer = new Mixer(sampleRate);
		this.reader = new Reader(this.mixer, sampleRate);
		this.bypassStep = 1 / Math.round(0.02 * sampleRate);
		this.fadeFrames = Math.round(0.005 * sampleRate);
		this.gateRamp = Math.round(0.001 * sampleRate);
		this.reportEvery = Math.round(sampleRate / 30);
	}

	enqueue(msg: ToWorklet): void {
		this.queue.push(msg);
	}

	private get unity(): boolean {
		return this.speed === 1 && this.cents === 0;
	}

	private labelAt(s: number): number {
		const i = Math.floor(s);
		if (i < this.sessionStart) return this.startLabel;
		if (i >= this.sFed) return this.labels[(this.sFed - 1) & RMASK];
		return this.labels[i & RMASK];
	}

	private epoch = 0;

	private apply(msg: ToWorklet, frame: number): void {
		if ((POSITION_COMMANDS as readonly string[]).includes(msg.type)) this.epoch++;
		switch (msg.type) {
			case 'load': {
				const sources: AudioSource[] = msg.sources.map((s) => ({ ...s }));
				this.mixer.setSources(sources);
				this.state = 'stopped';
				this.pausedFrame = 0;
				this.reader.place(0);
				this.loaded = true;
				break;
			}
			case 'sources':
				this.mixer.update(msg.states);
				break;
			case 'addSources':
				this.mixer.addSources(msg.sources.map((x) => ({ ...x })));
				break;
			case 'removeSources':
				this.mixer.removeSources(msg.ids);
				break;
			case 'play':
				if (!this.loaded) break;
				this.start(msg.from, msg.countInBpm, frame);
				break;
			case 'pause':
				if (this.state !== 'stopped' && this.fadeLeft === 0) {
					this.pausedFrame = this.audibleNow().label;
					this.fadeLeft = this.fadeFrames;
				}
				break;
			case 'seek':
				if (this.state === 'stopped') {
					this.pausedFrame = msg.frame;
					this.reader.place(msg.frame);
				} else {
					this.reader.seek(msg.frame);
				}
				break;
			case 'loop':
				this.reader.setLoop({ start: msg.start, end: msg.end, on: msg.on });
				break;
			case 'params':
				this.speed = msg.speed;
				this.cents = msg.cents;
				this.stretcher.setRate(msg.speed);
				this.stretcher.setPitchCents(msg.cents);
				break;
			case 'latency':
				this.outLatency = msg.seconds;
				break;
			case 'ping':
				this.post({ type: 'pong', id: msg.id });
				break;
		}
	}

	private start(from: number, countInBpm: number | null, frame: number): void {
		this.stretcher.reset();
		this.reader.place(from >= this.reader.length ? 0 : from);
		this.reader.fadeInFromSilence();
		this.sessionStart = this.sFed;
		this.startLabel = this.reader.pos;
		this.inAcc = 0;
		this.bypass = this.unity ? 1 : 0;
		this.fadeLeft = 0;
		this.clicks = [];
		this.audioStart = -1;
		if (countInBpm && countInBpm > 0) {
			const plan = planCountIn(frame, countInBpm, this.speed, this.sampleRate);
			this.clicks = plan.clicks;
			this.audioStart = plan.audioStart;
			const lead = (plan.audioStart - frame) * this.speed - this.stretcher.latencyFrames();
			this.reader.zeros = Math.max(0, Math.round(lead));
			this.gateFrame = plan.audioStart;
			this.state = 'counting';
			this.post({
				type: 'beats',
				times: plan.clicks.map((c) => c / this.sampleRate + this.outLatency)
			});
		} else {
			this.gateFrame = frame + Math.round(this.stretcher.latencyFrames() / this.speed);
			this.state = 'playing';
		}
	}

	private audibleNow(): { label: number; velocity: number; frame: number } {
		const back = Math.min(
			this.histCount - 1,
			Math.round((this.outLatency * this.sampleRate) / 128)
		);
		if (back < 0) return { label: this.pausedFrame, velocity: 0, frame: 0 };
		const i = (this.histIdx - 1 - back) & HMASK;
		return { label: this.histLabel[i], velocity: this.histVel[i], frame: this.histFrame[i] };
	}

	/** Render one quantum into out[0..1]. `frame` is the context frame of out[0][0]. */
	process(out: Float32Array[], frame: number): void {
		while (this.queue.length) this.apply(this.queue.shift()!, frame);
		const n = out[0].length;
		const L = out[0];
		const R = out[1] ?? out[0];
		let label = this.pausedFrame;
		let velocity = 0;

		if (this.state === 'stopped' || !this.loaded) {
			L.fill(0);
			if (R !== L) R.fill(0);
		} else {
			this.renderPlaying(L, R, n, frame);
			const lat = this.stretcher.latencyFrames();
			label = this.labelAt(this.sFed - this.lastIn - lat);
			const labelEnd = this.labelAt(this.sFed - this.lastIn + (n - 1) * this.speed - lat);
			velocity = labelEnd !== label ? this.speed * this.sampleRate : 0;
			if (this.state === 'counting' && frame + n > this.audioStart) this.state = 'playing';
			if (this.reader.ended && label >= this.reader.length) {
				this.state = 'stopped';
				this.pausedFrame = this.reader.length;
				label = this.pausedFrame;
				velocity = 0;
				this.post({ type: 'ended', frame: this.pausedFrame });
			}
		}

		const h = this.histIdx & HMASK;
		this.histFrame[h] = frame;
		this.histLabel[h] = label;
		this.histVel[h] = velocity;
		this.histIdx++;
		this.histCount = Math.min(HIST, this.histCount + 1);

		this.reportCountdown -= n;
		if (this.reportCountdown <= 0) {
			this.reportCountdown = this.reportEvery;
			const a = this.audibleNow();
			const stopped = this.state === 'stopped';
			this.post({
				type: 'pos',
				contextTime:
					(stopped ? frame : a.frame) / this.sampleRate + (stopped ? 0 : this.outLatency),
				sourceFrame: stopped ? this.pausedFrame : a.label,
				velocity: stopped ? 0 : a.velocity,
				state: this.state,
				epoch: this.epoch
			});
		}
	}

	private lastIn = 0;

	private renderPlaying(L: Float32Array, R: Float32Array, n: number, frame: number): void {
		this.inAcc += n * this.speed;
		const nIn = Math.min(MAX_IN, Math.floor(this.inAcc));
		this.inAcc -= nIn;
		const sBase = this.sFed;
		const ring = this.ring;
		const labels = this.labels;
		this.reader.read(this.inBuf, nIn, (i, f) => {
			labels[(sBase + i) & RMASK] = f;
		});
		for (let i = 0; i < nIn; i++) {
			ring[0][(sBase + i) & RMASK] = this.inBuf[0][i];
			ring[1][(sBase + i) & RMASK] = this.inBuf[1][i];
		}
		this.sFed += nIn;
		this.lastIn = nIn;

		this.stretcher.process(this.inBuf, nIn, this.sOut, n);

		const target = this.unity ? 1 : 0;
		const lat = this.stretcher.latencyFrames();
		const sL = this.sOut[0];
		const sR = this.sOut[1];
		for (let j = 0; j < n; j++) {
			if (this.bypass !== target) {
				this.bypass += target > this.bypass ? this.bypassStep : -this.bypassStep;
				if (Math.abs(this.bypass - target) < this.bypassStep / 2) this.bypass = target;
			}
			let l = sL[j];
			let r = sR[j];
			if (this.bypass > 0) {
				const s = Math.round(sBase + j * this.speed - lat);
				const inRange = s >= this.sessionStart && s < this.sFed;
				const bl = inRange ? ring[0][s & RMASK] : 0;
				const br = inRange ? ring[1][s & RMASK] : 0;
				l = this.bypass * bl + (1 - this.bypass) * l;
				r = this.bypass * br + (1 - this.bypass) * r;
			}
			const g = frame + j - this.gateFrame;
			if (g < this.gateRamp) {
				const gain = g < 0 ? 0 : (g + 1) / this.gateRamp;
				l *= gain;
				r *= gain;
			}
			for (let k = 0; k < this.clicks.length; k++) {
				const d = frame + j - this.clicks[k];
				if (d >= 0) {
					const c = clickSample(d, k === 0, this.sampleRate);
					l += c;
					r += c;
				}
			}
			if (this.fadeLeft > 0) {
				const g = this.fadeLeft / this.fadeFrames;
				l *= g;
				r *= g;
				this.fadeLeft--;
				if (this.fadeLeft === 0) {
					for (let z = j + 1; z < n; z++) {
						L[z] = 0;
						R[z] = 0;
					}
					L[j] = l;
					R[j] = r;
					this.state = 'stopped';
					this.reader.place(this.pausedFrame);
					return;
				}
			}
			L[j] = l;
			R[j] = r;
		}
	}
}
