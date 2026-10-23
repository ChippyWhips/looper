import { describe, expect, it } from 'vitest';
import { Mixer, resolveTargets, type AudioSource, type SourceState } from './sources';

function st(
	id: string,
	kind: 'mix' | 'stem',
	muted = false,
	soloed = false,
	gain = 1
): SourceState {
	return { id, kind, label: id, gain, muted, soloed };
}

describe('mute/solo resolution', () => {
	it('plays only the mix when nothing is muted or soloed', () => {
		const t = resolveTargets([st('mix', 'mix'), st('a', 'stem'), st('b', 'stem')]);
		expect([...t]).toEqual([
			['mix', 1],
			['a', 0],
			['b', 0]
		]);
	});

	it('plays unmuted stems when any stem is muted', () => {
		const t = resolveTargets([st('mix', 'mix'), st('a', 'stem', true), st('b', 'stem')]);
		expect([...t]).toEqual([
			['mix', 0],
			['a', 0],
			['b', 1]
		]);
	});

	it('plays only soloed stems when any is soloed, regardless of mutes elsewhere', () => {
		const t = resolveTargets([
			st('mix', 'mix'),
			st('a', 'stem', false, true),
			st('b', 'stem', true),
			st('c', 'stem')
		]);
		expect([...t]).toEqual([
			['mix', 0],
			['a', 1],
			['b', 0],
			['c', 0]
		]);
	});

	it('a lone mix always plays', () => {
		expect([...resolveTargets([st('mix', 'mix', true)])]).toEqual([['mix', 1]]);
	});
});

describe('mixer', () => {
	const SR = 48000;
	const n = SR;
	const a = new Float32Array(n).fill(0.5);
	const b = new Float32Array(n).fill(-0.25);
	const sources = (): AudioSource[] => [
		{ ...st('mix', 'mix'), channels: [a, a] },
		{ ...st('s1', 'stem'), channels: [b] }
	];

	it('mixes two synthetic sources with gains', () => {
		const m = new Mixer(SR);
		const s = sources();
		s[0].gain = 0.5;
		m.setSources(s);
		expect(m.sample(0, 10)).toBeCloseTo(0.25, 9);
		m.update([{ ...st('s1', 'stem', false, true, 2) }]);
		for (let i = 0; i < m.rampFrames; i++) m.tick();
		expect(m.sample(0, 10)).toBeCloseTo(-0.5, 9);
		expect(m.sample(1, 10)).toBeCloseTo(-0.5, 9);
	});

	it('crossfades set changes over ~20 ms on equal-power curves', () => {
		const m = new Mixer(SR);
		m.setSources(sources());
		expect(m.rampFrames).toBe(960);
		m.update([st('s1', 'stem', false, true)]);
		const mid: number[] = [];
		for (let i = 0; i <= m.rampFrames; i++) {
			mid.push(m.sample(0, 0));
			m.tick();
		}
		// Halfway, both are at 1/√2.
		expect(mid[480]).toBeCloseTo(0.5 * Math.SQRT1_2 - 0.25 * Math.SQRT1_2, 6);
		expect(mid[0]).toBeCloseTo(0.5, 6);
		expect(mid[960]).toBeCloseTo(-0.25, 6);
		expect(m.settled).toBe(true);
		// Smooth: no step larger than the ramp slope allows.
		for (let i = 1; i < mid.length; i++) expect(Math.abs(mid[i] - mid[i - 1])).toBeLessThan(0.002);
	});

	it('reads out of range frames as silence', () => {
		const m = new Mixer(SR);
		m.setSources(sources());
		expect(m.sample(0, -1)).toBe(0);
		expect(m.sample(0, n)).toBe(0);
		expect(m.length).toBe(n);
	});
});
