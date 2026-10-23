/// <reference lib="webworker" />
import { PlayerCore } from './player-core';
import type { FromWorklet, ToWorklet } from './protocol';
import { loadSignalsmith, SignalsmithStretcher } from './stretcher/signalsmith';

// AudioWorkletGlobalScope globals; not in TypeScript's DOM or worker libs.
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	constructor(options?: unknown);
}
declare function registerProcessor(name: string, ctor: new (options?: unknown) => unknown): void;

class PlayerProcessor extends AudioWorkletProcessor {
	private core: PlayerCore | null = null;
	private pending: ToWorklet[] = [];

	constructor(options?: unknown) {
		super(options);
		const post = (msg: FromWorklet) => this.port.postMessage(msg);
		this.port.onmessage = (e: MessageEvent<ToWorklet>) => {
			// Acknowledge immediately: earlier messages are already queued in order.
			if (e.data.type === 'ping') post({ type: 'pong', id: e.data.id });
			else if (this.core) this.core.enqueue(e.data);
			else this.pending.push(e.data);
		};
		loadSignalsmith()
			.then((mod) => {
				this.core = new PlayerCore(sampleRate, new SignalsmithStretcher(mod, 2, sampleRate), post);
				for (const m of this.pending) this.core.enqueue(m);
				this.pending = [];
				post({ type: 'ready' });
			})
			.catch((err: unknown) => post({ type: 'error', message: String(err) }));
	}

	process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const out = outputs[0];
		if (!this.core) {
			for (const ch of out) ch.fill(0);
			return true;
		}
		this.core.process(out, currentFrame);
		return true;
	}
}

registerProcessor('looper-player', PlayerProcessor);
