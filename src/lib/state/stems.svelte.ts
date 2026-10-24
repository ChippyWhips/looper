import type { PeakLevel } from '../analysis/peaks';
import PeaksWorker from '../analysis/peaks.worker.ts?worker';
import type { PeaksRequest, PeaksResponse } from '../analysis/peaks.worker';
import { resolveTargets, type SourceState } from '../audio/sources';
import { startJob } from '../separation/null-separator';
import {
	createSeparator,
	DEFAULT_MODEL,
	EMPTY_STEM_DB,
	FINE_MODEL,
	STEM_ORDER,
	type SeparationJob,
	type SeparationModel,
	type Separator,
	type StemName,
	type StemSet
} from '../separation';
import type { StemsSettings } from '../storage/settings-schema';
import type { StemMeta } from '../storage/track-store';
import type { App } from './app.svelte';

export type StemsStatus = 'none' | 'running' | 'done' | 'stopped' | 'failed' | 'unavailable';

export interface Lane {
	name: StemName;
	label: string;
	rmsDb: number;
	muted: boolean;
	soloed: boolean;
	/** Peak levels (plain data, not reactive). */
	levels: PeakLevel[];
}

const LABELS: Record<StemName, string> = {
	vocals: 'Vocals',
	guitar: 'Guitar',
	bass: 'Bass',
	drums: 'Drums',
	piano: 'Piano',
	other: 'Other'
};

const sourceId = (n: StemName) => `stem:${n}`;

function runPeaks<T extends PeaksResponse['type']>(
	req: PeaksRequest,
	type: T,
	transfer: Transferable[]
): Promise<Extract<PeaksResponse, { type: T }>> {
	const w = new PeaksWorker();
	return new Promise((resolve, reject) => {
		w.onmessage = (e: MessageEvent<PeaksResponse>) => {
			if (e.data.type !== type) return;
			w.terminate();
			resolve(e.data as Extract<PeaksResponse, { type: T }>);
		};
		w.onerror = (e) => {
			w.terminate();
			reject(new Error(e.message));
		};
		w.postMessage(req, transfer);
	});
}

/**
 * Stem separation for the open track: one background job at a time, stored stems restored on
 * open, lanes with mute/solo, and the main waveform kept in step with what is audible.
 */
export class StemsController {
	status = $state<StemsStatus>('none');
	fraction = $state(0);
	slow = $state(false);
	/** Replaced, never mutated in place (raw, so peak data is not proxied). */
	lanes = $state.raw<Lane[]>([]);
	/** Lanes expanded (top bar `Stems` toggle). */
	open = $state(true);
	model = $state<SeparationModel | null>(null);
	/** Bumped when lane peaks change, for canvas redraws. */
	version = $state(0);

	private separator: Separator;
	private job: SeparationJob | null = null;
	private seq = 0;
	private meta: StemMeta | null = null;
	private audibleSeq = 0;
	private app: App;

	constructor(app: App, separator: Separator = createSeparator()) {
		this.app = app;
		this.separator = separator;
	}

	get running(): boolean {
		return this.status === 'running';
	}

	get hasLanes(): boolean {
		return this.lanes.length > 0;
	}

	/** Settings fragment for settings.json (absent until stems exist). */
	settings(): StemsSettings | undefined {
		if (!this.model || !this.meta) return undefined;
		return {
			model: this.model,
			names: this.meta.stems.map((s) => s.name),
			muted: this.lanes.filter((l) => l.muted).map((l) => l.name),
			soloed: this.lanes.filter((l) => l.soloed).map((l) => l.name)
		};
	}

	/** Cancel the running job without changing what the UI shows (used when switching tracks). */
	cancel(): void {
		this.job?.cancel();
		this.job = null;
	}

