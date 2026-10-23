// Generates deterministic audio fixtures into static/fixtures/.
// Usage: npx tsx scripts/make-fixtures.ts [--force]
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Mp3Encoder } from '@breezystack/lamejs';

const OUT = join(import.meta.dirname, '..', 'static', 'fixtures');
const RATES = [44100, 48000] as const;
const force = process.argv.includes('--force');

type Channels = [Float32Array, Float32Array];

/** Click track: decaying 1.5 kHz cosine bursts, so each onset is its first, loudest sample. */
export const CLICK_BPM = 120;
export const CLICK_SECONDS = 30;

function stereo(frames: number, fn: (i: number, sr: number) => number, sr: number): Channels {
	const l = new Float32Array(frames);
	for (let i = 0; i < frames; i++) l[i] = fn(i, sr);
	return [l, l.slice()];
}

function click(sr: number): Channels {
	const frames = CLICK_SECONDS * sr;
	const l = new Float32Array(frames);
	const beat = (60 / CLICK_BPM) * sr;
	const len = Math.round(0.03 * sr);
	for (let b = 0; b * beat < frames; b++) {
		const start = Math.round(b * beat);
		for (let i = 0; i < len && start + i < frames; i++) {
			l[start + i] = 0.8 * Math.cos((2 * Math.PI * 1500 * i) / sr) * Math.exp(-i / (0.004 * sr));
		}
	}
	return [l, l.slice()];
}

function logSweep(sr: number): Channels {
	const seconds = 10;
	const f0 = 20;
	const f1 = 20000;
	const k = Math.log(f1 / f0);
	return stereo(
		seconds * sr,
		(i) => {
			const t = i / sr;
			return 0.5 * Math.sin(((2 * Math.PI * f0 * seconds) / k) * (Math.exp((t / seconds) * k) - 1));
		},
		sr
	);
}

/** Seeded PRNG so fixtures are byte-identical across runs. */
function rng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

/** 5-minute 120 BPM "song": kick, hats, a chord per bar and a slow noise pad. */
function song(sr: number): Channels {
	const seconds = 300;
	const frames = seconds * sr;
	const l = new Float32Array(frames);
	const r = new Float32Array(frames);
	const rand = rng(42);
	const beat = (60 / 120) * sr;
	const chords = [
		[220, 277.18, 329.63],
		[196, 246.94, 293.66],
		[174.61, 220, 261.63],
		[164.81, 207.65, 246.94]
	];
	for (let i = 0; i < frames; i++) {
		const t = i / sr;
		const bar = Math.floor(i / (beat * 4));
		const chord = chords[bar % chords.length];
		let v = 0;
		for (const f of chord) v += 0.06 * Math.sin(2 * Math.PI * f * t);
		const inBeat = i % beat;
		const kt = inBeat / sr;
		v += 0.45 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-kt * 30)) * kt) * Math.exp(-kt * 12);
		const inEighth = i % (beat / 2);
		const noise = rand() * 2 - 1;
		v += 0.12 * noise * Math.exp(-(inEighth / sr) * 60);
		const pad = 0.02 * noise * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.05 * t));
		l[i] = v + pad;
		r[i] = v - pad;
	}
	return [l, r];
}

function wav(ch: Channels, sr: number): Buffer {
	const frames = ch[0].length;
	const nCh = 2;
	const bytes = frames * nCh * 2;
	const b = Buffer.alloc(44 + bytes);
	b.write('RIFF', 0);
	b.writeUInt32LE(36 + bytes, 4);
	b.write('WAVE', 8);
	b.write('fmt ', 12);
	b.writeUInt32LE(16, 16);
	b.writeUInt16LE(1, 20);
	b.writeUInt16LE(nCh, 22);
	b.writeUInt32LE(sr, 24);
	b.writeUInt32LE(sr * nCh * 2, 28);
	b.writeUInt16LE(nCh * 2, 32);
	b.writeUInt16LE(16, 34);
	b.write('data', 36);
	b.writeUInt32LE(bytes, 40);
	let o = 44;
	for (let i = 0; i < frames; i++) {
		for (let c = 0; c < nCh; c++) {
			const s = Math.max(-1, Math.min(1, ch[c][i]));
			b.writeInt16LE(Math.round(s * 32767), o);
			o += 2;
		}
	}
	return b;
}

function toInt16(f: Float32Array): Int16Array {
	const out = new Int16Array(f.length);
	for (let i = 0; i < f.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, f[i])) * 32767);
	return out;
}

function mp3(ch: Channels, sr: number): Buffer {
	const enc = new Mp3Encoder(2, sr, 192);
	const l = toInt16(ch[0]);
	const r = toInt16(ch[1]);
	const parts: Uint8Array[] = [];
	const block = 1152 * 16;
	for (let i = 0; i < l.length; i += block) {
		parts.push(enc.encodeBuffer(l.subarray(i, i + block), r.subarray(i, i + block)));
	}
	parts.push(enc.flush());
	return Buffer.concat(parts.map((p) => new Uint8Array(p.buffer, p.byteOffset, p.byteLength)));
}

const fixtures: Record<string, (sr: number) => Channels> = {
	'click-120': click,
	'sine-440': (sr) => stereo(10 * sr, (i, s) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / s), sr),
	'sine-1k': (sr) => stereo(10 * sr, (i, s) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / s), sr),
	sweep: logSweep,
	silence: (sr) => stereo(5 * sr, () => 0, sr),
	'dc-sine': (sr) =>
		stereo(5 * sr, (i, s) => 0.3 + 0.4 * Math.sin((2 * Math.PI * 440 * i) / s), sr),
	song
};

mkdirSync(OUT, { recursive: true });
for (const sr of RATES) {
	for (const [name, gen] of Object.entries(fixtures)) {
		const file = join(OUT, `${name}-${sr}.wav`);
		const mp3File = join(OUT, `${name}-${sr}.mp3`);
		const wantMp3 = name === 'song';
		if (!force && existsSync(file) && (!wantMp3 || existsSync(mp3File))) continue;
		const ch = gen(sr);
		writeFileSync(file, wav(ch, sr));
		if (wantMp3) writeFileSync(mp3File, mp3(ch, sr));
		console.log('wrote', file);
	}
}
