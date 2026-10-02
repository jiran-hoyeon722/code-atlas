import * as THREE from 'three';

const SPARKS = 160;

export interface Sparks {
  burst(x: number, y: number, z: number, count: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createSparks(scene: THREE.Scene): Sparks {
  const pos = new Float32Array(SPARKS * 3);
  const vel = new Float32Array(SPARKS * 3);
  const life = new Float32Array(SPARKS);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: new THREE.Color('#ffb347').multiplyScalar(3), size: 0.18, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  let next = 0;
  for (let k = 0; k < SPARKS; k++) pos[k * 3 + 1] = -100;
  return {
    burst(x, y, z, count) {
      for (let n = 0; n < count; n++) {
        const k = next;
        next = (next + 1) % SPARKS;
        pos.set([x, y, z], k * 3);
        const a = Math.random() * Math.PI * 2;
        const s = 3 + Math.random() * 7;
        vel.set([Math.cos(a) * s, 2 + Math.random() * 5, Math.sin(a) * s], k * 3);
        life[k] = 0.4 + Math.random() * 0.5;
      }
    },
    update(dt) {
      let alive = false;
      for (let k = 0; k < SPARKS; k++) {
        if (life[k] <= 0) continue;
        alive = true;
        life[k] -= dt;
        vel[k * 3 + 1] -= 18 * dt;
        pos[k * 3] += vel[k * 3] * dt;
        pos[k * 3 + 1] = Math.max(0.05, pos[k * 3 + 1] + vel[k * 3 + 1] * dt);
        pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
        if (life[k] <= 0) pos[k * 3 + 1] = -100;
      }
      if (alive) geo.attributes.position.needsUpdate = true;
    },
    dispose() {
      scene.remove(points);
      geo.dispose();
      mat.dispose();
    },
  };
}

export interface Markers {
  /** Floats an "E <verb>" bubble and a pulsing ring over whatever the player can board, or hides both. */
  update(time: number, target: { x: number; z: number } | null, verb: string): void;
  dispose(): void;
}

export function createMarkers(scene: THREE.Scene): Markers {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const bubble = new THREE.Sprite(spriteMat);
  bubble.scale.set(1.9, 0.72, 1);
  bubble.renderOrder = 10;
  const ringGeo = new THREE.RingGeometry(2.2, 2.55, 48).rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#7c93f5').multiplyScalar(1.8), transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  bubble.visible = ring.visible = false;
  scene.add(bubble, ring);
  let painted = '';
  const paint = (verb: string) => {
    const ctx = canvas.getContext('2d');
    if (!ctx || painted === verb) return;
    painted = verb;
    ctx.clearRect(0, 0, 256, 96);
    ctx.fillStyle = 'rgba(12,14,20,.9)';
    ctx.beginPath();
    ctx.roundRect(6, 6, 244, 70, 18);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(116, 76); ctx.lineTo(140, 76); ctx.lineTo(128, 92);
    ctx.fill();
    ctx.fillStyle = '#7c93f5';
    ctx.beginPath();
    ctx.roundRect(22, 20, 44, 44, 10);
    ctx.fill();
    ctx.fillStyle = '#0b0d12';
    ctx.font = '800 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('E', 44, 54);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 34px system-ui, sans-serif';
    ctx.fillText(verb, 150, 54);
    tex.needsUpdate = true;
  };
  return {
    update(time, target, verb) {
      bubble.visible = ring.visible = !!target;
      if (!target) return;
      paint(verb);
      bubble.position.set(target.x, 3.1 + Math.sin(time * 3) * 0.12, target.z);
      ring.position.set(target.x, 0.2, target.z);
      const pulse = 1 + Math.sin(time * 4) * 0.06;
      ring.scale.set(pulse, 1, pulse);
      ringMat.opacity = 0.45 + Math.sin(time * 4) * 0.25;
    },
    dispose() {
      scene.remove(bubble, ring);
      tex.dispose();
      spriteMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
    },
  };
}

export interface Motes {
  /** Puffs `count` particles out of (x, y, z) in every direction, drifting up by `rise`. */
  burst(x: number, y: number, z: number, count: number, speed: number, rise: number, life: number): void;
  /** Particles start on a ring of `radius` around the point and arrive at it after `life` seconds. */
  converge(x: number, y: number, z: number, radius: number, count: number, life: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createMotes(scene: THREE.Scene, capacity: number, color: THREE.Color, size: number, additive: boolean): Motes {
  const pos = new Float32Array(capacity * 3);
  const vel = new Float32Array(capacity * 3);
  const life = new Float32Array(capacity);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color, size, transparent: true, depthWrite: false, opacity: additive ? 1 : 0.55,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  // Idle particles are not drawn at all: a software renderer chokes on a thousand parked points every frame.
  points.visible = false;
  scene.add(points);
  for (let k = 0; k < capacity; k++) pos[k * 3 + 1] = -100;
  let next = 0;
  const put = (x: number, y: number, z: number, vx: number, vy: number, vz: number, l: number) => {
    const k = next;
    next = (next + 1) % capacity;
    pos.set([x, y, z], k * 3);
    vel.set([vx, vy, vz], k * 3);
    life[k] = l;
  };
  return {
    burst(x, y, z, count, speed, rise, l) {
      for (let n = 0; n < count; n++) {
        const a = Math.random() * Math.PI * 2;
        const s = speed * (0.3 + Math.random() * 0.7);
        put(x, y + Math.random() * 0.5, z, Math.cos(a) * s, rise * (0.5 + Math.random()), Math.sin(a) * s, l * (0.6 + Math.random() * 0.6));
      }
    },
    converge(x, y, z, radius, count, l) {
      for (let n = 0; n < count; n++) {
        const a = Math.random() * Math.PI * 2;
        const r = radius * (0.6 + Math.random() * 0.4);
        const h = Math.random() * radius * 0.5;
        const t = l * (0.7 + Math.random() * 0.3);
        put(x + Math.cos(a) * r, y + h, z + Math.sin(a) * r, -Math.cos(a) * r / t, -h / t, -Math.sin(a) * r / t, t);
      }
    },
    update(dt) {
      let alive = false;
      for (let k = 0; k < capacity; k++) {
        if (life[k] <= 0) continue;
        alive = true;
        life[k] -= dt;
        pos[k * 3] += vel[k * 3] * dt;
        pos[k * 3 + 1] += vel[k * 3 + 1] * dt;
        pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
        if (life[k] <= 0) pos[k * 3 + 1] = -100;
      }
      points.visible = alive;
      if (alive) geo.attributes.position.needsUpdate = true;
    },
    dispose() {
      scene.remove(points);
      geo.dispose();
      mat.dispose();
    },
  };
}

export interface Beacon {
  /** Plants the light pillar on a building footprint at (x, z) whose roof is at `top`. */
  show(x: number, z: number, top: number): void;
  hide(): void;
  /** 0 = night, 1 = day: glow washes out to white against a bright sky, so daytime leans on the solid core. */
  tone(day: number): void;
  update(time: number, dt: number): void;
  dispose(): void;
}

const COLUMN = 90;

// A pillar of light well above the fog line, so the origin can be spotted from anywhere in the city.
export function createBeacon(scene: THREE.Scene, vert: string, frag: string): Beacon {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const group = new THREE.Group();
  // A solid core stays green against a bright daytime sky, the additive halo makes it glow at night.
  const beam = (radius: number, strength: number, alpha: number, blending: THREE.Blending) => {
    const mat = keep(new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(blending === THREE.NormalBlending ? '#14c94a' : '#2bff6a') }, uTime: { value: 0 }, uStrength: { value: strength }, uAlpha: { value: alpha }, uSharp: { value: blending === THREE.NormalBlending ? 0.8 : 2 } },
    }));
    const mesh = new THREE.Mesh(keep(new THREE.CylinderGeometry(radius, radius * 1.15, 420, 24, 1, true).translate(0, 210, 0)), mat);
    mesh.frustumCulled = false;
    group.add(mesh);
    return mat;
  };
  const beams = [beam(3, 1, 1, THREE.NormalBlending), beam(3.4, 2.2, 0.8, THREE.AdditiveBlending), beam(9, 1.2, 0.35, THREE.AdditiveBlending)];
  const glowAt = beams.map((m) => m.uniforms.uStrength.value as number);
  const ringMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color('#39ff7a').multiplyScalar(2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  const ring = new THREE.Mesh(keep(new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2)), ringMat);
  group.add(ring);
  const pos = new Float32Array(COLUMN * 3);
  const seeds = Float32Array.from({ length: COLUMN }, () => Math.random());
  const geo = keep(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const smoke = new THREE.Points(geo, keep(new THREE.PointsMaterial({ color: new THREE.Color('#5dff8f').multiplyScalar(1.6), size: 1.4, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
  smoke.frustumCulled = false;
  group.add(smoke);
  group.visible = false;
  scene.add(group);
  let top = 0;
  return {
    show(x, z, roof) {
      top = roof;
      group.position.set(x, 0, z);
      group.visible = true;
    },
    hide() { group.visible = false; },
    tone(day) {
      beams.forEach((m, k) => { if (k > 0) m.uniforms.uStrength.value = glowAt[k] * (1 - day * 0.75); });
    },
    update(time) {
      if (!group.visible) return;
      beams.forEach((m) => { m.uniforms.uTime.value = time; });
      const pulse = (time * 0.6) % 1;
      ring.position.y = 0.25;
      ring.scale.setScalar(4 + pulse * 22);
      ringMat.opacity = (1 - pulse) * 0.9;
      for (let k = 0; k < COLUMN; k++) {
        const t = (seeds[k] + time * (0.08 + seeds[k] * 0.05)) % 1;
        const a = seeds[k] * 40 + time * 0.7;
        const r = 1 + t * 5 * seeds[(k + 7) % COLUMN];
        pos[k * 3] = Math.cos(a) * r;
        pos[k * 3 + 1] = top + t * 60;
        pos[k * 3 + 2] = Math.sin(a) * r;
      }
      geo.attributes.position.needsUpdate = true;
    },
    dispose() {
      scene.remove(group);
      owned.forEach((o) => o.dispose());
    },
  };
}

export type PathPoint = [number, number];

/** `count` evenly spaced points along a polyline starting `offset` metres in, each with the heading of its segment. */
export function alongPath(pts: PathPoint[], offset: number, step: number, count: number): { x: number; z: number; angle: number; s: number }[] {
  const out: { x: number; z: number; angle: number; s: number }[] = [];
  let seg = 1;
  let segStart = 0;
  for (let k = 0; k < count && pts.length > 1; k++) {
    const s = offset + k * step;
    while (seg < pts.length) {
      const len = Math.hypot(pts[seg][0] - pts[seg - 1][0], pts[seg][1] - pts[seg - 1][1]);
      if (s <= segStart + len && len > 0) break;
      segStart += len;
      seg++;
    }
    if (seg >= pts.length) break;
    const [x0, z0] = pts[seg - 1];
    const [x1, z1] = pts[seg];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const t = (s - segStart) / len;
    out.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, angle: Math.atan2(x1 - x0, z1 - z0), s });
  }
  return out;
}

export interface Guide {
  setPath(pts: PathPoint[] | null): void;
  update(time: number): void;
  dispose(): void;
}

const CHEVRONS = 34;
const CHEVRON_STEP = 3;

// Fluorescent arrows painted on the road that flow toward the origin (easy mode only).
export function createGuide(scene: THREE.Scene): Guide {
  const shape = new THREE.Shape();
  shape.moveTo(-0.9, -0.35); shape.lineTo(0, 0.45); shape.lineTo(0.9, -0.35); shape.lineTo(0.9, 0.1); shape.lineTo(0, 0.9); shape.lineTo(-0.9, 0.1);
  const geo = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const mesh = new THREE.InstancedMesh(geo, mat, CHEVRONS);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);
  const base = new THREE.Color('#c8ff3a').multiplyScalar(2.2);
  const color = new THREE.Color();
  mesh.setColorAt(0, base);
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let path: PathPoint[] | null = null;
  return {
    setPath(pts) { path = pts; },
    update(time) {
      if (!path) { mesh.count = 0; return; }
      const spots = alongPath(path, 2 + ((time * 5) % CHEVRON_STEP), CHEVRON_STEP, CHEVRONS);
      spots.forEach((p, k) => {
        q.setFromAxisAngle(up, p.angle);
        mesh.setMatrixAt(k, matrix.compose(v.set(p.x, 0.06, p.z), q, one));
        mesh.setColorAt(k, color.copy(base).multiplyScalar(Math.max(0.08, 1 - k / CHEVRONS)));
      });
      mesh.count = spots.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}