	/** A track became ready (or was unloaded when id is null). */
	async attach(id: string | null, saved?: StemsSettings): Promise<void> {
		this.cancel();
		const seq = ++this.seq;
		this.status = 'none';
		this.fraction = 0;
		this.lanes = [];
		this.model = null;
		this.meta = null;
		this.clearAudible();
		if (!id) return;
		const meta = await this.app.store.loadStemMeta(id).catch(() => null);
		if (seq !== this.seq) return;
		if (meta && meta.length === this.app.track.length) {
			await this.restore(id, meta, saved, seq);
			return;
		}
		if ((await this.separator.availability()) === 'unavailable') {
			if (seq === this.seq) this.status = 'unavailable';
			return;
		}
		if (seq === this.seq) this.start(DEFAULT_MODEL);
	}

	/** Start (or restart) separation of the open track. */
	start(model: SeparationModel = DEFAULT_MODEL): void {
		const t = this.app.track;
		if (!t.loaded || !t.channels || !t.id) return;
		this.cancel();
		const seq = this.seq;
		const id = t.id;
		this.status = 'running';
		this.fraction = 0;
		this.slow = false;
		const input = {
			trackId: id,
			sampleRate: t.sampleRate,
			channels: t.channels.map((c) => c.slice())
		};
		const job = startJob(this.separator, input, model, (p) => {
			if (seq !== this.seq || this.job !== job) return;
			this.fraction = p.fraction;
			this.slow = p.slow;
		});
		this.job = job;
		job.result.then(
			(set) => {
				if (seq === this.seq && this.job === job) void this.install(id, set, seq);
			},
			() => {
				if (seq !== this.seq || this.job !== job) return;
				this.status = job.status === 'stopped' ? 'stopped' : 'failed';
				this.job = null;
			}
		);
	}

	/** Stop: cancel and offer `Separate`. */
	stop(): void {
		if (!this.running) return;
		this.cancel();
		this.status = 'stopped';
	}

	reseparateFine(): void {
		this.start(FINE_MODEL);
	}

	private async install(id: string, set: StemSet, seq: number): Promise<void> {
		const ordered = [...set.stems].sort(
			(a, b) => STEM_ORDER.indexOf(a.name) - STEM_ORDER.indexOf(b.name)
		);
		const width = Math.max(1280, this.app.viewport.width);
		const copies = ordered.map((s) => s.channels.map((c) => c.slice()));
		const { levels } = await runPeaks(
			{ kind: 'stems', stems: copies, width },
			'stems',
			copies.flat().map((c) => c.buffer)
		);
		if (seq !== this.seq) return;
		const meta: StemMeta = {
			model: set.model,
			sampleRate: set.sampleRate,
			length: set.length,
			channels: 2,
			stems: ordered.map((s) => ({ name: s.name, rmsDb: s.rmsDb }))
		};
		const peaks = new Map(
			ordered.map((s, i) => [s.name, { length: set.length, levels: levels[i] }])
		);
		await this.app.store
			.saveStems(id, meta, ordered, peaks)
			.catch((e) => console.warn('stems save', e));
		if (seq !== this.seq) return;
		this.removeSources();
		this.meta = meta;
		this.model = set.model;
		const audible = ordered.filter((s) => s.rmsDb >= EMPTY_STEM_DB);
		this.app.engine.addSources(
			audible.map((s) => ({
				id: sourceId(s.name),
				kind: 'stem',
				label: LABELS[s.name],
				channels: s.channels,
				gain: 1,
				muted: false,
				soloed: false
			}))
		);
		this.lanes = audible.map((s) => ({
			name: s.name,
			label: LABELS[s.name],
			rmsDb: s.rmsDb,
			muted: false,
			soloed: false,
			levels: levels[ordered.indexOf(s)]
		}));
		this.clearAudible();
		this.version++;
		this.status = 'done';
		this.job = null;
		this.app.scheduleSave();
	}

