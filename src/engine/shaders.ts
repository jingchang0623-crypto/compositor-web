// GLSL for the compositor. Every pass is one full-target triangle; positions are in target pixels with y down, as
// document pixels are.

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }
`

const BLEND_GLSL = /* glsl */ `
float colorDodge(float b, float s) { return b <= 0.0 ? 0.0 : s >= 1.0 ? 1.0 : min(1.0, b / (1.0 - s)); }
float colorBurn(float b, float s) { return b >= 1.0 ? 1.0 : s <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b) / s); }
float screenF(float b, float s) { return b + s - b * s; }
float hardLight(float b, float s) { return s <= 0.5 ? b * 2.0 * s : screenF(b, 2.0 * s - 1.0); }
float softLight(float b, float s) {
  if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return b + (2.0 * s - 1.0) * (d - b);
}
float separable(int mode, float b, float s) {
  switch (mode) {
    case 0: return s;                                   // Normal
    case 1: return min(b, s);                           // Darken
    case 2: return b * s;                               // Multiply
    case 3: return colorBurn(b, s);                     // Color Burn
    case 4: return max(0.0, b + s - 1.0);               // Linear Burn
    case 5: return max(b, s);                           // Lighten
    case 6: return screenF(b, s);                       // Screen
    case 7: return colorDodge(b, s);                    // Color Dodge
    case 8: return min(1.0, b + s);                     // Linear Dodge (Add)
    case 9: return hardLight(s, b);                     // Overlay
    case 10: return softLight(b, s);                    // Soft Light
    case 11: return hardLight(b, s);                    // Hard Light
    case 12: return s <= 0.5 ? colorBurn(b, 2.0 * s) : colorDodge(b, 2.0 * s - 1.0); // Vivid Light
    case 13: return clamp(b + 2.0 * s - 1.0, 0.0, 1.0); // Linear Light
    case 14: return s <= 0.5 ? min(b, 2.0 * s) : max(b, 2.0 * s - 1.0);                // Pin Light
    case 15: return b + s >= 1.0 ? 1.0 : 0.0;           // Hard Mix
    case 16: return abs(b - s);                         // Difference
    case 17: return b + s - 2.0 * b * s;                // Exclusion
    case 18: return max(0.0, b - s);                    // Subtract
    case 19: return b <= 0.0 ? 0.0 : s <= 0.0 ? 1.0 : min(1.0, b / s); // Divide
  }
  return s;
}
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c) {
  float l = lum(c), n = min(min(c.r, c.g), c.b), x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / (l - n);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }
