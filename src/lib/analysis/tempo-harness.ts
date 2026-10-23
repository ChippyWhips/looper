import TempoWorker from './tempo.worker.ts?worker';
import type { TempoResponse } from './tempo.worker';

/** Run tempo detection on a fixture URL (used by Playwright). */
export async function detectTempo(url: string): Promise<TempoResponse & { ms: number }> {
	const bytes = await (await fetch(url)).arrayBuffer();
	const ctx = new OfflineAudioContext(1, 1, 44100);
	const buf = await ctx.decodeAudioData(bytes);
	const mono = buf.getChannelData(0).slice();
	const t0 = performance.now();
	const w = new TempoWorker();
	const r = await new Promise<TempoResponse>((resolve) => {
		w.onmessage = (e: MessageEvent<TempoResponse>) => resolve(e.data);
		w.onerror = (e) => resolve({ bpm: null, method: 'worker', error: e.message });
		w.postMessage({ mono, sampleRate: buf.sampleRate }, [mono.buffer]);
	});
	w.terminate();
	return { ...r, ms: performance.now() - t0 };
}
