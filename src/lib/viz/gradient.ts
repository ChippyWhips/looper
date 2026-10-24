import { COLOURS, FRAGMENT, VERTEX } from './shaders/gradient.frag';

export type RGB = [number, number, number];

/** Parse a computed colour (hex or rgb function notation) to 0..1 floats. */
export function parseColor(s: string): RGB {
	const t = s.trim();
	if (t.startsWith('#')) {
		const h = t.length === 4 ? [...t.slice(1)].map((c) => c + c).join('') : t.slice(1, 7);
		return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
	}
	const m = t.match(/[\d.]+/g);
	if (m && m.length >= 3) return [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255];
	return [0, 0, 0];
}

export interface Palette {
	base: RGB;
	/** --viz-1 … --viz-7 */
	colours: RGB[];
}

export function readPalette(el: Element): Palette {
	const s = getComputedStyle(el);
	const v = (n: string) => parseColor(s.getPropertyValue(n));
	return {
		base: v('--bg-sunken'),
		colours: Array.from({ length: COLOURS }, (_, i) => v(`--viz-${i + 1}`))
	};
}

/** Shuffle colours with a seeded PRNG so each launch starts from a different arrangement. */
export function shufflePalette(p: Palette, seed: number): Palette {
	let x = Math.floor(seed * 1e6) >>> 0 || 1;
	const rnd = () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296;
	const c = [...p.colours];
	for (let i = c.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[c[i], c[j]] = [c[j], c[i]];
	}
	return { base: p.base, colours: c };
}

export interface FrameParams {
	time: number;
	seed: number;
	warp: number;
	low: number;
	high: number;
	pulse: number;
	exposure: number;
	grain: number;
	frame: number;
}

/** WebGL2 renderer for the visualiser. */
export class GradientRenderer {
	private gl: WebGL2RenderingContext;
	private prog: WebGLProgram;
	private u: Record<string, WebGLUniformLocation | null> = {};

	private constructor(gl: WebGL2RenderingContext) {
		this.gl = gl;
		const compile = (type: number, src: string) => {
			const sh = gl.createShader(type)!;
			gl.shaderSource(sh, src);
			gl.compileShader(sh);
			if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
				throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
			return sh;
		};
		const prog = gl.createProgram()!;
		gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
		gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAGMENT));
		gl.linkProgram(prog);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
			throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
		this.prog = prog;
		gl.useProgram(prog);
		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const loc = gl.getAttribLocation(prog, 'aPos');
		gl.enableVertexAttribArray(loc);
		gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
		const names = ['uRes', 'uTime', 'uSeed', 'uWarp', 'uLow', 'uHigh', 'uPulse'];
		names.push('uExposure', 'uGrain', 'uFrame', 'uBase', 'uCol');
		for (const n of names) {
			this.u[n] = gl.getUniformLocation(prog, n);
		}
	}

	static create(canvas: HTMLCanvasElement): GradientRenderer | null {
		const gl = canvas.getContext('webgl2', {
			antialias: false,
			alpha: false,
			preserveDrawingBuffer: true
		});
		if (!gl) return null;
		try {
			return new GradientRenderer(gl);
		} catch {
			return null;
		}
	}

	setPalette(p: Palette): void {
		const gl = this.gl;
		gl.useProgram(this.prog);
		gl.uniform3fv(this.u.uBase, p.base);
		gl.uniform3fv(this.u.uCol, new Float32Array(p.colours.flat()));
	}

	render(f: FrameParams): void {
		const gl = this.gl;
		const c = gl.canvas as HTMLCanvasElement;
		gl.viewport(0, 0, c.width, c.height);
		gl.uniform2f(this.u.uRes, c.width, c.height);
		gl.uniform1f(this.u.uTime, f.time);
		gl.uniform1f(this.u.uSeed, f.seed);
		gl.uniform1f(this.u.uWarp, f.warp);
		gl.uniform1f(this.u.uLow, f.low);
		gl.uniform1f(this.u.uHigh, f.high);
		gl.uniform1f(this.u.uPulse, f.pulse);
		gl.uniform1f(this.u.uExposure, f.exposure);
		gl.uniform1f(this.u.uGrain, f.grain);
		gl.uniform1f(this.u.uFrame, f.frame);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}
}

/** Static 2D-canvas frame of the gradient, for browsers without WebGL2. */
export function drawStatic(canvas: HTMLCanvasElement, p: Palette): void {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	const w = canvas.width;
	const h = canvas.height;
	const hex2 = (x: number) =>
		Math.round(Math.min(1, Math.max(0, x)) * 255)
			.toString(16)
			.padStart(2, '0');
	const css = (c: RGB, a = 1) => `#${c.map(hex2).join('')}${hex2(a)}`;
	ctx.fillStyle = css(p.base);
	ctx.fillRect(0, 0, w, h);
	const blob = (x: number, y: number, r: number, c: RGB, a: number) => {
		const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * Math.max(w, h));
		g.addColorStop(0, css(c, a));
		g.addColorStop(1, css(c, 0));
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, w, h);
	};
	p.colours.forEach((c, i) => {
		const a = (i / p.colours.length) * Math.PI * 2;
		blob(0.5 + 0.35 * Math.cos(a), 0.5 + 0.35 * Math.sin(a), 0.6, c, 0.45);
	});
}