float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
vec3 setSat(vec3 c, float s) {
  float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
  return mx > mn ? (c - mn) * s / (mx - mn) : vec3(0.0);
}
vec3 blendColor(int mode, vec3 b, vec3 s) {
  if (mode < 20) return vec3(separable(mode, b.r, s.r), separable(mode, b.g, s.g), separable(mode, b.b, s.b));
  if (mode == 20) return setLum(setSat(s, sat(b)), lum(b)); // Hue
  if (mode == 21) return setLum(setSat(b, sat(s)), lum(b)); // Saturation
  if (mode == 22) return setLum(s, lum(b));                 // Color
  return setLum(b, lum(s));                                 // Luminosity
}
`

/** Layer kinds the layer pass draws. */
export const KIND = { pixels: 0, channels: 1, cube: 2, passthrough: 3 } as const
export const MAX_MASKS = 4

export const LAYER_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;

uniform sampler2D uBackdrop;
uniform vec2 uTargetSize;
uniform int uKind;
uniform int uMode;
uniform bool uDirect;     // Normal pixels drawn by the blending hardware: output the layer, premultiplied, by coverage
uniform float uOpacity;

uniform sampler2D uLayer;
uniform mat3 uToUnit;     // target px → the layer's unit square
uniform vec2 uUnitPx;     // target px per unit, along each axis (for soft edges)

uniform int uMaskCount;
uniform sampler2D uMask0, uMask1, uMask2, uMask3;
uniform mat3 uToMask0, uToMask1, uToMask2, uToMask3;

uniform sampler2D uLut;   // 256×1, per-channel tables
uniform sampler3D uCube;
uniform float uCubeSize;

out vec4 outColor;
${BLEND_GLSL}

float edge(vec2 u, vec2 px) {
  vec2 d = min(u, 1.0 - u) * px + 0.5;
  return clamp(d.x, 0.0, 1.0) * clamp(d.y, 0.0, 1.0);
}
float maskAt(sampler2D m, mat3 toMask, vec2 p) {
  vec2 u = (toMask * vec3(p, 1.0)).xy;
  return texture(m, clamp(u, 0.0, 1.0)).r;
}

void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy);
  vec2 p = vec2(gl_FragCoord.x, uTargetSize.y - gl_FragCoord.y);
  vec4 cb = texelFetch(uBackdrop, fc, 0);
  vec2 u = (uToUnit * vec3(p, 1.0)).xy;
  // Sampled before any branch that depends on the pixel, so mipmap selection sees smooth derivatives.
  vec4 cs = uKind == 0 ? texture(uLayer, u) : vec4(0.0);

  float coverage = edge(u, uUnitPx) * uOpacity;
  if (uMaskCount > 0) coverage *= maskAt(uMask0, uToMask0, p);
  if (uMaskCount > 1) coverage *= maskAt(uMask1, uToMask1, p);
  if (uMaskCount > 2) coverage *= maskAt(uMask2, uToMask2, p);
  if (uMaskCount > 3) coverage *= maskAt(uMask3, uToMask3, p);

  if (uDirect) {
    outColor = cs * coverage;
    return;
  }
  vec3 Cb = cb.a > 0.0 ? cb.rgb / cb.a : vec3(0.0);
  if (uKind == 0) {
    vec3 Cs = cs.a > 0.0 ? cs.rgb / cs.a : vec3(0.0);
    vec3 B = clamp(blendColor(uMode, Cb, Cs), 0.0, 1.0);
    float as = cs.a * coverage;
    vec3 mixed = (1.0 - cb.a) * Cs + cb.a * B;
    outColor = vec4(as * mixed + (1.0 - as) * cb.rgb, as + cb.a * (1.0 - as));
    return;
  }
  // An adjustment: the backdrop, changed, blended back over itself. Alpha stays the backdrop's.
  vec3 adjusted = Cb;
  if (uKind == 1) {
    vec3 x = (Cb * 255.0 + 0.5) / 256.0;
    adjusted = vec3(texture(uLut, vec2(x.r, 0.5)).r, texture(uLut, vec2(x.g, 0.5)).g, texture(uLut, vec2(x.b, 0.5)).b);
  } else if (uKind == 2) {
    adjusted = texture(uCube, (Cb * (uCubeSize - 1.0) + 0.5) / uCubeSize).rgb;
  }
  vec3 B = clamp(blendColor(uMode, Cb, adjusted), 0.0, 1.0);
  outColor = vec4(mix(Cb, B, coverage) * cb.a, cb.a);
}
`

/** The composite onto the screen: a checkerboard under the document, the pasteboard around it. */
export const PRESENT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uComposite;
uniform vec2 uTargetSize;
uniform vec4 uDocRect;    // x0, y0, x1, y1 in target px, y down
uniform float uChecker;   // checker square size in target px
out vec4 outColor;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uTargetSize.y - gl_FragCoord.y);
  if (p.x < uDocRect.x || p.y < uDocRect.y || p.x >= uDocRect.z || p.y >= uDocRect.w) {
    outColor = vec4(0.16, 0.16, 0.17, 1.0);
    return;
  }
  vec2 cell = floor((p - uDocRect.xy) / uChecker);
  float checker = mod(cell.x + cell.y, 2.0) < 1.0 ? 1.0 : 0.8;
  vec4 c = texelFetch(uComposite, ivec2(gl_FragCoord.xy), 0);
  outColor = vec4(c.rgb + (1.0 - c.a) * checker, 1.0);
}
`

/** A cached document composite onto the screen: the document at a reduced scale, sampled through its mipmaps. */
export const PRESENT_CACHE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uCache;
uniform vec2 uTargetSize;
uniform vec3 uView;       // scale, x, y: document px → target px
uniform vec2 uDocSize;
uniform vec2 uUvScale;    // document px → cache texture coordinates
uniform float uChecker;
out vec4 outColor;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uTargetSize.y - gl_FragCoord.y);
  vec2 doc = (p - uView.yz) / uView.x;
  // Surfaces are written with GL's rows, bottom up: the document's top row is the texture's last.
  // Sampled before the branch, so mipmap selection sees smooth derivatives.
  vec2 uv = doc * uUvScale;
  vec4 c = texture(uCache, vec2(uv.x, 1.0 - uv.y));
  if (doc.x < 0.0 || doc.y < 0.0 || doc.x >= uDocSize.x || doc.y >= uDocSize.y) {
    outColor = vec4(0.16, 0.16, 0.17, 1.0);
    return;
  }
  vec2 cell = floor((p - uView.yz) / uChecker);
  float checker = mod(cell.x + cell.y, 2.0) < 1.0 ? 1.0 : 0.8;
  outColor = vec4(c.rgb + (1.0 - c.a) * checker, 1.0);
}
`
