/** Horizontal view over a track, in source frames. Shared by every lane. */
export class Viewport {
	length = 0;
	/** CSS px */
	width = 1;
	/** Source frame at the left edge. */
	start = 0;
	/** Source frames per CSS px. */
	fpp = 1;
	/** Deepest zoom: 16 px per sample. */
	readonly minFpp = 1 / 16;
	/** Bumped on every change, for cheap dirty checks. */
	version = 0;

	get fitFpp(): number {
		return Math.max(this.minFpp, this.length / Math.max(1, this.width));
	}

	get end(): number {
		return this.start + this.fpp * this.width;
	}

	get isFit(): boolean {
		return this.fpp >= this.fitFpp && this.start <= 0;
	}

	setLength(length: number): void {
		this.length = length;
		this.fit();
	}

	setWidth(width: number): void {
		const wasFit = this.isFit;
		this.width = Math.max(1, width);
		if (wasFit) this.fit();
		else this.clamp();
	}

	fit(): void {
		this.fpp = this.fitFpp;
		this.start = 0;
		this.version++;
	}

	private clamp(): void {
		this.fpp = Math.min(this.fitFpp, Math.max(this.minFpp, this.fpp));
		const maxStart = Math.max(0, this.length - this.fpp * this.width);
		this.start = Math.min(maxStart, Math.max(0, this.start));
		this.version++;
	}

	frameAt(x: number): number {
		return this.start + x * this.fpp;
	}

	xAt(frame: number): number {
		return (frame - this.start) / this.fpp;
	}

	/** Zoom by `factor` (> 1 zooms in) keeping the frame under x fixed. */
	zoomAt(factor: number, x: number): void {
		const anchor = this.frameAt(x);
		this.fpp = Math.min(this.fitFpp, Math.max(this.minFpp, this.fpp / factor));
		this.start = anchor - x * this.fpp;
		this.clamp();
	}

	panBy(px: number): void {
		this.start += px * this.fpp;
		this.clamp();
	}

	/** Centre the view on a frame without changing zoom. */
	centreOn(frame: number): void {
		this.start = frame - (this.width / 2) * this.fpp;
		this.clamp();
	}

	setStart(frame: number): void {
		this.start = frame;
		this.clamp();
	}

	/** Show [a, b) with `pad` (fraction of the range) either side. */
	show(a: number, b: number, pad = 0.05): void {
		const len = Math.max(1, b - a);
		const p = len * pad;
		this.fpp = (len + 2 * p) / this.width;
		this.start = a - p;
		this.clamp();
	}

	/** Restore a saved view. */
	restore(start: number, fpp: number): void {
		this.fpp = fpp;
		this.start = start;
		this.clamp();
	}
}

export interface Lane {
	id: string;
	label: string;
	/** Source ids whose sum this lane shows; the main lane shows what is audible. */
	sources: string[];
}

/** Lanes sharing one viewport. Only the main lane renders in this run. */
export class WaveView {
	readonly viewport = new Viewport();
	lanes: Lane[] = [{ id: 'main', label: 'Mix', sources: ['mix'] }];
	/** Follow the playhead by paging; cleared by any manual pan. */
	follow = true;
}
