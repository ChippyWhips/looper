import { abortError, type ModelStore, type SeparationModel } from '../types';
import { MODEL_FILES } from './models';

const CACHE = 'looper-models-v1';

/** Downloads weights once and keeps them in Cache Storage (not OPFS, which only the track store uses). */
export class CacheModelStore implements ModelStore {
	async get(model: SeparationModel): Promise<Uint8Array | null> {
		const c = await caches.open(CACHE);
		const r = await c.match(MODEL_FILES[model].url);
		return r ? new Uint8Array(await r.arrayBuffer()) : null;
	}

	async load(
		model: SeparationModel,
		onProgress: (fraction: number) => void,
		signal: AbortSignal
	): Promise<Uint8Array> {
		const cached = await this.get(model);
		if (cached) {
			onProgress(1);
			return cached;
		}
		const { url, sizeMb } = MODEL_FILES[model];
		const res = await fetch(url, { signal });
		if (!res.ok || !res.body) throw new Error(`Model download failed (${res.status})`);
		const total = Number(res.headers.get('content-length')) || sizeMb * 1024 * 1024;
		const reader = res.body.getReader();
		const parts: Uint8Array[] = [];
		let got = 0;
		for (;;) {
			if (signal.aborted) throw abortError();
			const { done, value } = await reader.read();
			if (done) break;
			parts.push(value);
			got += value.length;
			onProgress(Math.min(1, got / total));
		}
		const bytes = new Uint8Array(got);
		let o = 0;
		for (const p of parts) {
			bytes.set(p, o);
			o += p.length;
		}
		const c = await caches.open(CACHE);
		await c.put(
			url,
			new Response(bytes.slice(), { headers: { 'content-type': 'application/octet-stream' } })
		);
		return bytes;
	}
}
