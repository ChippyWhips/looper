import type { SeparationModel, StemName } from '../separation/types';

/** Per-track settings, stored as settings.json. Frames refer to `sampleRate`. */
export interface SettingsV1 {
	version: 1;
	sampleRate: number;
	loop: { start: number; end: number; on: boolean };
	speed: number;
	cents: number;
	countIn: boolean;
	tempoOverride: number | null;
	position: number;
	view: { start: number; fpp: number } | null;
	/** Absent until the track has stems. */
	stems?: StemsSettings;
	updatedAt: number;
}

export interface StemsSettings {
	model: SeparationModel;
	names: StemName[];
	muted: StemName[];
	soloed: StemName[];
}

export type Settings = SettingsV1;
export const SETTINGS_VERSION = 1;

export function defaultSettings(sampleRate: number): Settings {
	return {
		version: 1,
		sampleRate,
		loop: { start: 0, end: 0, on: false },
		speed: 100,
		cents: 0,
		countIn: false,
		tempoOverride: null,
		position: 0,
		view: null,
		updatedAt: 0
	};
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Migrations keyed by the version they upgrade from. Add `1: (v1) => v2` when version 2 exists. */
export const MIGRATIONS: Record<number, Migration> = {};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);

/** Parse and migrate stored settings; null if unusable. */
export function migrate(input: unknown, migrations = MIGRATIONS): Settings | null {
	if (!input || typeof input !== 'object') return null;
	let raw = input as Record<string, unknown>;
	let v = raw.version;
	while (isInt(v) && v < SETTINGS_VERSION) {
		const m = migrations[v];
		if (!m) return null;
		raw = m(raw);
		v = raw.version;
	}
	if (v !== SETTINGS_VERSION) return null;
	const loop = raw.loop as Record<string, unknown> | undefined;
	const view = raw.view as Record<string, unknown> | null | undefined;
	if (!isInt(raw.sampleRate) || !loop || !isInt(loop.start) || !isInt(loop.end)) return null;
	const out: Settings = {
		version: 1,
		sampleRate: raw.sampleRate,
		loop: { start: loop.start, end: loop.end, on: loop.on === true },
		speed: isNum(raw.speed) ? raw.speed : 100,
		cents: isNum(raw.cents) ? raw.cents : 0,
		countIn: raw.countIn === true,
		tempoOverride: isNum(raw.tempoOverride) ? raw.tempoOverride : null,
		position: isInt(raw.position) ? raw.position : 0,
		view:
			view && isNum(view.start) && isNum(view.fpp) ? { start: view.start, fpp: view.fpp } : null,
		updatedAt: isNum(raw.updatedAt) ? raw.updatedAt : 0
	};
	const st = raw.stems as Partial<StemsSettings> | undefined;
	if (st && typeof st === 'object' && typeof st.model === 'string' && Array.isArray(st.names)) {
		out.stems = {
			model: st.model,
			names: st.names,
			muted: Array.isArray(st.muted) ? st.muted : [],
			soloed: Array.isArray(st.soloed) ? st.soloed : []
		};
	}
	return out;
}

/** Convert frame positions to another sample rate (if the device rate changed). */
export function rescale(s: Settings, sampleRate: number): Settings {
	if (s.sampleRate === sampleRate) return s;
	const k = sampleRate / s.sampleRate;
	const f = (x: number) => Math.round(x * k);
	return {
		...s,
		sampleRate,
		loop: { ...s.loop, start: f(s.loop.start), end: f(s.loop.end) },
		position: f(s.position),
		view: s.view ? { start: s.view.start * k, fpp: s.view.fpp * k } : null
	};
}