	private async restore(
		id: string,
		meta: StemMeta,
		saved: StemsSettings | undefined,
		seq: number
	): Promise<void> {
		const lanes: Lane[] = [];
		const sources = [];
		for (const s of meta.stems) {
			if (s.rmsDb < EMPTY_STEM_DB) continue;
			const pcm = await this.app.store.loadStemPcm(id, s.name, meta).catch(() => null);
			if (!pcm) continue;
			let levels = (await this.app.store.loadStemPeaks(id, s.name).catch(() => null))?.levels;
			if (!levels) {
				const copy = pcm.map((c) => c.slice());
				levels = (
					await runPeaks(
						{ kind: 'stems', stems: [copy], width: Math.max(1280, this.app.viewport.width) },
						'stems',
						copy.map((c) => c.buffer)
					)
				).levels[0];
			}
			if (seq !== this.seq) return;
			lanes.push({
				name: s.name,
				label: LABELS[s.name],
				rmsDb: s.rmsDb,
				muted: saved?.muted.includes(s.name) ?? false,
				soloed: saved?.soloed.includes(s.name) ?? false,
				levels
			});
			sources.push({
				id: sourceId(s.name),
				kind: 'stem' as const,
				label: LABELS[s.name],
				channels: pcm,
				gain: 1,
				muted: false,
				soloed: false
			});
		}
		if (seq !== this.seq) return;
		this.meta = meta;
		this.model = meta.model;
		this.app.engine.addSources(sources);
		this.lanes = lanes;
		this.status = lanes.length ? 'done' : 'none';
		this.version++;
		this.sync();
	}

	private removeSources(): void {
		if (this.lanes.length) this.app.engine.removeSources(this.lanes.map((l) => sourceId(l.name)));
	}

	toggleMute(name: StemName): void {
		this.lanes = this.lanes.map((l) => (l.name === name ? { ...l, muted: !l.muted } : l));
		this.sync();
	}

	toggleSolo(name: StemName): void {
		this.lanes = this.lanes.map((l) => (l.name === name ? { ...l, soloed: !l.soloed } : l));
		this.sync();
	}

	private states(): SourceState[] {
		return this.lanes.map((l) => ({
			id: sourceId(l.name),
			kind: 'stem',
			label: l.label,
			gain: 1,
			muted: l.muted,
			soloed: l.soloed
		}));
	}

	/** Lanes whose audio is in the current output. */
	audibleNames(): Set<StemName> {
		const targets = resolveTargets([
			{ id: 'mix', kind: 'mix', label: 'Mix', gain: 1, muted: false, soloed: false },
			...this.states()
		]);
		if ((targets.get('mix') ?? 0) > 0) return new Set(this.lanes.map((l) => l.name));
		return new Set(
			this.lanes.filter((l) => (targets.get(sourceId(l.name)) ?? 0) > 0).map((l) => l.name)
		);
	}

	/** Push mute/solo to the engine and refresh the audible waveform. */
	private sync(): void {
		this.app.engine.setSources(this.states());
		this.app.scheduleSave();
		void this.refreshAudible();
	}

	private clearAudible(): void {
		this.audibleSeq++;
		const t = this.app.track;
		if (t.audiblePeaks || t.audibleChannels) {
			t.audiblePeaks = null;
			t.audibleChannels = null;
			t.analysisVersion++;
		}
	}

	/** Main waveform = mix when nothing is muted or soloed, else the sum of the active stems. */
	private async refreshAudible(): Promise<void> {
		const anyChange = this.lanes.some((l) => l.muted || l.soloed);
		if (!anyChange) return this.clearAudible();
		const seq = ++this.audibleSeq;
		const id = this.app.track.id;
		const meta = this.meta;
		if (!id || !meta) return;
		const active = this.audibleNames();
		const stems: Int16Array[][] = [];
		for (const l of this.lanes) {
			if (!active.has(l.name)) continue;
			const pcm = await this.app.store.loadStemPcm(id, l.name, meta).catch(() => null);
			if (pcm) stems.push(pcm);
		}
		if (seq !== this.audibleSeq) return;
		const r = await runPeaks(
			{
				kind: 'sum',
				stems,
				gains: stems.map(() => 1),
				length: meta.length,
				width: Math.max(1280, this.app.viewport.width)
			},
			'sum',
			[...new Set(stems.flat().map((c) => c.buffer))]
		);
		if (seq !== this.audibleSeq) return;
		const t = this.app.track;
		t.audiblePeaks = r.levels;
		t.audibleChannels = r.channels;
		t.analysisVersion++;
	}
}
