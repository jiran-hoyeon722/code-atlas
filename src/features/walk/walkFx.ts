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
