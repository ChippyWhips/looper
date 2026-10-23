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

	/** Which part of the loop is under x: an edge (±4 px), inside the band, or outside. */
	private hit(x: number): 'in' | 'out' | 'inside' | 'outside' {
		const l = this.app.loop;
		if (!l.exists) return 'outside';
		const vp = this.app.viewport;
		const xi = vp.xAt(l.start);
		const xo = vp.xAt(l.end);
		const di = Math.abs(x - xi);
		const dout = Math.abs(x - xo);
		if (Math.min(di, dout) <= HIT / 2) return di <= dout ? 'in' : 'out';
		if (x > xi && x < xo) return 'inside';
		return 'outside';
	}

	private drag: {
		kind: 'in' | 'out' | 'inside' | 'outside';
		x: number;
		frame: number;
		origStart: number;
		moved: boolean;
	} | null = null;

	mainDown(e: PointerEvent, el: HTMLElement): void {
		if (!this.app.track.loaded || e.button !== 0) return;
		el.setPointerCapture(e.pointerId);
		const x = this.localX(e, el);
		const kind = this.hit(x);
		this.drag = {
			kind,
			x,
			frame: this.app.viewport.frameAt(x),
			origStart: this.app.loop.start,
			moved: false
		};
		if (kind === 'in' || kind === 'out') this.app.loop.selected = kind;
	}

	mainMove(e: PointerEvent, el: HTMLElement): void {
		const x = this.localX(e, el);
		const d = this.drag;
		if (!d) {
			const h = this.app.track.loaded ? this.hit(x) : 'outside';
			this.cursor = h === 'in' || h === 'out' ? 'col-resize' : h === 'inside' ? 'grab' : 'default';
			return;
		}
		if (!d.moved && Math.abs(x - d.x) < DRAG_PX) return;
		d.moved = true;
		const app = this.app;
		const f = app.viewport.frameAt(x);
		switch (d.kind) {
			case 'in':
			case 'out':
				app.setEdge(d.kind, app.snap(f, e.altKey));
				break;
			case 'inside':
				this.cursor = 'grabbing';
				app.moveLoop(app.snap(d.origStart + (f - d.frame), e.altKey));
				break;
			case 'outside':
				app.loop.selected = null;
				app.setLoopRange(app.snap(d.frame, e.altKey), app.snap(f, e.altKey), true);
				break;
		}
	}

	mainUp(e: PointerEvent, el: HTMLElement): void {
		const d = this.drag;
		this.drag = null;
		if (!d) return;
		if (!d.moved && (d.kind === 'outside' || d.kind === 'inside')) {
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
