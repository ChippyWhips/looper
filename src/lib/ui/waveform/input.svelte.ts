import type { App } from '../../state/app.svelte';
import type { LoopDraw } from './render';

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

	mainDown(e: PointerEvent, el: HTMLElement): void {
		if (!this.app.track.loaded || e.button !== 0) return;
		el.setPointerCapture(e.pointerId);
		this.app.seek(this.app.viewport.frameAt(this.localX(e, el)));
	}

	mainMove(_e: PointerEvent, _el: HTMLElement): void {}

	mainUp(_e: PointerEvent, _el: HTMLElement): void {}

	mainLeave(): void {}

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
