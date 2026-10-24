import { Engine } from '../audio/engine';
import type { PeakLevel } from '../analysis/peaks';
import PeaksWorker from '../analysis/peaks.worker.ts?worker';
import type { PeaksResponse } from '../analysis/peaks.worker';
import OnsetsWorker from '../analysis/onsets.worker.ts?worker';
import type { OnsetsResponse } from '../analysis/onsets.worker';
import { nearestZeroCrossing } from '../analysis/zero-crossing';
import type { Edge } from './loop.svelte';
import TempoWorker from '../analysis/tempo.worker.ts?worker';
import type { TempoResponse } from '../analysis/tempo.worker';
import { PITCH_MAX, PITCH_MIN, SPEED_MAX, SPEED_MIN, SPEED_PRESETS } from './transport.svelte';
import { LoopState } from './loop.svelte';
import { TrackState } from './track.svelte';
import { TransportState } from './transport.svelte';
import { ViewState } from './view.svelte';
import { TrackStore, type RecentEntry } from '../storage/track-store';
import { defaultSettings, rescale, type Settings } from '../storage/settings-schema';

const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));

/** Application controller: owns the engine and the runes state the UI binds to. */
export class App {
	readonly engine = new Engine();
	readonly track = new TrackState();
	readonly loop = new LoopState();
	readonly transport = new TransportState();
	readonly view = new ViewState();
	readonly store = new TrackStore();
	recent = $state<RecentEntry[]>([]);
	private peaksWorker: Worker | null = null;
	private openSeq = 0;
	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private lastSaved = '';
	/** ms from open() to playable, for performance tests. */
	lastOpenMs = 0;

	private beats: number[] = [];

	constructor() {
		this.engine.events.state = (s) => (this.transport.state = s);
		this.engine.events.beats = (times) => (this.beats = times);
		this.engine.events.error = (m) => console.warn('engine:', m);
	}

	get viewport() {
		return this.view.viewport;
	}

	/** Audible frame now; for rAF consumers. */
	position(): number {
		return this.engine.position();
	}

	/** Open a file from disk (picker or drop). */
	async open(file: File | Blob, name = (file as File).name ?? 'Untitled'): Promise<void> {
		const meta = {
			name: name.replace(/\.[^.]+$/, ''),
			fileName: name,
			type: file.type,
			size: file.size
		};
		this.flushSave();
		this.track.status = 'loading';
		let bytes: ArrayBuffer;
		try {
			bytes = await file.arrayBuffer();
		} catch {
			this.fail();
			return;
		}
		await this.openBytes(bytes, meta, null);
	}

	/** Reopen a track from the Recent list. */
	async openRecent(entry: RecentEntry): Promise<void> {
		this.view.recentOpen = false;
		if (entry.id === this.track.id) return;
		this.flushSave();
		const bytes = await this.store.readOriginal(entry.id).catch(() => null);
		if (!bytes) {
			this.recent = await this.store.forget(entry.id).catch(() => this.recent);
			this.fail();
			return;
		}
		await this.openBytes(bytes, entry, entry.id);
	}

	/** Most recent track, paused at its last position. */
	async restore(): Promise<void> {
		if (!this.store.available) return;
		try {
			this.recent = await this.store.recent();
		} catch {
			return;
		}
		const first = this.recent[0];
		if (first && this.track.status === 'empty') await this.openRecent(first);
	}

	private fail(message = 'Unsupported file'): void {
		this.track.status = 'error';
		this.track.error = message;
	}

