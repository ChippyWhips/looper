import workletUrl from './player.worklet.ts?worker&url';
import {
	POSITION_COMMANDS,
	type FromWorklet,
	type SourcePayload,
	type ToWorklet,
	type TransportState
} from './protocol';
import { sniffSampleRate } from './sniff';
import type { SourceState } from './sources';

export interface LoopState {
	start: number;
	end: number;
	on: boolean;
}

interface PosReport {
	contextTime: number;
	sourceFrame: number;
	velocity: number;
	state: TransportState;
}

export interface EngineEvents {
	state?: (state: TransportState) => void;
	ended?: (frame: number) => void;
	/** Audio-clock times at which count-in clicks are heard. */
	beats?: (times: number[]) => void;
	error?: (message: string) => void;
}

const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Main-thread side of the player. Owns the AudioContext and the worklet node; sends commands
 * and interpolates the audible position. Holds no audio state of its own beyond the last report.
 */
interface Graph {
	ctx: AudioContext;
	node: AudioWorkletNode | null;
	analyser: AnalyserNode | null;
	ready: Promise<void>;
}

export class Engine {
	private graphs = new Map<number, Graph>();
	private active: Graph | null = null;
	length = 0;
	private last: PosReport = { contextTime: 0, sourceFrame: 0, velocity: 0, state: 'stopped' };
	private loop: LoopState = { start: 0, end: 0, on: false };
	private pings = new Map<number, () => void>();
	private pingId = 0;
	private latencySent = -1;
	events: EngineEvents = {};
	/** Called when the active context (and so the analyser) changes. */
	onGraph: (() => void) | null = null;

	get ctx(): AudioContext | null {
		return this.active?.ctx ?? null;
	}

	get node(): AudioWorkletNode | null {
		return this.active?.node ?? null;
	}

	get analyser(): AnalyserNode | null {
		return this.active?.analyser ?? null;
	}

	get sampleRate(): number {
		return this.ctx?.sampleRate ?? 48000;
	}

	get state(): TransportState {
		return this.last.state;
	}

	/**
	 * Create contexts ahead of time. Constructing an AudioContext can block the main thread
	 * for hundreds of ms, so this runs at startup rather than when a track is opened.
	 */
	async prewarm(rates: number[]): Promise<void> {
		for (const r of rates) {
			await new Promise<void>((res) => setTimeout(res, 0));
			await this.graph(r).ready;
		}
		this.warm = true;
	}

	/** True once prewarm() has finished. */
	warm = false;

	private graph(sampleRate: number): Graph {
		const existing = this.graphs.get(sampleRate);
		if (existing) return existing;
		const ctx = new AudioContext({ sampleRate, latencyHint: 'interactive' });
		const g: Graph = { ctx, node: null, analyser: null, ready: Promise.resolve() };
		g.ready = (async () => {
			await ctx.audioWorklet.addModule(workletUrl);
			const node = new AudioWorkletNode(ctx, 'looper-player', {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [2]
			});
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 2048;
			analyser.smoothingTimeConstant = 0;
			node.connect(analyser);
			analyser.connect(ctx.destination);
			g.node = node;
			g.analyser = analyser;
			await new Promise<void>((resolve, reject) => {
				node.port.onmessage = (e: MessageEvent<FromWorklet>) => {
					if (e.data.type === 'ready') resolve();
					else if (e.data.type === 'error') reject(new Error(e.data.message));
				};
			});
			node.port.onmessage = (e: MessageEvent<FromWorklet>) => {
				if (this.active === g) this.onMessage(e.data);
			};
		})();
		this.graphs.set(sampleRate, g);
		return g;
	}

	/** Make the context at this rate active. Resolves when its worklet core is ready. */
	async ensureContext(sampleRate: number): Promise<void> {
		const g = this.graph(sampleRate);
		if (this.active !== g) {
			if (this.active) {
				this.active.node?.port.postMessage({ type: 'pause' } satisfies ToWorklet);
				void this.active.ctx.suspend();
			}
			this.active = g;
			this.latencySent = -1;
			this.sentEpoch = 0;
			await g.ready;
			this.onGraph?.();
		}
		return g.ready;
	}

	private sentEpoch = 0;

