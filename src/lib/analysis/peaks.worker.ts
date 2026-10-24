/// <reference lib="webworker" />
import {
	coarsen,
	computePeaks,
	levelCount,
	levelFromSamples,
	BASE_BUCKET,
	type PcmChannel,
	type PeakLevel
} from './peaks';

/**
 * track: the mix (progressive peaks + mono downmix). stems: peaks per stem.
 * sum: the audible sum of stems (gains applied) as Float32 channels plus its peaks.
 */
export type PeaksRequest =
	| { kind?: 'track'; channels: Float32Array[]; width: number; peaks: boolean }
	| { kind: 'stems'; stems: Int16Array[][]; width: number }
	| { kind: 'sum'; stems: Int16Array[][]; gains: number[]; length: number; width: number };
export type PeaksResponse =
	| { type: 'levels'; levels: PeakLevel[]; final: boolean }
	| { type: 'mono'; mono: Float32Array }
	| { type: 'stems'; levels: PeakLevel[][] }
	| { type: 'sum'; channels: Float32Array[]; levels: PeakLevel[] };

const post = (msg: PeaksResponse, transfer: Transferable[] = []) =>
	(self as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

const buffers = (levels: PeakLevel[]) => levels.map((l) => l.data.buffer);

self.onmessage = (e: MessageEvent<PeaksRequest>) => {
	const m = e.data;
	if (m.kind === 'stems') {
		const out = m.stems.map((ch: PcmChannel[]) => {
			const n = levelCount(ch[0].length, m.width);
			return computePeaks(ch, n).levels;
		});
		post({ type: 'stems', levels: out }, out.flatMap(buffers));
		return;
	}
	if (m.kind === 'sum') {
		const sum = [new Float32Array(m.length), new Float32Array(m.length)];
		m.stems.forEach((ch, k) => {
			const g = m.gains[k] / 32768;
			if (g === 0) return;
			for (let c = 0; c < 2; c++) {
				const src = ch[Math.min(c, ch.length - 1)];
				const dst = sum[c];
				for (let i = 0; i < src.length && i < dst.length; i++) dst[i] += src[i] * g;
			}
		});
		const levels = computePeaks(sum, levelCount(m.length, m.width)).levels;
		post({ type: 'sum', channels: sum, levels }, [...sum.map((c) => c.buffer), ...buffers(levels)]);
		return;
	}
	const { channels, width, peaks } = m;
	const length = channels[0].length;
	const n = levelCount(length, width);
	if (peaks) computeAndPost(channels, n);
	const mono = new Float32Array(length);
	const k = 1 / channels.length;
	for (const ch of channels) for (let i = 0; i < length; i++) mono[i] += ch[i] * k;
	post({ type: 'mono', mono }, [mono.buffer]);
};

function computeAndPost(channels: Float32Array[], n: number): void {
	// Coarsest first, straight from samples, so the overview can draw almost immediately.
	const top = levelFromSamples(channels, BASE_BUCKET * 2 ** (n - 1));
	post({ type: 'levels', levels: [top], final: false });
	const levels: PeakLevel[] = [levelFromSamples(channels, BASE_BUCKET)];
	while (levels.length < n) levels.push(coarsen(levels[levels.length - 1]));
	post(
		{ type: 'levels', levels, final: true },
		levels.map((l) => l.data.buffer)
	);
}
