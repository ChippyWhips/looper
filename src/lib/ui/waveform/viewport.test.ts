import { describe, expect, it } from 'vitest';
import { Viewport, WaveView } from './viewport';

describe('viewport', () => {
	const v = () => {
		const x = new Viewport();
		x.width = 1000;
		x.setLength(1_000_000);
		return x;
	};

	it('fits the track', () => {
		const x = v();
		expect(x.fpp).toBe(1000);
		expect(x.start).toBe(0);
		expect(x.end).toBe(1_000_000);
	});

	it('zooms anchored at the cursor', () => {
		const x = v();
		const f = x.frameAt(250);
		x.zoomAt(8, 250);
		expect(x.frameAt(250)).toBeCloseTo(f, 6);
		expect(x.fpp).toBe(125);
	});

	it('clamps zoom to fit and 16 px per sample', () => {
		const x = v();
		x.zoomAt(1e9, 500);
		expect(x.fpp).toBe(1 / 16);
		x.zoomAt(1e-9, 500);
		expect(x.fpp).toBe(1000);
		expect(x.start).toBe(0);
	});

	it('clamps panning to the track', () => {
		const x = v();
		x.zoomAt(10, 0);
		x.panBy(-1e9);
		expect(x.start).toBe(0);
		x.panBy(1e9);
		expect(x.end).toBeCloseTo(1_000_000, 6);
	});

	it('shows a range with padding', () => {
		const x = v();
		x.show(100_000, 200_000, 0.05);
		expect(x.start).toBeCloseTo(95_000, 6);
		expect(x.end).toBeCloseTo(205_000, 6);
	});
});

describe('lanes', () => {
	it('every lane shares the one viewport; only the main lane exists in this run', () => {
		const w = new WaveView();
		expect(w.lanes.map((l) => l.id)).toEqual(['main']);
		w.lanes.push({ id: 'drums', label: 'Drums', sources: ['drums'] });
		w.viewport.width = 100;
		w.viewport.setLength(1000);
		w.viewport.zoomAt(2, 50);
		// Lanes hold no view state of their own, so a zoom applies to all of them.
		expect(w.lanes.every((l) => !('viewport' in l))).toBe(true);
		expect(w.viewport.fpp).toBe(5);
	});
});
