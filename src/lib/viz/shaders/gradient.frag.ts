/** Mesh-gradient fragment shader: Gaussian colour fields, domain warp and film grain. */
export const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uWarp;
uniform float uLow;
uniform float uHigh;
uniform float uExposure;
uniform float uGrain;
uniform float uSeed;
uniform vec3 uBase;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;
out vec4 frag;

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

vec3 field(vec2 p, vec2 c, float r, vec3 col, float k) {
	vec2 d = p - c;
	return col * k * exp(-dot(d, d) / (2.0 * r * r));
}

void main() {
	vec2 uv = gl_FragCoord.xy / uRes;
	float a = uRes.x / uRes.y;
	vec2 p = vec2(uv.x * a, uv.y);
	float t = uTime;
	p += uWarp * 0.09 * vec2(sin(p.y * 3.1 + t * 1.3), cos(p.x * 2.7 - t * 1.1));

	vec3 col = uBase;
	col += field(p, vec2(a * (0.55 + 0.25 * sin(t * 0.37)), 0.7 + 0.2 * cos(t * 0.29)), 0.5, uC1, 0.9);
	col += field(p, vec2(a * (0.38 + 0.18 * sin(t)), 0.34 + 0.14 * cos(t * 0.8)), 0.24 + 0.1 * uLow, uC2, 0.55 + 0.6 * uLow);
	col += field(p, vec2(a * (0.72 + 0.16 * cos(t * 0.71)), 0.44 + 0.2 * sin(t * 0.63)), 0.16, uC3, 0.32);
	col += field(p, vec2(a * (0.2 + 0.12 * cos(t * 0.53)), 0.78 + 0.1 * sin(t * 0.47)), 0.15, uC2, 0.3);
	col += field(p, vec2(a * (0.64 + 0.1 * sin(t * 1.21)), 0.24 + 0.08 * cos(t * 0.97)), 0.06 + 0.03 * uHigh, uC4, 0.08 + 0.35 * uHigh);

	col *= uExposure;
	col = 1.0 - exp(-col * 1.2);
	col += (hash(gl_FragCoord.xy + uSeed) - 0.5) * uGrain;
	frag = vec4(col, 1.0);
}
`;

export const VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
void main() {
	gl_Position = vec4(aPos, 0.0, 1.0);
}
`;
