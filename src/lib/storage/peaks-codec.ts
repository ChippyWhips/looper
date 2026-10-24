import type { Peaks } from '../analysis/peaks';

const MAGIC = 0x504b5331; // "PKS1"

/** Binary layout: magic, length, levelCount, then per level: size, count, Float32 data. */
export function encodePeaks(p: Peaks): ArrayBuffer {
	const head = 3 + p.levels.length * 2;
	let floats = 0;
	for (const l of p.levels) floats += l.data.length;
	const buf = new ArrayBuffer(head * 4 + floats * 4);
	const u = new Uint32Array(buf, 0, head);
	u[0] = MAGIC;
	u[1] = p.length;
	u[2] = p.levels.length;
	let off = head * 4;
	p.levels.forEach((l, i) => {
		u[3 + i * 2] = l.size;
		u[4 + i * 2] = l.data.length;
		new Float32Array(buf, off, l.data.length).set(l.data);
		off += l.data.length * 4;
	});
	return buf;
}

export function decodePeaks(buf: ArrayBuffer): Peaks | null {
	if (buf.byteLength < 12) return null;
	const h = new Uint32Array(buf, 0, 3);
	if (h[0] !== MAGIC) return null;
	const n = h[2];
	const head = 3 + n * 2;
	const u = new Uint32Array(buf, 0, head);
	let off = head * 4;
	const levels = [];
	for (let i = 0; i < n; i++) {
		const size = u[3 + i * 2];
		const count = u[4 + i * 2];
		levels.push({ size, data: new Float32Array(buf, off, count) });
		off += count * 4;
	}
	return { length: h[1], levels };
}
