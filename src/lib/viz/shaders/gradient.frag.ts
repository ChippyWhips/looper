export const COLOURS = 7;

/**
 * Liquid mesh gradient: seven moving colour points blended by normalised Gaussian weights
 * (so colour covers the whole surface), a flowing fbm domain warp, fbm shading for depth,
 * an audio pulse on exposure, and film grain.
 */
export const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uSeed;
uniform float uWarp;
uniform float uLow;
uniform float uHigh;
uniform float uPulse;
uniform float uExposure;
uniform float uGrain;
uniform float uFrame;
uniform vec3 uBase;
uniform vec3 uCol[${COLOURS}];
out vec4 frag;

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < 4; i++) {
		v += a * noise(p);
		p = p * 2.03 + vec2(17.1, 9.2);
		a *= 0.5;
	}
	return v;
}

void main() {
	vec2 uv = gl_FragCoord.xy / uRes;
	float aspect = uRes.x / uRes.y;
	vec2 p = vec2(uv.x * aspect, uv.y);
	float t = uTime;
	vec2 s = vec2(uSeed, uSeed * 1.37);

	vec2 q = vec2(fbm(p * 1.1 + s + vec2(t * 0.11, -t * 0.07)), fbm(p * 1.1 - s.yx + vec2(-t * 0.09, t * 0.13)));
	p += (0.45 + 0.5 * uWarp) * (q - 0.5);

	vec3 acc = vec3(0.0);
	float wsum = 0.0;
	float sigma = 0.3 + 0.12 * uLow + 0.08 * uPulse;
	for (int i = 0; i < ${COLOURS}; i++) {
		float fi = float(i);
		float ph = uSeed * 2.7 + fi * 2.399;
		float sp = 0.6 + 0.35 * fract(sin(fi * 12.9898 + uSeed) * 43758.5453);
		vec2 c = vec2(
			aspect * (0.5 + 0.42 * sin(t * sp + ph)),
			0.5 + 0.42 * cos(t * sp * 0.83 + ph * 1.3)
		);
		vec2 d = p - c;
		float w = exp(-dot(d, d) / (2.0 * sigma * sigma)) + 1e-4;
		acc += uCol[i] * w;
		wsum += w;
	}
	vec3 col = acc / wsum;

	float shade = smoothstep(0.2, 0.8, fbm(p * 1.7 + s * 0.5 + vec2(t * 0.17, t * 0.05)));
	col *= mix(0.3, 1.2, shade);
	col = mix(uBase, col, 0.92);
	col *= uExposure * (1.0 + 0.9 * uPulse);
	col += uCol[3] * uHigh * 0.12 * shade;
	col = 1.0 - exp(-col * 1.5);
	float lum = dot(col, vec3(0.299, 0.587, 0.114));
	col = max(vec3(0.0), mix(vec3(lum), col, 1.3));
	col += (hash(gl_FragCoord.xy + uFrame) - 0.5) * uGrain;
	frag = vec4(col, 1.0);
}
`;

export const VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
void main() {
	gl_Position = vec4(aPos, 0.0, 1.0);
}
`;
