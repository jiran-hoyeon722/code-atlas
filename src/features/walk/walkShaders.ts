export const BUILDING_VERT = /* glsl */ `
attribute vec3 aSize;
attribute vec3 aColor;
attribute float aSeed;
attribute float aFace;
attribute float aBase;
attribute float aInfect;
attribute float aCap;
varying vec3 vLocal; varying vec3 vN; varying vec3 vColor; varying vec3 vSize; varying vec3 vWorld;
varying float vSeed; varying float vFace; varying float vBase; varying float vInfect;
float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 p = position;
  // A broken building loses a jagged chunk of its roof and leans a little; only the top part moves so tiers stay stacked.
  float corner = vhash(vec2(aSeed, position.x * 3.1 + position.z * 7.7));
  float top = step(0.5, position.y) * aCap;
  p.y -= top * aInfect * (0.06 + 0.2 * corner);
  p.x += aInfect * position.y * (vhash(vec2(aSeed, 1.7)) - 0.5) * 0.05;
  vLocal = p; vSize = aSize; vColor = aColor; vSeed = aSeed; vFace = aFace; vBase = aBase; vInfect = aInfect;
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Windows, door and sign band are procedural so the city needs no texture files; values above 1 feed the bloom pass.
export const BUILDING_FRAG = /* glsl */ `
uniform vec3 uFog; uniform float uFocus; uniform float uTime; uniform float uDay; uniform float uLit; uniform vec3 uSunDir; uniform vec3 uSky;
uniform float uOrigin;
varying vec3 vLocal; varying vec3 vN; varying vec3 vColor; varying vec3 vSize; varying vec3 vWorld;
varying float vSeed; varying float vFace; varying float vBase; varying float vInfect;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 u = fract(p); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Voronoi: distance to the nearest and second-nearest cell point plus the nearest cell's id, for shattered-concrete cracks.
vec3 voronoi(vec2 p) {
  vec2 i = floor(p); vec2 fr = fract(p);
  float f1 = 8.0; float f2 = 8.0; float id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 r = o + vec2(hash(i + o), hash(i + o + 17.3)) - fr;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = hash(i + o + 3.1); } else if (d < f2) f2 = d;
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
void main() {
  vec3 n = normalize(vN);
  float focus = 1.0 - step(0.5, abs(vSeed - uFocus));
  float light = mix(0.28, 0.45, uDay) + mix(0.5, 0.75, uDay) * max(dot(n, normalize(uSunDir)), 0.0);
  float y = vLocal.y * vSize.y + vBase;
  vec3 col = vColor * mix(0.32, 0.72, uDay) * light * (0.75 + 0.25 * smoothstep(0.0, 30.0, y));
  float side = 1.0 - step(0.9, abs(n.y));
  vec2 f = vec2(abs(n.x) > 0.5 ? vLocal.z * vSize.z : vLocal.x * vSize.x, y);
  vec2 g = fract(f / vec2(3.0, 3.5));
  vec2 cell = floor(f / vec2(3.0, 3.5)) + vec2(n.x * 7.0 + n.z * 3.0, 0.0);
  float win = step(0.2, g.x) * step(g.x, 0.8) * step(0.26, g.y) * step(g.y, 0.8) * step(3.5, y) * step(vLocal.y * vSize.y, vSize.y - 0.7);
  float frame = step(0.16, g.x) * step(g.x, 0.84) * step(0.22, g.y) * step(g.y, 0.84) * (1.0 - win) * step(3.5, y);
  float epoch = floor(uTime * 0.07 + hash(cell + vSeed) * 9.0);
  float lit = step(1.0 - uLit, hash(cell + vec2(vSeed * 13.1 + epoch * 0.37, 0.0)));
  float inf = vInfect;
  // Infected windows are smashed: most go dark, a few flicker the virus green.
  float smashed = step(hash(cell + vSeed * 5.3), inf * 0.85);
  float glitch = step(0.6, hash(cell + vec2(floor(uTime * 9.0), vSeed)));
  lit *= 1.0 - smashed;
  float warm = hash(cell * 1.7 + vSeed);
  vec3 bulb = mix(vec3(1.0, 0.72, 0.4), vec3(0.5, 0.65, 1.0), step(0.82, warm)) * (0.55 + 0.6 * hash(cell + 3.0));
  // Interior mapping: march the view ray into a 3 x 3.5 x 4 m room behind each window.
  vec3 V = normalize(vWorld - cameraPosition);
  vec3 T = abs(n.x) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 d = vec3(dot(V, T), V.y, max(0.05, dot(V, -n)));
  vec2 p = g * vec2(3.0, 3.5);
  float tx = d.x > 0.0 ? (3.0 - p.x) / d.x : -p.x / min(d.x, -1e-4);
  float ty = d.y > 0.0 ? (3.5 - p.y) / d.y : -p.y / min(d.y, -1e-4);
  float tz = 4.0 / d.z;
  float t = min(min(tx, ty), tz);
  vec3 hit = vec3(p, 0.0) + d * t;
  float rs = hash(cell + vSeed * 3.7);
  vec3 wall = mix(vec3(0.9, 0.82, 0.7), vec3(0.62, 0.72, 0.9), step(0.7, rs));
  vec3 room = wall * 0.85;
  if (t == tx) room = wall * 0.6;
  if (t == ty) room = d.y > 0.0 ? wall * (1.05 + 0.6 * smoothstep(0.9, 0.0, distance(hit.xz, vec2(1.5, 2.0)))) : wall * 0.32;
  if (t == tz) {
    float fx = 0.3 + rs * 1.4;
    float furniture = step(fx, hit.x) * step(hit.x, fx + 0.8 + rs) * step(hit.y, 0.7 + rs * 0.9);
    room = mix(room, wall * 0.18, furniture);
  }
  room *= 1.0 - clamp(t / 9.0, 0.0, 0.55);
  vec3 lamp = bulb * room * mix(1.0, 0.5, uDay);
  vec3 dark = (vec3(0.02, 0.03, 0.06) + 0.04 * vColor) * (0.6 + 0.4 * room);
  vec3 daylit = mix(room * vec3(0.28, 0.3, 0.33), uSky * 0.75, 0.35 + 0.5 * pow(1.0 - d.z, 2.0));
  vec3 glass = mix(mix(dark, daylit, uDay), lamp, lit) + mix(vec3(0.02, 0.03, 0.05), uSky * 0.3, uDay) * pow(1.0 - d.z, 3.0);
  glass = mix(glass, mix(vec3(0.01), vec3(0.2, 1.8, 0.5), glitch * 0.6), smashed);
  col = mix(col, glass, win * side);
  col = mix(col, col * 1.4 + 0.01, frame * side);
  float ground = 1.0 - step(0.5, vBase);
  float front = step(0.5, n.z * vFace) * ground;
  float pulse = 0.5 + 0.5 * sin(uTime * 3.2);
  float door = front * step(abs(f.x), 1.1) * step(y, 2.7);
  col = mix(col, mix(vec3(0.85, 0.6, 0.33), vec3(0.42, 0.34, 0.26), uDay) * (1.0 + focus * (0.12 + 0.18 * pulse)), door);
  float awning = front * step(2.8, y) * step(y, 3.35);
  col = mix(col, vColor * (0.55 + focus * 0.35), awning);
  if (n.y > 0.9) col = vColor * mix(0.12, 0.42, uDay) + 0.025;
  if (inf > 0.001) {
    // Broken look: soot creeping up from the ground, a shattered crack network, and chunks of wall knocked out.
    vec3 cv = voronoi(f * 1.1 + vSeed * 3.1);
    float edge = cv.y - cv.x;
    float reach = smoothstep(0.62 - inf * 0.45, 0.8 - inf * 0.45, vnoise(f * 0.09 + vSeed * 1.7));
    float crack = smoothstep(0.035, 0.0, edge) * reach;
    float hole = step(1.0 - inf * 0.12, cv.z) * reach * step(0.5, y - vBase);
    float lip = hole * smoothstep(0.16, 0.03, edge);
    float soot = smoothstep(vSize.y * 0.7 * inf, 0.0, y - vBase) * inf;
    col = mix(col, vec3(dot(col, vec3(0.3, 0.5, 0.2))) * vec3(0.72, 0.74, 0.68), inf * 0.55);
    col *= 1.0 - soot * 0.5 * side;
    col = mix(col, col * 0.12, crack * side);
    vec3 cavity = mix(vec3(0.006, 0.008, 0.006), vec3(0.03, 0.16, 0.06), 0.3 + 0.3 * sin(uTime * 2.5 + cv.z * 20.0));
    col = mix(col, cavity, hole * side);
    col = mix(col, vec3(0.2, 0.19, 0.17) * mix(0.45, 0.9, uDay), lip * side);
    col += vec3(0.1, 0.6, 0.22) * crack * inf * 0.35 * step(0.55, hash(vec2(floor(uTime * 2.0), floor(cv.z * 50.0)))) * side;
    float band = step(0.99, hash(vec2(floor(y * 1.5), floor(uTime * 7.0) + vSeed))) * inf;
    col = mix(col, vec3(0.4, 1.1, 0.5), band * 0.3 * side);
  }
  float origin = 1.0 - step(0.5, abs(vSeed - uOrigin));
  col += origin * vec3(0.3, 2.2, 0.6) * pow(0.5 + 0.5 * sin(uTime * 5.0 - y * 0.35), 6.0) * side;
  col += focus * vec3(0.05, 0.06, 0.09) * side;
  col = mix(col, uFog, smoothstep(80.0, 430.0, distance(vWorld, cameraPosition)));
  gl_FragColor = vec4(col, 1.0);
}`;

export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const SKY_FRAG = /* glsl */ `
uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uGlow; uniform vec3 uSunDir; uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  float h = max(vDir.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
  col += uGlow * pow(1.0 - h, 6.0) * 0.6;
  float sun = max(dot(vDir, normalize(uSunDir)), 0.0);
  col += uSunColor * (pow(sun, 8.0) * 0.25 + pow(sun, 90.0) * 0.6);
  gl_FragColor = vec4(col, 1.0);
}`;
