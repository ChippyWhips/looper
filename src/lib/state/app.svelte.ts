import { Engine } from '../audio/engine';
import type { PeakLevel } from '../analysis/peaks';
import PeaksWorker from '../analysis/peaks.worker.ts?worker';
import type { PeaksResponse } from '../analysis/peaks.worker';
import OnsetsWorker from '../analysis/onsets.worker.ts?worker';
import type { OnsetsResponse } from '../analysis/onsets.worker';
import { nearestZeroCrossing } from '../analysis/zero-crossing';
import type { Edge } from './loop.svelte';
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

	/** Mono downmix ready: start onset detection (and tempo, phase 4). */
	protected onMono(): void {
		const mono = this.track.mono;
		if (!mono) return;
		const seq = this.openSeq;
		const w = new OnsetsWorker();
		w.onmessage = (e: MessageEvent<OnsetsResponse>) => {
			w.terminate();
			if (seq !== this.openSeq) return;
			this.track.onsets = e.data.onsets;
			this.track.analysisVersion++;
		};
		w.postMessage({ mono: mono.slice(), sampleRate: this.track.sampleRate });
		this.onMonoExtra(mono, seq);
	}

	protected onMonoExtra(_mono: Float32Array, _seq: number): void {}

	// Loop

	private get zcRadius(): number {
		return Math.round(0.002 * this.track.sampleRate);
	}

	private get snapSignal(): Float32Array | null {
		return this.track.mono ?? this.track.channels?.[0] ?? null;
	}

	/** Snap a dragged position: onset within 8 px, else zero crossing within ±2 ms. */
	snap(frame: number, alt: boolean): number {
		const f = Math.round(frame);
		if (alt || !this.loop.snap) return this.clampFrame(f);
		const on = this.track.onsets;
		if (on && on.length) {
			const r = 8 * this.viewport.fpp;
			const i = lowerBound(on, f);
			let best = -1;
			let bd = Infinity;
			for (const j of [i - 1, i]) {
				if (j < 0 || j >= on.length) continue;
				const d = Math.abs(on[j] - f);
				if (d < bd) {
					bd = d;
					best = on[j];
				}
			}
			if (best >= 0 && bd <= r) return best;
		}
		return this.snapZero(f);
	}

	/** Zero-crossing snap only (typed values). */
	snapZero(frame: number, dir: -1 | 0 | 1 = 0): number {
		const x = this.snapSignal;
		const f = this.clampFrame(Math.round(frame));
		if (!x || !this.loop.snap) return f;
		return nearestZeroCrossing(x, f, this.zcRadius, dir) ?? f;
	}

	private clampFrame(f: number): number {
		return Math.max(0, Math.min(this.track.length, Math.round(f)));
	}

	private get minLoop(): number {
		return Math.max(1, Math.round(0.001 * this.track.sampleRate));
	}

	private syncLoop(): void {
		this.engine.setLoop({ start: this.loop.start, end: this.loop.end, on: this.loop.on });
	}

	/** Set the whole region; turning looping on when a region is newly created. */
	setLoopRange(a: number, b: number, enable = false): void {
		if (!this.track.loaded) return;
		let start = this.clampFrame(Math.min(a, b));
		let end = this.clampFrame(Math.max(a, b));
		if (end - start < this.minLoop) {
			end = Math.min(this.track.length, start + this.minLoop);
			start = Math.max(0, end - this.minLoop);
		}
		const created = !this.loop.exists;
		this.loop.start = start;
		this.loop.end = end;
		if (enable || created) this.loop.on = true;
		this.syncLoop();
	}

	/** Move one edge. An edge cannot cross the other. */
	setEdge(edge: Edge, frame: number): void {
		if (!this.track.loaded) return;
		const f = this.clampFrame(frame);
		if (!this.loop.exists) {
			if (edge === 'in') this.setLoopRange(f, this.track.length);
			else this.setLoopRange(0, f);
			return;
		}
		if (edge === 'in') this.loop.start = Math.min(f, this.loop.end - this.minLoop);
		else this.loop.end = Math.max(f, this.loop.start + this.minLoop);
		this.loop.start = Math.max(0, this.loop.start);
		this.loop.end = Math.min(this.track.length, this.loop.end);
		this.syncLoop();
	}

	/** Move the region keeping its length. */
	moveLoop(start: number): void {
		const len = this.loop.length;
		const s = Math.max(0, Math.min(this.track.length - len, Math.round(start)));
		this.loop.start = s;
		this.loop.end = s + len;
		this.syncLoop();
	}

	/** I / O: set an edge at the playhead (snapped). */
	setEdgeAtPlayhead(edge: Edge): void {
		if (!this.track.loaded) return;
		this.setEdge(edge, this.snapZero(this.position()));
		this.loop.selected = edge;
	}

	toggleLoop(): void {
		if (!this.track.loaded || !this.loop.exists) return;
		this.loop.on = !this.loop.on;
		this.syncLoop();
	}

	toggleSnap(): void {
		this.loop.snap = !this.loop.snap;
	}

	/** ← / → on a selected edge: 1 ms (Shift 10 ms) snapped onwards; Alt: 1 sample unsnapped. */
	nudge(dir: -1 | 1, shift: boolean, alt: boolean): void {
		const edge = this.loop.selected;
		if (!edge || !this.loop.exists) return;
		const cur = edge === 'in' ? this.loop.start : this.loop.end;
		const sr = this.track.sampleRate;
		const step = alt ? 1 : Math.round((shift ? 0.01 : 0.001) * sr);
		let target = cur + dir * step;
		if (!alt && this.loop.snap && this.snapSignal) {
			const x = this.snapSignal;
			let z = nearestZeroCrossing(x, target, this.zcRadius);
			if (z === null || (z - cur) * dir <= 0) {
				z = nearestZeroCrossing(x, cur, step + this.zcRadius, dir);
			}
			if (z !== null) target = z;
		}
		this.setEdge(edge, target);
	}

	/** Typed or scrubbed In / Out (frames): exact, then zero-crossing snap unless Alt. */
	setEdgeValue(edge: Edge, frames: number, opts: { typed: boolean; alt: boolean }): void {
		const cur = edge === 'in' ? this.loop.start : this.loop.end;
		let f = Math.round(frames);
		if (!opts.alt)
			f = opts.typed ? this.snapZero(f) : this.snapZero(f, f > cur ? 1 : f < cur ? -1 : 0);
		this.setEdge(edge, f);
	}

	/** Typed Length moves Out. */
	setLengthValue(frames: number, opts: { typed: boolean; alt: boolean }): void {
		this.setEdgeValue('out', this.loop.start + frames, opts);
	}

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
	arrow(dir: -1 | 1, shift: boolean, alt: boolean): void {
		if (this.loop.selected && this.loop.exists) this.nudge(dir, shift, alt);
		else this.seekBy(dir * (shift ? 5 : 1));
	}

	loopKey(e: KeyboardEvent): boolean {
		switch (e.code) {
			case 'KeyL':
				this.toggleLoop();
				return true;
			case 'KeyI':
				this.setEdgeAtPlayhead('in');
				return true;
			case 'KeyO':
				this.setEdgeAtPlayhead('out');
				return true;
			case 'BracketLeft':
				if (this.loop.exists) this.loop.selected = 'in';
				return true;
			case 'BracketRight':
				if (this.loop.exists) this.loop.selected = 'out';
				return true;
		}
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

function lowerBound(a: Int32Array, v: number): number {
	let lo = 0;
	let hi = a.length;
	while (lo < hi) {
		const m = (lo + hi) >> 1;
		if (a[m] < v) lo = m + 1;
		else hi = m;
	}
	return lo;
}