	private send(msg: ToWorklet, transfer: Transferable[] = []): void {
		if (!this.node) return;
		if ((POSITION_COMMANDS as readonly string[]).includes(msg.type)) this.sentEpoch++;
		this.node.port.postMessage(msg, transfer);
	}

	/** Resolves once the worklet has processed every earlier message. */
	flush(): Promise<void> {
		const id = ++this.pingId;
		return new Promise((r) => {
			this.pings.set(id, r);
			this.send({ type: 'ping', id });
		});
	}

	private onMessage(msg: FromWorklet): void {
		switch (msg.type) {
			case 'pos': {
				// A report that predates our latest seek/play/pause would move the playhead back.
				if (msg.epoch < this.sentEpoch) break;
				const prev = this.last.state;
				this.last = msg;
				if (prev !== msg.state) this.events.state?.(msg.state);
				break;
			}
			case 'ended':
				this.last = { contextTime: 0, sourceFrame: msg.frame, velocity: 0, state: 'stopped' };
				this.events.state?.('stopped');
				this.events.ended?.(msg.frame);
				break;
			case 'beats':
				this.events.beats?.(msg.times);
				break;
			case 'pong':
				this.pings.get(msg.id)?.();
				this.pings.delete(msg.id);
				break;
			case 'error':
				this.events.error?.(msg.message);
				break;
		}
	}

	/** Decode a file at its native sample rate. Throws on unsupported input. */
	async decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
		const rate = sniffSampleRate(new Uint8Array(bytes)) ?? this.ctx?.sampleRate ?? 48000;
		await this.ensureContext(rate);
		return await this.ctx!.decodeAudioData(bytes.slice(0));
	}

	/** Hand decoded audio to the worklet as the single `mix` source. */
	async load(buffer: AudioBuffer): Promise<void> {
		await this.ensureContext(buffer.sampleRate);
		const channels: Float32Array[] = [];
		for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) {
			channels.push(buffer.getChannelData(c).slice());
			await yieldTask();
		}
		const source: SourcePayload = {
			id: 'mix',
			kind: 'mix',
			label: 'Mix',
			channels,
			gain: 1,
			muted: false,
			soloed: false
		};
		this.length = buffer.length;
		this.last = { contextTime: 0, sourceFrame: 0, velocity: 0, state: 'stopped' };
		this.send(
			{ type: 'load', sources: [source] },
			channels.map((c) => c.buffer)
		);
		this.send({ type: 'loop', ...this.loop });
	}

	setSources(states: SourceState[]): void {
		this.send({ type: 'sources', states });
	}

	async play(from: number, countInBpm: number | null = null): Promise<void> {
		if (!this.ctx) return;
		if (this.ctx.state !== 'running') await this.ctx.resume();
		this.syncLatency(true);
		this.send({ type: 'play', from: Math.round(from), countInBpm });
		this.last = { ...this.last, sourceFrame: Math.round(from), velocity: 0 };
	}

	pause(): void {
		this.send({ type: 'pause' });
	}

	seek(frame: number): void {
		const f = Math.max(0, Math.min(this.length, Math.round(frame)));
		this.send({ type: 'seek', frame: f });
		if (this.last.state === 'stopped') this.last = { ...this.last, sourceFrame: f, velocity: 0 };
	}

	setLoop(loop: LoopState): void {
		this.loop = { ...loop };
		this.send({ type: 'loop', ...this.loop });
	}

	setParams(speed: number, cents: number): void {
		this.send({ type: 'params', speed, cents });
	}

	private syncLatency(force = false): void {
		const ctx = this.ctx;
		if (!ctx) return;
		const s = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
		if (force || Math.abs(s - this.latencySent) > 0.001) {
			this.latencySent = s;
			this.send({ type: 'latency', seconds: s });
		}
	}

	/** Audible source frame now. Call from requestAnimationFrame. */
	position(): number {
		const r = this.last;
		if (!this.ctx || r.velocity === 0) return r.sourceFrame;
		this.syncLatency();
		let f = r.sourceFrame + (this.ctx.currentTime - r.contextTime) * r.velocity;
		const { start, end, on } = this.loop;
		if (on && end > start && r.sourceFrame >= start && r.sourceFrame < end && f >= end) {
			f = start + ((f - end) % (end - start));
		}
		return Math.max(0, Math.min(this.length, Math.floor(f)));
	}
}
