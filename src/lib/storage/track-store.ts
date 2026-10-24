import type { Peaks } from '../analysis/peaks';
import OpfsWorker from './opfs.worker.ts?worker';
import type { OpfsRequest, OpfsResponse } from './opfs.worker';
import { decodePeaks, encodePeaks } from './peaks-codec';
import { migrate, type Settings } from './settings-schema';
import type { SeparationModel, StemName, StemPcm } from '../separation/types';

export const RECENT_MAX = 3;
const TRACKS = ['tracks'];
const ORIGINAL = 'original';

export interface RecentEntry {
	id: string;
	name: string;
	/** Original file name, for the file type. */
	fileName: string;
	type: string;
	length: number;
	sampleRate: number;
	size: number;
	openedAt: number;
}

export interface StemMeta {
	model: SeparationModel;
	sampleRate: number;
	length: number;
	channels: number;
	stems: { name: StemName; rmsDb: number }[];
}

export interface Analysis {
	tempo: number | null;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type Op = OpfsRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

const PENDING_KEY = (id: string) => `looper:pending:${id}`;

/**
 * Track storage in OPFS, one directory per SHA-256 of the file bytes:
 *   tracks/<hash>/original, peaks.bin, onsets.bin, analysis.json, settings.json, stems/
 * plus recent.json at the root. Every write goes through the OPFS worker.
 */
export class TrackStore {
	private worker: Worker | null = null;
	private seq = 0;
	private pending = new Map<number, Pending>();

	get available(): boolean {
		return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
	}

