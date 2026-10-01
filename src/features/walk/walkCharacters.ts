import * as THREE from 'three';

export type CharacterId = 'bolt' | 'ninja' | 'astro' | 'king' | 'hacker';

/** Head size in metres; gear is built with its origin on top of the head, +Y up and +Z facing forward. */
export interface HeadSize { w: number; h: number; d: number }

export interface Character {
  id: CharacterId;
  name: string;
  blurb: string;
  /** Accent for name tags, the mini-map and the picker. */
  color: string;
  body: string;
  joint: string;
  glow: string;
  gear(head: HeadSize): THREE.Object3D;
}

const mat = (color: string, opts: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...opts });
const part = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
};

export const CHARACTERS: Character[] = [
  {
    id: 'bolt', name: '볼트', blurb: '안테나를 단 원조 오렌지 로봇', color: '#f2a93b',
    body: '#c9741c', joint: '#5f5e55', glow: '#ffd27a',
    gear({ w }) {
      const g = new THREE.Group();
      g.add(part(new THREE.CylinderGeometry(w * 0.025, w * 0.035, w * 0.38, 8), mat('#5f5e55'), 0, w * 0.17));
      g.add(part(new THREE.SphereGeometry(w * 0.08, 14, 10), mat('#ffd27a', { emissive: '#ffb02e', emissiveIntensity: 1.4 }), 0, w * 0.39));
      return g;
    },
  },
  {
    id: 'ninja', name: '닌자', blurb: '빨간 머리띠를 맨 그림자 로봇', color: '#e8554e',
    body: '#2c3148', joint: '#15171f', glow: '#ff4b3e',
    gear({ w, h, d }) {
      const g = new THREE.Group();
      const red = mat('#d8342c');
      g.add(part(new THREE.BoxGeometry(w * 1.04, h * 0.2, d * 1.08), red, 0, -h * 0.44));
      [-1, 1].forEach((side) => {
        const tail = part(new THREE.BoxGeometry(w * 0.09, h * 0.1, w * 0.5), red, side * w * 0.09, -h * 0.48, -d * 0.54 - w * 0.22);
        tail.rotation.set(-0.5, side * 0.35, 0);
        g.add(tail);
      });
      return g;
    },
  },
  {
    id: 'astro', name: '우주인', blurb: '유리 헬멧을 쓴 탐사 로봇', color: '#6fd3ff',
    body: '#e6ebf2', joint: '#7d8798', glow: '#5fe3ff',
    gear({ w, h, d }) {
      const g = new THREE.Group();
      const r = Math.max(w, h, d) * 0.72;
      const glass = mat('#bfeaff', { transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.2, depthWrite: false });
      const dome = part(new THREE.SphereGeometry(r, 28, 18), glass, 0, -h * 0.5);
      dome.castShadow = false;
      g.add(dome);
      const collar = part(new THREE.TorusGeometry(r * 0.5, r * 0.07, 8, 28), mat('#7d8798', { metalness: 0.5 }), 0, -h * 0.5 - r * 0.82);
      collar.rotation.x = Math.PI / 2;
      g.add(collar);
      return g;
    },
  },
  {
    id: 'king', name: '킹', blurb: '금관을 쓴 보라색 로봇', color: '#b98bff',
    body: '#6a3fc4', joint: '#c9a23c', glow: '#ffd75e',
    gear({ w }) {
      const g = new THREE.Group();
      const gold = mat('#e2b43c', { metalness: 0.75, roughness: 0.3 });
      const r = w * 0.3;
      g.add(part(new THREE.CylinderGeometry(r, r * 0.95, w * 0.16, 20, 1, true), gold, 0, w * 0.06));
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        g.add(part(new THREE.ConeGeometry(w * 0.06, w * 0.16, 6), gold, Math.sin(a) * r, w * 0.22, Math.cos(a) * r));
      }
      g.add(part(new THREE.OctahedronGeometry(w * 0.055), mat('#ff3e6c', { emissive: '#ff1f4f', emissiveIntensity: 0.8 }), 0, w * 0.07, r + w * 0.02));
      return g;
    },
  },
  {
    id: 'hacker', name: '해커', blurb: '헤드폰을 낀 초록 로봇', color: '#3ec48a',
    body: '#25a066', joint: '#1d2621', glow: '#39ff7a',
    gear({ w, h }) {
      const g = new THREE.Group();
      const dark = mat('#20252b');
      const band = part(new THREE.TorusGeometry(w * 0.56, w * 0.045, 8, 24, Math.PI), dark, 0, -h * 0.45);
      g.add(band);
      [-1, 1].forEach((side) => {
        const cup = part(new THREE.CylinderGeometry(w * 0.17, w * 0.17, w * 0.12, 18), dark, side * w * 0.56, -h * 0.45);
        cup.rotation.z = Math.PI / 2;
        g.add(cup);
        const light = part(new THREE.CylinderGeometry(w * 0.09, w * 0.09, w * 0.02, 14), mat('#39ff7a', { emissive: '#39ff7a', emissiveIntensity: 1.2 }), side * w * 0.63, -h * 0.45);
        light.rotation.z = Math.PI / 2;
        g.add(light);
      });
      return g;
    },
  },
];

export const characterById = (id: string | null | undefined) => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];

/** Everyone but the player's pick, shuffled, so each rival wears a different design from the player and each other. */
export function dealCharacters(player: CharacterId, count: number, random: () => number): Character[] {
  const pool = CHARACTERS.filter((c) => c.id !== player);
  for (let k = pool.length - 1; k > 0; k--) {
    const j = Math.floor(random() * (k + 1));
    [pool[k], pool[j]] = [pool[j], pool[k]];
  }
  return Array.from({ length: count }, (_, k) => pool[k % pool.length]);
}
