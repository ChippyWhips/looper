export const MINUS = '−';

export function framesToMs(frames: number, sampleRate: number): number {
	return Math.round((frames * 1000) / sampleRate);
}

export function msToFrames(ms: number, sampleRate: number): number {
	return Math.round((ms * sampleRate) / 1000);
}

/** `m:ss.mmm`, rounded to the nearest millisecond. */
export function formatTime(frames: number, sampleRate: number): string {
	const total = framesToMs(Math.max(0, frames), sampleRate);
	const m = Math.floor(total / 60000);
	const s = Math.floor((total % 60000) / 1000);
	const ms = total % 1000;
	return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** `m:ss`, truncated to the second. */
export function formatDuration(frames: number, sampleRate: number): string {
	const total = Math.floor(frames / sampleRate);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Parse `m:ss.mmm`, `m:ss`, `ss.mmm` or `ss` to whole milliseconds; null if malformed. */
export function parseTime(text: string): number | null {
	const t = text.trim();
	const m = t.match(/^(?:(\d+):)?(\d+)(?:\.(\d{1,3}))?$/);
	if (!m) return null;
	const min = m[1] ? Number(m[1]) : 0;
	const sec = Number(m[2]);
	if (m[1] && sec >= 60) return null;
	const ms = m[3] ? Number(m[3].padEnd(3, '0')) : 0;
	return min * 60000 + sec * 1000 + ms;
}

/** Signed value with a real minus sign, e.g. `−100`. */
export function signed(v: number, digits = 0): string {
	const s = Math.abs(v).toFixed(digits);
	if (Number(s) === 0) return (0).toFixed(digits);
	return (v < 0 ? MINUS : '+') + s;
}

/** Parse a number allowing the real minus sign. */
export function parseNumber(text: string): number | null {
	const t = text.trim().replace(MINUS, '-').replace(/^\+/, '');
	if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
	return Number(t);
}