	private async openBytes(
		bytes: ArrayBuffer,
		meta: { name: string; fileName: string; type: string; size: number },
		knownId: string | null
	): Promise<void> {
		const seq = ++this.openSeq;
		const t0 = performance.now();
		const t = this.track;
		this.flushSave();
		if (this.transport.playing) this.engine.pause();
		t.status = 'loading';
		t.error = '';
		const ingest: Promise<string | null> = knownId
			? Promise.resolve(knownId)
			: this.store.available
				? this.store.ingest(bytes).then(
						(r) => r.id,
						() => null
					)
				: Promise.resolve(null);
		let buffer: AudioBuffer;
		try {
			buffer = await this.engine.decode(bytes);
		} catch {
			if (seq === this.openSeq) this.fail();
			return;
		}
		if (seq !== this.openSeq) return;
		const id = await ingest;
		const [settings, peaks, onsets, analysis] = id
			? await Promise.all([
					this.store.loadSettings(id).catch(() => null),
					this.store.loadPeaks(id).catch(() => null),
					this.store.loadOnsets(id).catch(() => null),
					this.store.loadAnalysis(id).catch(() => null)
				])
			: [null, null, null, null];
		if (seq !== this.openSeq) return;
		await this.engine.load(buffer);
		if (seq !== this.openSeq) return;

		t.id = id;
		t.buffer = buffer;
		t.channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) =>
			buffer.getChannelData(c)
		);
		t.name = meta.name;
		t.size = meta.size;
		t.length = buffer.length;
		t.sampleRate = buffer.sampleRate;
		t.peaks = peaks && peaks.length === buffer.length ? peaks : null;
		t.mono = null;
		t.onsets = onsets;
		this.transport.tempoDetected = analysis?.tempo ?? null;
		this.applySettings(
			settings ? rescale(settings, buffer.sampleRate) : defaultSettings(buffer.sampleRate)
		);
		this.view.wave.follow = true;
		t.status = 'ready';
		t.analysisVersion++;
		this.lastOpenMs = performance.now() - t0;
		this.lastSaved = JSON.stringify(this.snapshotCore());

		if (id) {
			const entry: RecentEntry = {
				id,
				name: meta.name,
				fileName: meta.fileName,
				type: meta.type,
				length: buffer.length,
				sampleRate: buffer.sampleRate,
				size: meta.size,
				openedAt: Date.now()
			};
			this.store.touch(entry).then(
				(list) => seq === this.openSeq && (this.recent = list),
				() => {}
			);
		}
		void this.analyse(seq, !t.peaks, !t.onsets, analysis === null);
	}

	private applySettings(s: Settings): void {
		const len = this.track.length;
		const start = Math.min(len, Math.max(0, s.loop.start));
		const end = Math.min(len, Math.max(0, s.loop.end));
		this.loop.start = end > start ? start : 0;
		this.loop.end = end > start ? end : 0;
		this.loop.on = end > start && s.loop.on;
		this.loop.selected = null;
		this.transport.speed = Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, s.speed)));
		this.transport.cents = Math.round(Math.min(PITCH_MAX, Math.max(PITCH_MIN, s.cents)));
		this.transport.countIn = s.countIn;
		this.transport.tempoOverride = s.tempoOverride;
		this.engine.setLoop({ start: this.loop.start, end: this.loop.end, on: this.loop.on });
		this.engine.setParams(this.transport.speed / 100, this.transport.cents);
		this.viewport.setLength(len);
		if (s.view) this.viewport.restore(s.view.start, s.view.fpp);
		this.engine.seek(Math.min(len, Math.max(0, s.position)));
	}

	private async analyse(
		seq: number,
		wantPeaks: boolean,
		wantOnsets: boolean,
		wantTempo: boolean
	): Promise<void> {
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
		const id = this.track.id;
		w.onmessage = (e: MessageEvent<PeaksResponse>) => {
			if (seq !== this.openSeq) return;
			const msg = e.data;
			if (msg.type === 'levels') {
				const levels: PeakLevel[] = msg.levels;
				this.track.peaks = { length: this.track.length, levels };
				this.track.analysisVersion++;
				if (msg.final && id) this.store.savePeaks(id, this.track.peaks).catch(() => {});
			} else if (msg.type === 'mono') {
				this.track.mono = msg.mono;
				w.terminate();
				if (wantOnsets) this.detectOnsets(msg.mono, seq);
				if (wantTempo) this.detectTempo(msg.mono, seq);
			}
		};
		w.postMessage(
			{ channels: copies, width: Math.max(1280, this.viewport.width), peaks: wantPeaks },
			copies.map((c) => c.buffer)
		);
	}

	private detectOnsets(mono: Float32Array, seq: number): void {
		const id = this.track.id;
		const w = new OnsetsWorker();
		w.onmessage = (e: MessageEvent<OnsetsResponse>) => {
			w.terminate();
			if (seq !== this.openSeq) return;
			this.track.onsets = e.data.onsets;
			this.track.analysisVersion++;
			if (id) this.store.saveOnsets(id, e.data.onsets).catch(() => {});
		};
		w.postMessage({ mono: mono.slice(), sampleRate: this.track.sampleRate });
	}

	/** Tempo detection in a worker; a typed override always wins. */
	private detectTempo(mono: Float32Array, seq: number): void {
		const id = this.track.id;
		const w = new TempoWorker();
		w.onmessage = (e: MessageEvent<TempoResponse>) => {
			w.terminate();
			if (seq !== this.openSeq) return;
			if (e.data.error) console.warn('tempo:', e.data.error);
			const bpm = e.data.bpm === null ? null : Math.round(e.data.bpm * 10) / 10;
			this.transport.tempoDetected = bpm;
			if (id && !e.data.error) this.store.saveAnalysis(id, { tempo: bpm }).catch(() => {});
		};
		const copy = mono.slice();
		w.postMessage({ mono: copy, sampleRate: this.track.sampleRate }, [copy.buffer]);
	}

	/** Remove a track from Recent and storage; unloads it if it is open. */
	async removeRecent(id: string): Promise<void> {
		if (id === this.track.id) this.unload();
		this.recent = await this.store.forget(id).catch(() => this.recent.filter((e) => e.id !== id));
	}

	unload(): void {
		this.openSeq++;
		if (this.transport.playing) this.engine.pause();
		const t = this.track;
		t.id = null;
		t.name = '';
		t.status = 'empty';
		t.length = 0;
		t.buffer = null;
		t.channels = null;
		t.peaks = null;
		t.mono = null;
		t.onsets = null;
		this.loop.start = 0;
		this.loop.end = 0;
		this.loop.on = false;
		this.transport.tempoDetected = null;
		this.transport.tempoOverride = null;
		this.viewport.setLength(0);
		t.analysisVersion++;
	}

	// Persistence

	private snapshotCore(): Omit<Settings, 'updatedAt'> {
		const vp = this.viewport;
		return {
			version: 1,
			sampleRate: this.track.sampleRate,
			loop: { start: this.loop.start, end: this.loop.end, on: this.loop.on },
			speed: this.transport.speed,
			cents: this.transport.cents,
			countIn: this.transport.countIn,
			tempoOverride: this.transport.tempoOverride,
			position: Math.round(this.position()),
			view: vp.isFit ? null : { start: vp.start, fpp: vp.fpp }
		};
	}

	private snapshot(): Settings {
		return { ...this.snapshotCore(), updatedAt: Date.now() };
	}

	/** Debounced (500 ms) save if anything changed. */
	scheduleSave(): void {
		if (!this.track.loaded || !this.track.id) return;
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => this.flushSave(), 500);
	}

	/** Save now if the settings differ from the last save. */
	flushSave(): void {
		clearTimeout(this.saveTimer);
		const id = this.track.id;
		if (!this.track.loaded || !id) return;
		const core = JSON.stringify(this.snapshotCore());
		if (core === this.lastSaved) return;
		this.lastSaved = core;
		this.store.saveSettings(id, this.snapshot()).catch((e) => console.warn('save failed', e));
	}

	/** pagehide: stash synchronously, then attempt the OPFS write. */
	onPageHide(): void {
		const id = this.track.id;
		if (!this.track.loaded || !id) return;
		const s = this.snapshot();
		this.store.stashSettings(id, s);
		this.lastSaved = '';
		this.flushSave();
	}

	/** Start reactive autosave; call once from a component. */
	startAutosave(): () => void {
		const stop = $effect.root(() => {
			$effect(() => {
				void [
					this.track.id,
					this.loop.start,
					this.loop.end,
					this.loop.on,
					this.transport.speed,
					this.transport.cents,
					this.transport.countIn,
					this.transport.tempoOverride,
					this.transport.state
				];
				this.scheduleSave();
			});
		});
		// Position and view are not reactive; poll them cheaply.
		const timer = setInterval(() => {
			if (this.track.loaded && JSON.stringify(this.snapshotCore()) !== this.lastSaved)
				this.scheduleSave();
		}, 1000);
		return () => {
			stop();
			clearInterval(timer);
		};
	}

	// Speed and pitch

	setSpeed(pct: number): void {
		const v = Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, pct)));
		this.transport.speed = v;
		this.engine.setParams(v / 100, this.transport.cents);
	}

	/** , / . : previous / next preset; with Shift, ±1 %. */
	speedStep(dir: -1 | 1, shift: boolean): void {
		if (!this.track.loaded) return;
		const cur = this.transport.speed;
		if (shift) return this.setSpeed(cur + dir);
		const next =
			dir > 0
				? SPEED_PRESETS.find((p) => p > cur)
				: [...SPEED_PRESETS].reverse().find((p) => p < cur);
		if (next !== undefined) this.setSpeed(next);
	}

	setPitch(cents: number): void {
		const v = Math.round(Math.min(PITCH_MAX, Math.max(PITCH_MIN, cents)));
		this.transport.cents = v;
		this.engine.setParams(this.transport.speed / 100, v);
	}

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
		else this.play(this.loop.on && this.loop.exists ? this.loop.start : this.position());
	}

	play(from: number): void {
		if (!this.track.loaded) return;
		this.view.wave.follow = true;
		this.clickAnchor = Math.round(from);
		this.lastClickPos = -1;
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

	/** Source frame on which beat 1 of the visual click falls. */
	private clickAnchor = 0;
	private lastClickPos = -1;

	/**
	 * Count-in beat indicator: lit for 100 ms on each count-in click, then, while playing with
	 * count-in on, on every beat at the track tempo measured from where playback started (or the
	 * loop start after each wrap). Driven by the audible position, so it follows speed changes.
	 */
	private tickBeats(): void {
		const ctx = this.engine.ctx;
		const tr = this.transport;
		let lit = false;
		if (ctx && this.beats.length) {
			const now = ctx.currentTime;
			lit = this.beats.some((t) => now >= t && now < t + 0.1);
			if (now > this.beats[this.beats.length - 1] + 0.1) this.beats = [];
		} else if (ctx && tr.state === 'playing' && tr.countIn && tr.tempo) {
			const sr = this.track.sampleRate;
			const pos = this.position();
			const last = this.lastClickPos;
			const l = this.loop;
			const inLoop = l.on && l.exists && pos >= l.start && pos < l.end;
			// A jump backwards is a loop wrap or seek; a big jump forwards is a seek.
			if (last >= 0 && (pos < last || pos - last > sr * 0.5)) {
				this.clickAnchor = inLoop && pos < last ? l.start : pos;
			}
			const beat = (60 / tr.tempo) * sr;
			const phase = (((pos - this.clickAnchor) % beat) + beat) % beat;
			lit = phase < 0.1 * sr * (tr.speed / 100);
			this.lastClickPos = pos;
		}
		if (tr.state !== 'playing') this.lastClickPos = -1;
		if (lit !== tr.beatLit) tr.beatLit = lit;
	}

	/** Per-frame housekeeping: follow the playhead by paging. Returns the playhead. */
	tick(): number {
		this.tickBeats();
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
