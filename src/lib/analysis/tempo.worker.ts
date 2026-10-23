/// <reference lib="webworker" />
import { foldTempo, resampleLinear } from './tempo';

export type TempoRequest = { mono: Float32Array; sampleRate: number };
export type TempoResponse = { bpm: number | null; method: string; error?: string };

const ESSENTIA_RATE = 44100;
const MAX_SECONDS = 120;

type EssentiaVector = { delete?: () => void };
interface EssentiaLike {
	arrayToVector(a: Float32Array): EssentiaVector;
	RhythmExtractor2013(
		signal: EssentiaVector,
		maxTempo?: number,
		method?: string,
		minTempo?: number
	): { bpm: number; confidence: number };
}

async function essentiaTempo(mono: Float32Array, sampleRate: number): Promise<number> {
	const [{ EssentiaWASM }, core] = await Promise.all([
		import('essentia.js/dist/essentia-wasm.es.js'),
		import('essentia.js/dist/essentia.js-core.es.js')
	]);
	const Essentia = core.default as unknown as new (wasm: unknown) => EssentiaLike;
	const wasm = await ready(EssentiaWASM);
	const e = new Essentia(wasm);
	const x = resampleLinear(mono, sampleRate, ESSENTIA_RATE);
	const seg = x.subarray(0, Math.min(x.length, MAX_SECONDS * ESSENTIA_RATE));
	const v = e.arrayToVector(seg);
	const r = e.RhythmExtractor2013(v, 208, 'multifeature', 40);
	v.delete?.();
	return r.bpm;
}

/** The Emscripten module runs on import; wait for its runtime if it is not ready yet. */
function ready(mod: unknown): Promise<unknown> {
	const m = mod as { calledRun?: boolean; onRuntimeInitialized?: () => void };
	if (m.calledRun) return Promise.resolve(m);
	return new Promise((resolve) => {
		const prev = m.onRuntimeInitialized;
		m.onRuntimeInitialized = () => {
			prev?.();
			resolve(m);
		};
	});
}

self.onmessage = async (e: MessageEvent<TempoRequest>) => {
	const post = (r: TempoResponse) => (self as DedicatedWorkerGlobalScope).postMessage(r);
	try {
		const bpm = foldTempo(await essentiaTempo(e.data.mono, e.data.sampleRate));
		post({ bpm: Number.isFinite(bpm) ? bpm : null, method: 'essentia' });
	} catch (err) {
		post({ bpm: null, method: 'essentia', error: String(err) });
	}
};
