import { rangeMinMax, type PeakLevel } from '../../analysis/peaks';
import { formatTime } from '../../time';
import type { Viewport } from './viewport';

export interface Colors {
	bg: string;
	waveDefault: string;
	waveActive: string;
	loopBand: string;
	loopEdge: string;
	edgeOff: string;
	accent: string;
	zero: string;
	tick: string;
	label: string;
	window: string;
}

export function readColors(el: Element): Colors {
	const s = getComputedStyle(el);
	const v = (name: string) => s.getPropertyValue(name).trim();
	return {
		bg: v('--bg-sunken'),
		waveDefault: v('--wave-default'),
		waveActive: v('--wave-active'),
		loopBand: v('--loop-band'),
		loopEdge: v('--loop-edge'),
		edgeOff: v('--fg-muted'),
		accent: v('--accent'),
		zero: v('--border-subtle'),
		tick: v('--border-strong'),
		label: v('--fg-subtle'),
		window: v('--fg-primary')
	};
}

export interface LoopDraw {
	start: number;
	end: number;
	on: boolean;
	selected: 'in' | 'out' | null;
}

export interface Scene {
	viewport: Viewport;
	levels: readonly PeakLevel[];
	channels: readonly Float32Array[] | null;
	sampleRate: number;
	loop: LoopDraw | null;
	playhead: number | null;
	colors: Colors;
	monoFont: string;
}

/** Size a canvas to its CSS box at device resolution. Returns the device pixel ratio. */
export function fitCanvas(canvas: HTMLCanvasElement): number {
	const dpr = window.devicePixelRatio || 1;
	const r = canvas.getBoundingClientRect();
	const w = Math.max(1, Math.round(r.width * dpr));
	const h = Math.max(1, Math.round(r.height * dpr));
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w;
		canvas.height = h;
	}
	return dpr;
}

const mm: [number, number] = [0, 0];

function hasLoop(l: LoopDraw | null): l is LoopDraw {
	return !!l && l.end > l.start;
}

/** Main lane: true min/max per device column, polyline at sample level, loop and playhead. */
export function drawMain(canvas: HTMLCanvasElement, s: Scene): void {
	const dpr = fitCanvas(canvas);
	const ctx = canvas.getContext('2d')!;
	const W = canvas.width;
	const H = canvas.height;
	const vp = s.viewport;
	const c = s.colors;
	ctx.clearRect(0, 0, W, H);
	const px = Math.max(1, Math.round(dpr));
	const mid = Math.floor(H / 2);
	const half = (H / 2) * 0.92;
	const fppD = vp.fpp / dpr;
	const x0 = (f: number) => Math.round(((f - vp.start) / vp.fpp) * dpr);
	const loop = hasLoop(s.loop) ? s.loop : null;
	const active = (f: number) => !!loop && loop.on && f >= loop.start && f < loop.end;

	// Loop band.
	if (loop?.on) {
		const a = Math.max(0, x0(loop.start));
		const b = Math.min(W, x0(loop.end));
		if (b > a) {
			ctx.fillStyle = c.loopBand;
			ctx.fillRect(a, 0, b - a, H);
		}
	}

	// Zero line.
	ctx.fillStyle = c.zero;
	ctx.fillRect(0, mid, W, px);

	const haveData = s.levels.length > 0 || (s.channels && fppD < 256);
	if (haveData && vp.length > 0) {
		if (fppD >= 1) {
			for (let pass = 0; pass < 2; pass++) {
				ctx.fillStyle = pass === 0 ? c.waveDefault : c.waveActive;
				for (let i = 0; i < W; i++) {
					const a = Math.floor(vp.start + i * fppD);
					const b = Math.floor(vp.start + (i + 1) * fppD);
					if (b <= 0 || a >= vp.length) continue;
					if (active(a + (b - a) / 2) !== (pass === 1)) continue;
					rangeMinMax(
						s.levels,
						fppD < 4096 ? s.channels : null,
						Math.max(0, a),
						Math.min(vp.length, b),
						mm
					);
					if (mm[0] > mm[1]) continue;
					const top = Math.floor(mid - mm[1] * half);
					const bot = Math.ceil(mid - mm[0] * half);
					ctx.fillRect(i, top, 1, Math.max(1, bot - top));
				}
			}
		} else if (s.channels) {
			drawSamples(ctx, s, dpr, mid, half, active);
		}
	}

	if (loop) {
		const edge = (f: number, selected: boolean) => {
			const x = x0(f);
			const w = selected ? px * 2 : px;
			if (x + w < 0 || x - w > W) return;
			ctx.fillStyle = loop.on ? c.loopEdge : c.edgeOff;
			ctx.fillRect(selected ? x - px : x, 0, w, H);
		};
		edge(loop.start, loop.selected === 'in');
		edge(loop.end, loop.selected === 'out');
		if (loop.selected) {
			const f = loop.selected === 'in' ? loop.start : loop.end;
			const x = x0(f);
			const text = formatTime(f, s.sampleRate);
			ctx.font = `${11 * dpr}px ${s.monoFont}`;
			ctx.textBaseline = 'top';
			ctx.fillStyle = loop.on ? c.loopEdge : c.edgeOff;
			const tw = ctx.measureText(text).width;
			const pad = 6 * dpr;
			ctx.fillText(text, loop.selected === 'in' ? x + pad : x - pad - tw, 6 * dpr);
		}
	}

	if (s.playhead !== null) {
		const x = x0(s.playhead);
		if (x >= -px && x <= W) {
			ctx.fillStyle = c.accent;
			ctx.fillRect(x, 0, px, H);
		}
	}
}

