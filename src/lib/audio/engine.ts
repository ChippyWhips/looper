import workletUrl from './player.worklet.ts?worker&url';
import type { FromWorklet, SourcePayload, ToWorklet, TransportState } from './protocol';
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
export class Engine {
	ctx: AudioContext | null = null;
	node: AudioWorkletNode | null = null;
	analyser: AnalyserNode | null = null;
	length = 0;
	private last: PosReport = { contextTime: 0, sourceFrame: 0, velocity: 0, state: 'stopped' };
	private loop: LoopState = { start: 0, end: 0, on: false };
	private ready: Promise<void> | null = null;
	private pings = new Map<number, () => void>();
	private pingId = 0;
	private latencySent = -1;
	events: EngineEvents = {};

	get sampleRate(): number {
		return this.ctx?.sampleRate ?? 48000;
	}

	get state(): TransportState {
		return this.last.state;
	}

	/** (Re)create the context at the given rate. Resolves when the worklet core is ready. */
	async ensureContext(sampleRate: number): Promise<void> {
		if (this.ctx && this.ctx.sampleRate === sampleRate && this.ready) return this.ready;
		if (this.ctx) {
			this.node?.disconnect();
			void this.ctx.close();
		}
		const ctx = new AudioContext({ sampleRate, latencyHint: 'interactive' });
		this.ctx = ctx;
		this.ready = (async () => {
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
			this.node = node;
			this.analyser = analyser;
			await new Promise<void>((resolve, reject) => {
				node.port.onmessage = (e: MessageEvent<FromWorklet>) => {
					if (e.data.type === 'ready') resolve();
					else if (e.data.type === 'error') reject(new Error(e.data.message));
					this.onMessage(e.data);
				};
			});
			node.port.onmessage = (e: MessageEvent<FromWorklet>) => this.onMessage(e.data);
		})();
		return this.ready;
	}

	private send(msg: ToWorklet, transfer: Transferable[] = []): void {
		this.node?.port.postMessage(msg, transfer);
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
