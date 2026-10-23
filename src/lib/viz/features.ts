export interface Features {
	low: number;
	mid: number;
	high: number;
	rms: number;
}

export const BANDS = {
	low: [20, 250],
	mid: [250, 2000],
	high: [2000, 12000]
} as const;

/** Mean linear power in [lo, hi) Hz from analyser dB magnitudes. */
export function bandPower(db: Float32Array, sampleRate: number, lo: number, hi: number): number {
	const binHz = sampleRate / 2 / db.length;
	const a = Math.max(0, Math.floor(lo / binHz));
	const b = Math.min(db.length, Math.ceil(hi / binHz));
	let s = 0;
	for (let i = a; i < b; i++) s += Math.pow(10, db[i] / 10);
	return b > a ? s / (b - a) : 0;
}

/** RMS of time-domain samples. */
export function rms(x: Float32Array): number {
	let s = 0;
	for (let i = 0; i < x.length; i++) s += x[i] * x[i];
	return Math.sqrt(s / Math.max(1, x.length));
}

/** Map power to 0..1 on a dB scale between floor and ceiling. */
export function level(power: number, floorDb: number, ceilDb: number): number {
	const db = 10 * Math.log10(power + 1e-12);
	return Math.min(1, Math.max(0, (db - floorDb) / (ceilDb - floorDb)));
}

/** One-pole envelope with separate attack and release time constants. */
export class Envelope {
	value = 0;
	constructor(
		private attackMs = 40,
		private releaseMs = 300
	) {}

	step(target: number, dtMs: number): number {
		const tau = target > this.value ? this.attackMs : this.releaseMs;
		const k = 1 - Math.exp(-dtMs / tau);
		this.value += (target - this.value) * k;
		return this.value;
	}
}

/** Smoothed band features from an AnalyserNode-like source. */
export class FeatureTracker {
	private env = {
		low: new Envelope(),
		mid: new Envelope(),
		high: new Envelope(),
		rms: new Envelope()
	};
	private freq: Float32Array<ArrayBuffer> | null = null;
	private time: Float32Array<ArrayBuffer> | null = null;
	readonly out: Features = { low: 0, mid: 0, high: 0, rms: 0 };

	update(
		analyser: AnalyserNode | null,
		sampleRate: number,
		dtMs: number,
		active: boolean
	): Features {
		let low = 0;
		let mid = 0;
		let high = 0;
		let r = 0;
		if (analyser && active) {
			if (!this.freq || this.freq.length !== analyser.frequencyBinCount) {
				this.freq = new Float32Array(analyser.frequencyBinCount);
				this.time = new Float32Array(analyser.fftSize);
			}
			analyser.getFloatFrequencyData(this.freq);
			analyser.getFloatTimeDomainData(this.time!);
			low = level(bandPower(this.freq, sampleRate, ...BANDS.low), -70, -20);
			mid = level(bandPower(this.freq, sampleRate, ...BANDS.mid), -80, -30);
			high = level(bandPower(this.freq, sampleRate, ...BANDS.high), -90, -40);
			r = level(rms(this.time!) ** 2, -40, -6);
		}
		this.out.low = this.env.low.step(low, dtMs);
		this.out.mid = this.env.mid.step(mid, dtMs);
		this.out.high = this.env.high.step(high, dtMs);
		this.out.rms = this.env.rms.step(r, dtMs);
		return this.out;
	}
}
