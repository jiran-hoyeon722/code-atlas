import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

const DROPS = 9000;
const BOX = new THREE.Vector3(70, 34, 70);

const RAIN_VERT = /* glsl */ `
attribute float aEnd;
uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox;
varying float vFade;
void main() {
  vec3 p = position;
  p.y = mod(p.y - uTime * 26.0, uBox.y);
  p.xz = mod(p.xz - uCenter.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5 + uCenter.xz;
  p.y += aEnd * 0.7;
  p.x += aEnd * 0.08;
  vFade = aEnd;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFade = (1.0 - smoothstep(20.0, 60.0, -mv.z)) * mix(0.35, 1.0, aEnd);
  gl_Position = projectionMatrix * mv;
}`;

const RAIN_FRAG = /* glsl */ `
varying float vFade;
void main() { gl_FragColor = vec4(vec3(0.62, 0.7, 0.85) * 0.55, vFade * 0.5); }`;

// Reflector samples the mirrored scene; puddle noise decides where the road reads as a mirror, rain ripples wobble it.
const WET_SHADER = {
  name: 'WetRoad',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uFog: { value: new THREE.Color() },
    uBase: { value: new THREE.Color('#15171d') },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv; varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec3 uFog; uniform vec3 uBase;
    varying vec4 vUv; varying vec3 vWorld;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    void main() {
      float puddle = smoothstep(0.5, 0.72, noise(vWorld.xz * 0.12) * 0.7 + noise(vWorld.xz * 0.5) * 0.3);
      vec2 cell = floor(vWorld.xz * 1.3);
      vec2 local = fract(vWorld.xz * 1.3) - 0.5;
      float start = hash(cell) * 3.0;
      float age = fract((uTime + start) / 1.2);
      float ring = smoothstep(0.06, 0.0, abs(length(local) - age * 0.5)) * (1.0 - age);
      vec4 uv = vUv;
      uv.xy += (local * ring * 0.08 + vec2(noise(vWorld.xz * 2.0 + uTime), noise(vWorld.zx * 2.0 - uTime)) * 0.012) * uv.w;
      vec3 refl = texture2DProj(tDiffuse, uv).rgb;
      float wet = mix(0.2, 0.72, puddle);
      vec3 col = uBase * (1.0 - puddle * 0.5) + refl * wet;
      col += ring * 0.03 * puddle;
      col = mix(col, uFog, smoothstep(80.0, 430.0, distance(vWorld, cameraPosition)));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export interface Rain {
  readonly enabled: boolean;
  set(on: boolean): void;
  update(time: number, center: THREE.Vector3): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

export function createRain(scene: THREE.Scene, ground: THREE.Mesh, fog: THREE.Color, random: () => number): Rain {
  const pos = new Float32Array(DROPS * 2 * 3);
  const end = new Float32Array(DROPS * 2);
  for (let k = 0; k < DROPS; k++) {
    const x = (random() - 0.5) * BOX.x, y = random() * BOX.y, z = (random() - 0.5) * BOX.z;
    pos.set([x, y, z, x, y, z], k * 6);
    end.set([0, 1], k * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const rainUniforms = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: BOX } };
  const mat = new THREE.ShaderMaterial({ vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, uniforms: rainUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);

  const plane = ground.geometry as THREE.PlaneGeometry;
  const mirror = new Reflector(plane, { textureWidth: 512, textureHeight: 512, clipBias: 0.003, shader: WET_SHADER });
  mirror.position.copy(ground.position).setY(0.004);
  mirror.rotation.copy(ground.rotation);
  const wet = mirror.material as THREE.ShaderMaterial;
  wet.uniforms.uFog.value = fog;
  scene.add(mirror);

  let enabled = false;
  const set = (on: boolean) => {
    enabled = on;
    lines.visible = on;
    mirror.visible = on;
    ground.visible = !on;
  };
  set(true);
  return {
    get enabled() { return enabled; },
    set,
    update(time, center) {
      rainUniforms.uTime.value = time;
      rainUniforms.uCenter.value.copy(center);
      wet.uniforms.uTime.value = time;
    },
    resize(w, h) {
      mirror.getRenderTarget().setSize(Math.round(w * 0.5), Math.round(h * 0.5));
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mirror.dispose();
      scene.remove(lines, mirror);
    },
  };
}
