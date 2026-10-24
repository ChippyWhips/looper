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

	it('mix <-> stems switches ramp linearly over ~20 ms (stems sum to the mix)', () => {
		const m = new Mixer(SR);
		m.setSources(sources());
		expect(m.rampFrames).toBe(960);
		m.update([st('s1', 'stem', false, true)]);
		const mid: number[] = [];
		for (let i = 0; i <= m.rampFrames; i++) {
			mid.push(m.sample(0, 0));
			m.tick();
		}
		expect(mid[480]).toBeCloseTo(0.5 * 0.5 - 0.25 * 0.5, 6);
		expect(mid[0]).toBeCloseTo(0.5, 6);
		expect(mid[960]).toBeCloseTo(-0.25, 6);
		expect(m.settled).toBe(true);
		for (let i = 1; i < mid.length; i++) expect(Math.abs(mid[i] - mid[i - 1])).toBeLessThan(0.002);
	});

	it('changes among stems crossfade on equal-power curves', () => {
		const m = new Mixer(SR);
		const x = new Float32Array(10).fill(0.5);
		const y = new Float32Array(10).fill(-0.25);
		m.setSources([
			{ ...st('mix', 'mix'), channels: [x] },
			{ ...st('a', 'stem', false, true), channels: [x] },
			{ ...st('b', 'stem'), channels: [y] }
		]);
		m.update([st('a', 'stem', false, false), st('b', 'stem', false, true)]);
		for (let i = 0; i < 480; i++) m.tick();
		// Halfway, both are at 1/√2.
		expect(m.sample(0, 0)).toBeCloseTo(0.5 * Math.SQRT1_2 - 0.25 * Math.SQRT1_2, 3);
	});

	it('reads out of range frames as silence', () => {
		const m = new Mixer(SR);
		m.setSources(sources());
		expect(m.sample(0, -1)).toBe(0);
		expect(m.sample(0, n)).toBe(0);
		expect(m.length).toBe(n);
	});
});

describe('mix ↔ stems switching', () => {
	const SR = 48000;
	const n = 4800;
	const mix = new Float32Array(n).fill(0.6);
	const stemA = new Int16Array(n).fill(Math.round(0.4 * 32768));
	const stemB = new Int16Array(n).fill(Math.round(0.2 * 32768));
	const mk = () => {
		const m = new Mixer(SR);
		m.setSources([{ ...st('mix', 'mix'), channels: [mix] }]);
		m.addSources([
			{ ...st('a', 'stem'), channels: [stemA, stemA] },
			{ ...st('b', 'stem'), channels: [stemB, stemB] }
		]);
		return m;
	};
	const settle = (m: Mixer) => {
		for (let i = 0; i <= m.rampFrames; i++) m.tick();
	};

	it('adding stems keeps playing the mix when nothing is muted or soloed', () => {
		const m = mk();
		expect(m.ids).toEqual(['mix', 'a', 'b']);
		settle(m);
		expect(m.sample(0, 0)).toBeCloseTo(0.6, 4);
	});

	it('muting a stem switches to the other stems with a 20 ms ramp, and back', () => {
		const m = mk();
		settle(m);
		m.update([st('a', 'stem', true)]);
		expect(m.settled).toBe(false);
		const mid: number[] = [];
		for (let i = 0; i <= m.rampFrames; i++) {
			mid.push(m.sample(0, 0));
			m.tick();
		}
		expect(mid[0]).toBeCloseTo(0.6, 4);
		expect(m.sample(0, 0)).toBeCloseTo(0.2, 4);
		for (let i = 1; i < mid.length; i++) expect(Math.abs(mid[i] - mid[i - 1])).toBeLessThan(0.003);
		m.update([st('a', 'stem', false)]);
		settle(m);
		expect(m.sample(0, 0)).toBeCloseTo(0.6, 4);
	});

	it('solo plays only the soloed stem; removing stems returns to the mix', () => {
		const m = mk();
		m.update([st('b', 'stem', false, true)]);
		settle(m);
		expect(m.sample(1, 10)).toBeCloseTo(0.2, 4);
		m.removeSources(['a', 'b']);
		settle(m);
		expect(m.sample(0, 10)).toBeCloseTo(0.6, 4);
	});
});
