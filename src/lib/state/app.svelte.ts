import { Engine } from '../audio/engine';
import type { PeakLevel } from '../analysis/peaks';
import PeaksWorker from '../analysis/peaks.worker.ts?worker';
import type { PeaksResponse } from '../analysis/peaks.worker';
import { LoopState } from './loop.svelte';
import { TrackState } from './track.svelte';
import { TransportState } from './transport.svelte';
import { ViewState } from './view.svelte';

const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));

/** Application controller: owns the engine and the runes state the UI binds to. */
export class App {
	readonly engine = new Engine();
	readonly track = new TrackState();
	readonly loop = new LoopState();
	readonly transport = new TransportState();
	readonly view = new ViewState();
	private peaksWorker: Worker | null = null;
	private openSeq = 0;
	/** ms from open() to playable, for performance tests. */
	lastOpenMs = 0;

	constructor() {
		this.engine.events.state = (s) => (this.transport.state = s);
		this.engine.events.error = (m) => console.warn('engine:', m);
	}

	get viewport() {
		return this.view.viewport;
	}

	/** Audible frame now; for rAF consumers. */
	position(): number {
		return this.engine.position();
	}

	async open(file: File | Blob, name = (file as File).name ?? 'Untitled'): Promise<void> {
		const seq = ++this.openSeq;
		const t0 = performance.now();
		const t = this.track;
		if (this.transport.playing) this.engine.pause();
		t.status = 'loading';
		t.error = '';
		let buffer: AudioBuffer;
		try {
			const bytes = await file.arrayBuffer();
			buffer = await this.engine.decode(bytes);
		} catch {
			if (seq !== this.openSeq) return;
			t.status = 'error';
			t.error = 'Unsupported file';
			return;
		}
		if (seq !== this.openSeq) return;
		await this.engine.load(buffer);
		t.buffer = buffer;
		t.channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) =>
			buffer.getChannelData(c)
		);
		t.file = file;
		t.name = name.replace(/\.[^.]+$/, '');
		t.size = file.size;
		t.length = buffer.length;
		t.sampleRate = buffer.sampleRate;
		t.peaks = null;
		t.mono = null;
		t.onsets = null;
		this.loop.start = 0;
		this.loop.end = 0;
		this.loop.on = false;
		this.loop.selected = null;
		this.engine.setLoop({ start: 0, end: 0, on: false });
		this.engine.setParams(this.transport.speed / 100, this.transport.cents);
		this.viewport.setLength(buffer.length);
		this.view.wave.follow = true;
		t.status = 'ready';
		t.analysisVersion++;
		this.lastOpenMs = performance.now() - t0;
		void this.analyse(seq);
	}

	private async analyse(seq: number): Promise<void> {
		const ch = this.track.channels;
		if (!ch) return;
		const copies: Float32Array[] = [];
		for (const c of ch) {
			copies.push(c.slice());
			await yieldTask();
		}
		if (seq !== this.openSeq) return;
		this.peaksWorker?.terminate();
		const w = new PeaksWorker();
		this.peaksWorker = w;
		w.onmessage = (e: MessageEvent<PeaksResponse>) => {
			if (seq !== this.openSeq) return;
			const msg = e.data;
			if (msg.type === 'levels') {
				const levels: PeakLevel[] = msg.levels;
				this.track.peaks = { length: this.track.length, levels };
				this.track.analysisVersion++;
			} else if (msg.type === 'mono') {
				this.track.mono = msg.mono;
				w.terminate();
				this.onMono();
			}
		};
		w.postMessage(
			{ channels: copies, width: Math.max(1280, this.viewport.width) },
			copies.map((c) => c.buffer)
		);
	}

	/** Called when the mono downmix is ready (onsets, tempo). */
	protected onMono(): void {}

	togglePlay(): void {
		if (!this.track.loaded) return;
		if (this.transport.playing) this.engine.pause();
		else this.play(this.position());
	}

	play(from: number): void {
		if (!this.track.loaded) return;
		this.view.wave.follow = true;
		void this.engine.play(from, this.transport.countIn ? this.transport.tempo : null);
	}

	seek(frame: number): void {
		if (!this.track.loaded) return;
		this.engine.seek(frame);
	}

	/** Enter: jump to loop start (or track start) and play. */
	jumpToStart(): void {
		if (!this.track.loaded) return;
		const f = this.loop.exists ? this.loop.start : 0;
		if (this.transport.playing && !this.transport.countIn) this.engine.seek(f);
		else this.play(f);
	}

	seekBy(seconds: number): void {
		this.seek(this.position() + seconds * this.track.sampleRate);
	}

	toggleCountIn(): void {
		if (this.transport.tempo === null) return;
		this.transport.countIn = !this.transport.countIn;
	}

	setTempo(bpm: number): void {
		this.transport.tempoOverride = Math.round(bpm * 10) / 10;
	}

	/** ← / →: nudge the selected edge, else seek 1 s (Shift 5 s). */
	arrow(dir: number, shift: boolean, _alt: boolean): void {
		this.seekBy(dir * (shift ? 5 : 1));
	}

	/** Loop shortcuts (phase 3). */
	loopKey(_e: KeyboardEvent): boolean {
		return false;
	}

	// View

	zoomStep(factor: number): void {
		const vp = this.viewport;
		const ph = this.position();
		const x = ph >= vp.start && ph <= vp.end ? vp.xAt(ph) : vp.width / 2;
		vp.zoomAt(factor, x);
	}

	zoomFit(): void {
		this.viewport.fit();
	}

	zoomToLoop(): void {
		if (this.loop.exists) this.viewport.show(this.loop.start, this.loop.end, 0.05);
	}

	followPlayhead(): void {
		this.view.wave.follow = true;
		const ph = this.position();
		const vp = this.viewport;
		if (ph < vp.start || ph >= vp.end) vp.setStart(ph);
	}

	manualPan(): void {
		this.view.wave.follow = false;
	}

	/** Per-frame housekeeping: follow the playhead by paging. Returns the playhead. */
	tick(): number {
		const ph = this.position();
		const vp = this.viewport;
		if (this.transport.playing && this.view.wave.follow && !vp.isFit) {
			if (ph < vp.start || ph >= vp.end) vp.setStart(ph);
		}
		return ph;
	}
}
