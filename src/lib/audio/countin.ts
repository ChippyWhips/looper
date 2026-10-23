export const COUNT_IN_BEATS = 4;
export const CLICK_MS = 30;
/** −12 dBFS */
export const CLICK_GAIN = Math.pow(10, -12 / 20);
export const ACCENT_HZ = 1500;
export const BEAT_HZ = 1000;

/** Output frames per beat when the track tempo plays at the given speed. */
export function beatFrames(bpm: number, speed: number, sampleRate: number): number {
	return (60 / (bpm * speed)) * sampleRate;
}

export interface CountInPlan {
	/** Output frame of each click onset. */
	clicks: number[];
	/** Output frame at which the first audio frame is heard. */
	audioStart: number;
}

export function planCountIn(
	startFrame: number,
	bpm: number,
	speed: number,
	sampleRate: number
): CountInPlan {
	const b = beatFrames(bpm, speed, sampleRate);
	const clicks: number[] = [];
	for (let k = 0; k < COUNT_IN_BEATS; k++) clicks.push(Math.round(startFrame + k * b));
	return { clicks, audioStart: Math.round(startFrame + COUNT_IN_BEATS * b) };
}

/** Sample i of a click blip; zero outside [0, CLICK_MS). */
export function clickSample(i: number, accent: boolean, sampleRate: number): number {
	const len = (CLICK_MS / 1000) * sampleRate;
	if (i < 0 || i >= len) return 0;
	const t = i / sampleRate;
	const hz = accent ? ACCENT_HZ : BEAT_HZ;
	// Exponential decay with a short raised-cosine tail so the blip ends at zero.
	const env =
		Math.exp(-t / 0.008) *
		(i > len * 0.8 ? 0.5 + 0.5 * Math.cos((Math.PI * (i - len * 0.8)) / (len * 0.2)) : 1);
	return CLICK_GAIN * env * Math.sin(2 * Math.PI * hz * t);
}