function drawSamples(
	ctx: CanvasRenderingContext2D,
	s: Scene,
	dpr: number,
	mid: number,
	half: number,
	active: (f: number) => boolean
): void {
	const vp = s.viewport;
	const chans = s.channels!;
	const first = Math.max(0, Math.floor(vp.start) - 1);
	const last = Math.min(vp.length - 1, Math.ceil(vp.end) + 1);
	const xs = (f: number) => ((f - vp.start) / vp.fpp) * dpr;
	const dots = 1 / vp.fpp > 6;
	const d = 2 * dpr;
	for (let pass = 0; pass < 2; pass++) {
		const color = pass === 0 ? s.colors.waveDefault : s.colors.waveActive;
		ctx.strokeStyle = color;
		ctx.fillStyle = color;
		ctx.lineWidth = dpr;
		ctx.lineJoin = 'miter';
		for (const ch of chans) {
			ctx.beginPath();
			let pen = false;
			for (let f = first; f <= last; f++) {
				const on = active(f) === (pass === 1);
				const nextOn = f < last && active(f + 1) === (pass === 1);
				const y = mid - ch[f] * half;
				if (on || nextOn) {
					if (!pen) ctx.moveTo(xs(f), y);
					else ctx.lineTo(xs(f), y);
					pen = true;
				} else pen = false;
				if (!on && pen) {
					ctx.lineTo(xs(f), y);
					pen = false;
				}
			}
			ctx.stroke();
			if (dots) {
				for (let f = first; f <= last; f++) {
					if (active(f) !== (pass === 1)) continue;
					const x = Math.round(xs(f) - d / 2);
					const y = Math.round(mid - ch[f] * half - d / 2);
					ctx.fillRect(x, y, d, d);
				}
			}
		}
	}
}

const TIME_STEPS = [
	0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600
];
const FRAME_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500];
const LABEL_MIN_PX = 80;

export interface RulerScene {
	viewport: Viewport;
	sampleRate: number;
	playhead: number | null;
	colors: Colors;
	monoFont: string;
}

/** Ruler step in frames, and whether labels are sample numbers (when even 1 ms is too wide). */
export function rulerStep(fpp: number, sampleRate: number): { frames: number; samples: boolean } {
	const minFrames = LABEL_MIN_PX * fpp;
	if (minFrames < 0.001 * sampleRate) {
		const f = FRAME_STEPS.find((x) => x >= minFrames) ?? FRAME_STEPS[FRAME_STEPS.length - 1];
		return { frames: f, samples: true };
	}
	const t =
		TIME_STEPS.find((x) => x * sampleRate >= minFrames) ?? TIME_STEPS[TIME_STEPS.length - 1];
	return { frames: t * sampleRate, samples: false };
}

