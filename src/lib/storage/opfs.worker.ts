/// <reference lib="webworker" />
import { sha256Hex } from './hash';

/** All OPFS writes happen here, through synchronous access handles (required by Safari). */

export type OpfsRequest =
	| { id: number; op: 'write'; path: string[]; data: ArrayBuffer }
	| { id: number; op: 'read'; path: string[] }
	| { id: number; op: 'remove'; path: string[] }
	| { id: number; op: 'mkdir'; path: string[] }
	| { id: number; op: 'list'; path: string[] }
	| { id: number; op: 'ingest'; dir: string[]; name: string; data: ArrayBuffer };

export type OpfsResponse =
	{ id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

const ROOT = 'looper';

async function dir(path: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
	let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create: true });
	for (const p of path) d = await d.getDirectoryHandle(p, { create });
	return d;
}

async function write(path: string[], data: ArrayBuffer): Promise<void> {
	const d = await dir(path.slice(0, -1), true);
	const fh = await d.getFileHandle(path[path.length - 1], { create: true });
	const h = await fh.createSyncAccessHandle();
	try {
		h.truncate(0);
		let off = 0;
		const u8 = new Uint8Array(data);
		while (off < u8.length) off += h.write(u8.subarray(off), { at: off });
		h.flush();
	} finally {
		h.close();
	}
}

async function read(path: string[]): Promise<ArrayBuffer | null> {
	try {
		const d = await dir(path.slice(0, -1), false);
		const fh = await d.getFileHandle(path[path.length - 1]);
		const h = await fh.createSyncAccessHandle();
		try {
			const size = h.getSize();
			const buf = new ArrayBuffer(size);
			h.read(new Uint8Array(buf), { at: 0 });
			return buf;
		} finally {
			h.close();
		}
	} catch {
		return null;
	}
}

async function remove(path: string[]): Promise<void> {
	try {
		const d = await dir(path.slice(0, -1), false);
		await d.removeEntry(path[path.length - 1], { recursive: true });
	} catch {
		// Already gone.
	}
}

async function list(path: string[]): Promise<string[]> {
	try {
		const d = await dir(path, false);
		const out: string[] = [];
		for await (const name of (d as unknown as { keys(): AsyncIterable<string> }).keys())
			out.push(name);
		return out;
	} catch {
		return [];
	}
}

/** Hash the bytes and store them under dir/<hash>/name unless already present. */
async function ingest(
	base: string[],
	name: string,
	data: ArrayBuffer
): Promise<{ hash: string; existed: boolean }> {
	const hash = await sha256Hex(data);
	const existed = (await read([...base, hash, name])) !== null;
	if (!existed) {
		await write([...base, hash, name], data);
		await dir([...base, hash, 'stems'], true);
	}
	return { hash, existed };
}

let chain: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<OpfsRequest>) => {
	const m = e.data;
	const post = (r: OpfsResponse, t: Transferable[] = []) =>
		(self as DedicatedWorkerGlobalScope).postMessage(r, t);
	// Serialise operations: sync access handles are exclusive per file.
	chain = chain.then(async () => {
		try {
			let result: unknown = null;
			const transfer: Transferable[] = [];
			switch (m.op) {
				case 'write':
					await write(m.path, m.data);
					break;
				case 'read': {
					const buf = await read(m.path);
					if (buf) transfer.push(buf);
					result = buf;
					break;
				}
				case 'remove':
					await remove(m.path);
					break;
				case 'mkdir':
					await dir(m.path, true);
					break;
				case 'list':
					result = await list(m.path);
					break;
				case 'ingest':
					result = await ingest(m.dir, m.name, m.data);
					break;
			}
			post({ id: m.id, ok: true, result }, transfer);
		} catch (err) {
			post({ id: m.id, ok: false, error: String(err) });
		}
	});
};
