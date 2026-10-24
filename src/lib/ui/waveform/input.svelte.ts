import type { App } from '../../state/app.svelte';
import type { LoopDraw } from './render';

const HIT = 8;
const DRAG_PX = 3;

/** Pointer and wheel handling for the waveform canvases. */
export class WaveformInput {
	cursor = $state('default');
	/** Loop being dragged, drawn instead of the committed loop. */
	preview: LoopDraw | null = null;
	private app: App;
	private overviewDrag = false;
	private pinchBase = 1;

	constructor(app: App) {
		this.app = app;
	}

	private localX(e: PointerEvent | WheelEvent, el: HTMLElement): number {
		return e.clientX - el.getBoundingClientRect().left;
	}

	wheel(e: WheelEvent, el: HTMLElement): void {
		if (!this.app.track.loaded) return;
		e.preventDefault();
		const vp = this.app.viewport;
		const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
		const dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
		if (e.metaKey || e.ctrlKey) {
			// ⌘ + scroll, or a trackpad pinch (reported as ctrl + wheel).
			vp.zoomAt(Math.exp(-dy * (e.ctrlKey && !e.metaKey ? 0.02 : 0.005)), this.localX(e, el));
			return;
		}
		const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
		if (d !== 0) {
			vp.panBy(d);
			this.app.manualPan();
		}
	}

	/** Safari pinch gestures. */
	gestureStart(): void {
		this.pinchBase = 1;
	}

	gestureChange(scale: number, x: number): void {
		const f = scale / this.pinchBase;
		this.pinchBase = scale;
		this.app.viewport.zoomAt(f, x);
	}

	/**
	 * What a press at x does. With a loop region set, only its edges edit it; anywhere else
	 * scrubs the playhead (Shift-drag draws a new region). Without one, dragging draws a region
	 * unless the press is on the playhead.
	 */
	private hit(x: number, shift: boolean): 'in' | 'out' | 'scrub' | 'create' {
		const app = this.app;
		const vp = app.viewport;
		const l = app.loop;
		if (l.exists) {
			const di = Math.abs(x - vp.xAt(l.start));
			const dout = Math.abs(x - vp.xAt(l.end));
			if (Math.min(di, dout) <= HIT / 2) return di <= dout ? 'in' : 'out';
			return shift ? 'create' : 'scrub';
		}
		if (Math.abs(x - vp.xAt(app.position())) <= HIT / 2) return 'scrub';
		return 'create';
	}

	private drag: {
		kind: 'in' | 'out' | 'scrub' | 'create';
		x: number;
		frame: number;
		moved: boolean;
	} | null = null;

	mainDown(e: PointerEvent, el: HTMLElement): void {
		if (!this.app.track.loaded || e.button !== 0) return;
		el.setPointerCapture(e.pointerId);
		const x = this.localX(e, el);
		const kind = this.hit(x, e.shiftKey);
		this.drag = { kind, x, frame: this.app.viewport.frameAt(x), moved: false };
		if (kind === 'in' || kind === 'out') this.app.loop.selected = kind;
	}

	mainMove(e: PointerEvent, el: HTMLElement): void {
		const x = this.localX(e, el);
		const d = this.drag;
		const app = this.app;
		if (!d) {
			const h = app.track.loaded ? this.hit(x, e.shiftKey) : 'create';
			const onPlayhead =
				app.track.loaded && Math.abs(x - app.viewport.xAt(app.position())) <= HIT / 2;
			this.cursor = h === 'in' || h === 'out' ? 'col-resize' : onPlayhead ? 'ew-resize' : 'default';
			return;
		}
		if (!d.moved && Math.abs(x - d.x) < DRAG_PX) return;
		d.moved = true;
		const f = app.viewport.frameAt(x);
		switch (d.kind) {
			case 'in':
			case 'out':
				app.setEdge(d.kind, app.snap(f, e.altKey));
				break;
			case 'scrub':
				this.cursor = 'ew-resize';
				app.loop.selected = null;
				app.seek(f);
				break;
			case 'create':
				app.loop.selected = null;
				app.setLoopRange(app.snap(d.frame, e.altKey), app.snap(f, e.altKey), true);
				break;
		}
	}

	mainUp(e: PointerEvent, el: HTMLElement): void {
		const d = this.drag;
		this.drag = null;
		if (!d) return;
		if (!d.moved && (d.kind === 'scrub' || d.kind === 'create')) {
			this.app.loop.selected = null;
			this.app.seek(d.frame);
		}
		this.mainMove(e, el);
	}

	mainLeave(): void {
		if (!this.drag) this.cursor = 'default';
	}

	private overviewSeek(e: PointerEvent, el: HTMLElement): void {
		const r = el.getBoundingClientRect();
		const frame = ((e.clientX - r.left) / r.width) * this.app.track.length;
		this.app.viewport.centreOn(frame);
		this.app.manualPan();
	}

	overviewDown(e: PointerEvent, el: HTMLElement): void {
		if (!this.app.track.loaded || e.button !== 0) return;
		el.setPointerCapture(e.pointerId);
		this.overviewDrag = true;
		this.overviewSeek(e, el);
	}

	overviewMove(e: PointerEvent, el: HTMLElement): void {
		if (this.overviewDrag) this.overviewSeek(e, el);
	}

	overviewUp(_e: PointerEvent): void {
		this.overviewDrag = false;
	}
}
