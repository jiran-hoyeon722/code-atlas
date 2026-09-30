export const BUILDING_VERT = /* glsl */ `
attribute vec3 aSize;
attribute vec3 aColor;
attribute float aSeed;
attribute float aFace;
attribute float aBase;
varying vec3 vLocal; varying vec3 vN; varying vec3 vColor; varying vec3 vSize; varying vec3 vWorld;
varying float vSeed; varying float vFace; varying float vBase;
void main() {
  vLocal = position; vSize = aSize; vColor = aColor; vSeed = aSeed; vFace = aFace; vBase = aBase;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Windows, door and sign band are procedural so the city needs no texture files; values above 1 feed the bloom pass.
export const BUILDING_FRAG = /* glsl */ `
uniform vec3 uFog; uniform float uFocus; uniform float uTime;
varying vec3 vLocal; varying vec3 vN; varying vec3 vColor; varying vec3 vSize; varying vec3 vWorld;
varying float vSeed; varying float vFace; varying float vBase;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 n = normalize(vN);
  float focus = 1.0 - step(0.5, abs(vSeed - uFocus));
  float light = 0.28 + 0.5 * max(dot(n, normalize(vec3(0.35, 0.85, 0.25))), 0.0);
  float y = vLocal.y * vSize.y + vBase;
  vec3 col = vColor * 0.32 * light * (0.75 + 0.25 * smoothstep(0.0, 30.0, y));
  float side = 1.0 - step(0.9, abs(n.y));
  vec2 f = vec2(abs(n.x) > 0.5 ? vLocal.z * vSize.z : vLocal.x * vSize.x, y);
  vec2 g = fract(f / vec2(3.0, 3.5));
  vec2 cell = floor(f / vec2(3.0, 3.5)) + vec2(n.x * 7.0 + n.z * 3.0, 0.0);
  float win = step(0.2, g.x) * step(g.x, 0.8) * step(0.26, g.y) * step(g.y, 0.8) * step(3.5, y) * step(vLocal.y * vSize.y, vSize.y - 0.7);
  float frame = step(0.16, g.x) * step(g.x, 0.84) * step(0.22, g.y) * step(g.y, 0.84) * (1.0 - win) * step(3.5, y);
  float epoch = floor(uTime * 0.07 + hash(cell + vSeed) * 9.0);
  float lit = step(0.5, hash(cell + vec2(vSeed * 13.1 + epoch * 0.37, 0.0)));
  float warm = hash(cell * 1.7 + vSeed);
  vec3 bulb = mix(vec3(1.0, 0.72, 0.4), vec3(0.5, 0.65, 1.0), step(0.82, warm)) * (0.55 + 0.6 * hash(cell + 3.0));
  vec3 glass = mix(vec3(0.03, 0.045, 0.08) + 0.05 * vColor, bulb, lit);
  col = mix(col, glass, win * side);
  col = mix(col, col * 1.4 + 0.01, frame * side);
  float ground = 1.0 - step(0.5, vBase);
  float front = step(0.5, n.z * vFace) * ground;
  float pulse = 0.5 + 0.5 * sin(uTime * 3.2);
  float door = front * step(abs(f.x), 1.1) * step(y, 2.7);
  col = mix(col, vec3(0.85, 0.6, 0.33) * (1.0 + focus * (0.12 + 0.18 * pulse)), door);
  float awning = front * step(2.8, y) * step(y, 3.35);
  col = mix(col, vColor * (0.55 + focus * 0.35), awning);
  if (n.y > 0.9) col = vColor * 0.12 + 0.025;
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
uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uGlow;
varying vec3 vDir;
void main() {
  float h = max(vDir.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
  col += uGlow * pow(1.0 - h, 6.0) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`;