function rulerLabel(
	frame: number,
	stepFrames: number,
	sampleRate: number,
	samples: boolean
): string {
	if (samples) return String(Math.round(frame));
	if (stepFrames >= sampleRate) {
		const t = Math.round(frame / sampleRate);
		return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
	}
	return formatTime(frame, sampleRate);
}

export function drawRuler(canvas: HTMLCanvasElement, s: RulerScene): void {
	const dpr = fitCanvas(canvas);
	const ctx = canvas.getContext('2d')!;
	const W = canvas.width;
	const H = canvas.height;
	const vp = s.viewport;
	ctx.clearRect(0, 0, W, H);
	if (vp.length <= 0) return;
	const px = Math.max(1, Math.round(dpr));
	const { frames: step, samples } = rulerStep(vp.fpp, s.sampleRate);
	const first = Math.floor(vp.start / step) * step;
	ctx.font = `${11 * dpr}px ${s.monoFont}`;
	ctx.textBaseline = 'alphabetic';
	const tick = 4 * dpr;
	for (let f = first; f <= vp.end; f += step) {
		const x = Math.round(((f - vp.start) / vp.fpp) * dpr);
		if (x < -LABEL_MIN_PX * dpr) continue;
		ctx.fillStyle = s.colors.tick;
		ctx.fillRect(x, H - tick, px, tick);
		const minor = Math.round(((f + step / 2 - vp.start) / vp.fpp) * dpr);
		ctx.fillRect(minor, H - tick / 2, px, tick / 2);
		ctx.fillStyle = s.colors.label;
		ctx.fillText(rulerLabel(f, step, s.sampleRate, samples), x + 4 * dpr, 12 * dpr);
	}
	if (s.playhead !== null) {
		const x = ((s.playhead - vp.start) / vp.fpp) * dpr;
		if (x >= 0 && x <= W) {
			ctx.fillStyle = s.colors.accent;
			ctx.beginPath();
			ctx.arc(Math.round(x) + px / 2, H - 2.5 * dpr, 2.5 * dpr, 0, Math.PI * 2);
			ctx.fill();
		}
	}
}

export interface OverviewScene {
	viewport: Viewport;
	levels: readonly PeakLevel[];
	loop: LoopDraw | null;
	playhead: number | null;
	colors: Colors;
}

/** Whole-track strip with loop region, visible window rectangle and playhead. */
export function drawOverview(canvas: HTMLCanvasElement, s: OverviewScene): void {
	const dpr = fitCanvas(canvas);
	const ctx = canvas.getContext('2d')!;
	const W = canvas.width;
	const H = canvas.height;
	const vp = s.viewport;
	ctx.clearRect(0, 0, W, H);
	if (vp.length <= 0) return;
	const px = Math.max(1, Math.round(dpr));
	const fppD = vp.length / W;
	const xf = (f: number) => Math.round((f / vp.length) * W);
	const loop = hasLoop(s.loop) ? s.loop : null;
	if (loop?.on) {
		ctx.fillStyle = s.colors.loopBand;
		ctx.fillRect(xf(loop.start), 0, Math.max(px, xf(loop.end) - xf(loop.start)), H);
	}
	if (s.levels.length) {
		const mid = H / 2;
		const half = H / 2 - 2 * dpr;
		for (let pass = 0; pass < 2; pass++) {
			ctx.fillStyle = pass === 0 ? s.colors.waveDefault : s.colors.waveActive;
			for (let i = 0; i < W; i++) {
				const a = Math.floor(i * fppD);
				const b = Math.floor((i + 1) * fppD);
				const on = !!loop?.on && (a + b) / 2 >= loop.start && (a + b) / 2 < loop.end;
				if (on !== (pass === 1)) continue;
				rangeMinMax(s.levels, null, a, Math.max(a + 1, b), mm);
				if (mm[0] > mm[1]) continue;
				const top = Math.floor(mid - mm[1] * half);
				const bot = Math.ceil(mid - mm[0] * half);
				ctx.fillRect(i, top, 1, Math.max(1, bot - top));
			}
		}
	}
	if (loop) {
		ctx.fillStyle = loop.on ? s.colors.loopEdge : s.colors.edgeOff;
		ctx.fillRect(xf(loop.start), 0, px, H);
		ctx.fillRect(xf(loop.end), 0, px, H);
	}
	if (s.playhead !== null) {
		// Muted, not accent: the main playhead is the accent mark.
		ctx.fillStyle = s.colors.edgeOff;
		ctx.fillRect(xf(s.playhead), 0, px, H);
	}
	if (!vp.isFit) {
		const a = xf(vp.start);
		const b = Math.max(a + px * 3, xf(vp.end));
		ctx.strokeStyle = s.colors.window;
		ctx.lineWidth = px;
		ctx.strokeRect(a + px / 2, px / 2, b - a - px, H - px);
	}
}

