import OpfsWorker from './opfs.worker.ts?worker';
import type { OpfsRequest, OpfsResponse } from './opfs.worker';

/** A storage operation, as the OPFS worker defines them (minus the request id). */
export type StoreOp = OpfsRequest extends infer R
	? R extends { id: number }
		? Omit<R, 'id'>
		: never
	: never;

/** Where `TrackStore` keeps files: OPFS in the browser, the app data directory on desktop. */
export interface StoreBackend {
	readonly available: boolean;
	call<T>(op: StoreOp, transfer?: Transferable[]): Promise<T>;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** OPFS through a worker using synchronous access handles (required by Safari). */
export class OpfsBackend implements StoreBackend {
	private worker: Worker | null = null;
	private seq = 0;
	private pending = new Map<number, Pending>();

	get available(): boolean {
		return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
	}

	call<T>(op: StoreOp, transfer: Transferable[] = []): Promise<T> {
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
}

/** Native file system through Tauri commands (`src-tauri/src/store.rs`); binary bodies, no JSON. */
export class NativeBackend implements StoreBackend {
	readonly available = true;

	async call<T>(op: StoreOp): Promise<T> {
		const { invoke } = await import('@tauri-apps/api/core');
		const headers = (path: string[]) => ({ headers: { 'x-path': JSON.stringify(path) } });
		switch (op.op) {
			case 'write':
				await invoke('store_write', new Uint8Array(op.data), headers(op.path));
				return null as T;
			case 'read':
				try {
					return (await invoke<ArrayBuffer>('store_read', { path: op.path })) as T;
				} catch (e) {
					if (String(e).includes('NotFound')) return null as T;
					throw e;
				}
			case 'remove':
				await invoke('store_remove', { path: op.path });
				return null as T;
			case 'mkdir':
				await invoke('store_mkdir', { path: op.path });
				return null as T;
			case 'list':
				return (await invoke<string[]>('store_list', { path: op.path })) as T;
			case 'ingest':
				return (await invoke(
					'store_ingest',
					new Uint8Array(op.data),
					headers([...op.dir, op.name])
				)) as T;
		}
	}
}

/** Desktop build: native files. Browser: OPFS. */
export function defaultBackend(): StoreBackend {
	return __DESKTOP__ ? new NativeBackend() : new OpfsBackend();
}