	private call<T>(op: Op, transfer: Transferable[] = []): Promise<T> {
		if (!this.worker) {
			this.worker = new OpfsWorker();
			this.worker.onmessage = (e: MessageEvent<OpfsResponse>) => {
				const p = this.pending.get(e.data.id);
				if (!p) return;
				this.pending.delete(e.data.id);
				if (e.data.ok) p.resolve(e.data.result);
				else p.reject(new Error(e.data.error));
			};
		}
		const id = ++this.seq;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
			this.worker!.postMessage({ ...op, id } as OpfsRequest, transfer);
		});
	}

	private async writeJson(path: string[], value: unknown): Promise<void> {
		const data = new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;
		await this.call({ op: 'write', path, data }, [data]);
	}

	private async readJson(path: string[]): Promise<unknown> {
		const buf = await this.call<ArrayBuffer | null>({ op: 'read', path });
		if (!buf) return null;
		try {
			return JSON.parse(new TextDecoder().decode(buf));
		} catch {
			return null;
		}
	}

	/** Hash and store the original file; returns its id. */
	async ingest(bytes: ArrayBuffer): Promise<{ id: string; existed: boolean }> {
		const data = bytes.slice(0);
		const r = await this.call<{ hash: string; existed: boolean }>(
			{ op: 'ingest', dir: TRACKS, name: ORIGINAL, data },
			[data]
		);
		return { id: r.hash, existed: r.existed };
	}

	readOriginal(id: string): Promise<ArrayBuffer | null> {
		return this.call({ op: 'read', path: [...TRACKS, id, ORIGINAL] });
	}

	async recent(): Promise<RecentEntry[]> {
		const r = await this.readJson(['recent.json']);
		return Array.isArray(r) ? (r as RecentEntry[]) : [];
	}

	/** Put an entry first; evict anything beyond RECENT_MAX with all its data. */
	async touch(entry: RecentEntry): Promise<RecentEntry[]> {
		const list = (await this.recent()).filter((e) => e.id !== entry.id);
		list.unshift(entry);
		const keep = list.slice(0, RECENT_MAX);
		for (const gone of list.slice(RECENT_MAX)) await this.removeTrack(gone.id);
		await this.writeJson(['recent.json'], keep);
		return keep;
	}

	async forget(id: string): Promise<RecentEntry[]> {
		const list = (await this.recent()).filter((e) => e.id !== id);
		await this.removeTrack(id);
		await this.writeJson(['recent.json'], list);
		return list;
	}

	private async removeTrack(id: string): Promise<void> {
		await this.call({ op: 'remove', path: [...TRACKS, id] });
		try {
			localStorage.removeItem(PENDING_KEY(id));
		} catch {
			// Storage blocked.
		}
	}

	listTracks(): Promise<string[]> {
		return this.call({ op: 'list', path: TRACKS });
	}

	listTrack(id: string): Promise<string[]> {
		return this.call({ op: 'list', path: [...TRACKS, id] });
	}

	/** Raw settings.json text, for inspection. */
	async rawSettings(id: string): Promise<string | null> {
		const buf = await this.call<ArrayBuffer | null>({
			op: 'read',
			path: [...TRACKS, id, 'settings.json']
		});
		return buf ? new TextDecoder().decode(buf) : null;
	}

	async loadSettings(id: string): Promise<Settings | null> {
		const stored = migrate(await this.readJson([...TRACKS, id, 'settings.json']));
		let pending: Settings | null;
		try {
			const raw = localStorage.getItem(PENDING_KEY(id));
			pending = raw ? migrate(JSON.parse(raw)) : null;
		} catch {
			pending = null;
		}
		if (pending && (!stored || pending.updatedAt > stored.updatedAt)) {
			await this.saveSettings(id, pending);
			return pending;
		}
		return stored;
	}

	async saveSettings(id: string, s: Settings): Promise<void> {
		await this.writeJson([...TRACKS, id, 'settings.json'], s);
		try {
			localStorage.removeItem(PENDING_KEY(id));
		} catch {
			// Storage blocked.
		}
	}

	/**
	 * pagehide fallback: a worker write may not finish while the page unloads, so the latest
	 * settings are also kept synchronously and moved into OPFS on the next launch.
	 */
	stashSettings(id: string, s: Settings): void {
		try {
			localStorage.setItem(PENDING_KEY(id), JSON.stringify(s));
		} catch {
			// Storage blocked.
		}
	}

	async loadPeaks(id: string): Promise<Peaks | null> {
		const buf = await this.call<ArrayBuffer | null>({
			op: 'read',
			path: [...TRACKS, id, 'peaks.bin']
		});
		return buf ? decodePeaks(buf) : null;
	}

	async savePeaks(id: string, p: Peaks): Promise<void> {
		const data = encodePeaks(p);
		await this.call({ op: 'write', path: [...TRACKS, id, 'peaks.bin'], data }, [data]);
	}

	async loadOnsets(id: string): Promise<Int32Array | null> {
		const buf = await this.call<ArrayBuffer | null>({
			op: 'read',
			path: [...TRACKS, id, 'onsets.bin']
		});
		return buf ? new Int32Array(buf) : null;
	}

	async saveOnsets(id: string, onsets: Int32Array): Promise<void> {
		const data = onsets.slice().buffer;
		await this.call({ op: 'write', path: [...TRACKS, id, 'onsets.bin'], data }, [data]);
	}

	async loadAnalysis(id: string): Promise<Analysis | null> {
		const r = (await this.readJson([...TRACKS, id, 'analysis.json'])) as Analysis | null;
		return r && (r.tempo === null || typeof r.tempo === 'number') ? r : null;
	}

	saveAnalysis(id: string, a: Analysis): Promise<void> {
		return this.writeJson([...TRACKS, id, 'analysis.json'], a);
	}

	// Stems: tracks/<id>/stems/meta.json, <name>.pcm (planar 16-bit), <name>.peaks

	async saveStems(
		id: string,
		meta: StemMeta,
		stems: StemPcm[],
		peaks: Map<StemName, Peaks>
	): Promise<void> {
		await this.clearStems(id);
		for (const s of stems) {
			const len = s.channels[0].length;
			const data = new ArrayBuffer(len * 2 * s.channels.length);
			s.channels.forEach((c, i) => new Int16Array(data, i * len * 2, len).set(c));
			await this.call({ op: 'write', path: [...TRACKS, id, 'stems', `${s.name}.pcm`], data }, [
				data
			]);
			const p = peaks.get(s.name);
			if (p) {
				const pd = encodePeaks(p);
				await this.call(
					{ op: 'write', path: [...TRACKS, id, 'stems', `${s.name}.peaks`], data: pd },
					[pd]
				);
			}
		}
		// Written last, so a half-written set is never treated as complete.
		await this.writeJson([...TRACKS, id, 'stems', 'meta.json'], meta);
	}

	async loadStemMeta(id: string): Promise<StemMeta | null> {
		const m = (await this.readJson([...TRACKS, id, 'stems', 'meta.json'])) as StemMeta | null;
		return m && Array.isArray(m.stems) ? m : null;
	}

	async loadStemPcm(id: string, name: StemName, meta: StemMeta): Promise<Int16Array[] | null> {
		const buf = await this.call<ArrayBuffer | null>({
			op: 'read',
			path: [...TRACKS, id, 'stems', `${name}.pcm`]
		});
		if (!buf || buf.byteLength !== meta.length * 2 * meta.channels) return null;
		return Array.from(
			{ length: meta.channels },
			(_, i) => new Int16Array(buf, i * meta.length * 2, meta.length)
		);
	}

	async loadStemPeaks(id: string, name: StemName): Promise<Peaks | null> {
		const buf = await this.call<ArrayBuffer | null>({
			op: 'read',
			path: [...TRACKS, id, 'stems', `${name}.peaks`]
		});
		return buf ? decodePeaks(buf) : null;
	}

	/** Remove all stems, keeping the reserved directory. */
	async clearStems(id: string): Promise<void> {
		await this.call({ op: 'remove', path: [...TRACKS, id, 'stems'] });
		await this.call({ op: 'mkdir', path: [...TRACKS, id, 'stems'] });
	}
}