export interface LaneDraw {
	levels: readonly PeakLevel[];
	/** False when the lane is not in the current output (muted, or another lane soloed). */
	audible: boolean;
}

export interface LanesScene {
	viewport: Viewport;
	lanes: readonly LaneDraw[];
	/** CSS px per lane, excluding the 1 px separator. */
	laneHeight: number;
	loop: LoopDraw | null;
	playhead: number | null;
	colors: Colors;
}

/** Stem lanes: one waveform each, sharing the main viewport, loop band and playhead. */
export function drawLanes(canvas: HTMLCanvasElement, s: LanesScene): void {
	const dpr = fitCanvas(canvas);
	const ctx = canvas.getContext('2d')!;
	const W = canvas.width;
	const H = canvas.height;
	const vp = s.viewport;
	const c = s.colors;
	ctx.clearRect(0, 0, W, H);
	const px = Math.max(1, Math.round(dpr));
	const fppD = vp.fpp / dpr;
	const x0 = (f: number) => Math.round(((f - vp.start) / vp.fpp) * dpr);
	const loop = hasLoop(s.loop) ? s.loop : null;
	if (loop?.on) {
		const a = Math.max(0, x0(loop.start));
		const b = Math.min(W, x0(loop.end));
		if (b > a) {
			ctx.fillStyle = c.loopBand;
			ctx.fillRect(a, 0, b - a, H);
		}
	}
	const step = Math.round((s.laneHeight + 1) * dpr);
	s.lanes.forEach((lane, k) => {
		const top = k * step + px;
		const h = step - px;
		const mid = top + Math.floor(h / 2);
		const half = (h / 2) * 0.85;
		ctx.fillStyle = c.zero;
		ctx.fillRect(0, k * step, W, px);
		if (!lane.levels.length) return;
		for (let pass = 0; pass < 2; pass++) {
			ctx.fillStyle = pass === 0 ? c.waveDefault : c.waveActive;
			for (let i = 0; i < W; i++) {
				const a = Math.floor(vp.start + i * fppD);
				const b = Math.floor(vp.start + (i + 1) * fppD);
				if (b <= 0 || a >= vp.length) continue;
				const fm = a + (b - a) / 2;
				const on = lane.audible && !!loop?.on && fm >= loop.start && fm < loop.end;
				if (on !== (pass === 1)) continue;
				rangeMinMax(lane.levels, null, Math.max(0, a), Math.min(vp.length, Math.max(a + 1, b)), mm);
				if (mm[0] > mm[1]) continue;
				const t = Math.floor(mid - mm[1] * half);
				const bt = Math.ceil(mid - mm[0] * half);
				ctx.fillRect(i, t, 1, Math.max(1, bt - t));
			}
		}
	});
	if (loop) {
		ctx.fillStyle = loop.on ? c.loopEdge : c.edgeOff;
		for (const f of [loop.start, loop.end]) {
			const x = x0(f);
			if (x >= -px && x <= W) ctx.fillRect(x, 0, px, H);
		}
	}
	if (s.playhead !== null) {
		const x = x0(s.playhead);
		if (x >= -px && x <= W) {
			ctx.fillStyle = c.accent;
			ctx.fillRect(x, 0, px, H);
		}
	}
}
