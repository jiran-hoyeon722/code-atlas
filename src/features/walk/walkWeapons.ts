import * as THREE from 'three';

export type WeaponId = 'fist' | 'bat' | 'pipe' | 'pistol' | 'smg' | 'shotgun';

export interface Weapon {
  id: WeaponId;
  name: string;
  kind: 'melee' | 'gun';
  /** Damage to a rival, whose health is RIVAL_HP. */
  damage: number;
  /** Damage a rival holding it deals to the player, whose health is 100. */
  rivalDamage: number;
  range: number;
  cooldown: number;
  /** Keeps firing while the trigger is held. */
  auto?: boolean;
  icon: string;
}

export const RIVAL_HP = 10;

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
export const WEAPONS: Weapon[] = [
  { id: 'fist', name: '주먹', kind: 'melee', damage: 2, rivalDamage: 8, range: 2.2, cooldown: 0.45,
    icon: svg('<path d="M7 9.5V7a1.5 1.5 0 0 1 3 0v-.5a1.5 1.5 0 0 1 3 0V7a1.5 1.5 0 0 1 3 0v1a1.5 1.5 0 0 1 3 0V13a6 6 0 0 1-6 6h-1a5 5 0 0 1-5-5v-2.5a1.5 1.5 0 0 1 3 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>') },
  { id: 'bat', name: '야구방망이', kind: 'melee', damage: 3, rivalDamage: 12, range: 2.8, cooldown: 0.6,
    icon: svg('<path d="M4.5 19.5l1.2 1.2 2-2L18.8 9.6a3 3 0 0 0-4.4-4.4L5.3 16.3l-2 2z" fill="currentColor"/>') },
  { id: 'pipe', name: '쇠파이프', kind: 'melee', damage: 4, rivalDamage: 16, range: 3, cooldown: 0.85,
    icon: svg('<path d="M5 19L18 6" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><path d="M15.5 4.5l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>') },
  { id: 'pistol', name: '권총', kind: 'gun', damage: 2, rivalDamage: 7, range: 32, cooldown: 0.38,
    icon: svg('<path d="M3 7h16v4h-9l-1.5 7H5l1.5-7H3z" fill="currentColor"/><path d="M10 11v2.5h3" stroke="currentColor" stroke-width="1.4" fill="none"/>') },
  { id: 'smg', name: '기관단총', kind: 'gun', damage: 1, rivalDamage: 3, range: 26, cooldown: 0.09, auto: true,
    icon: svg('<path d="M2 8h18v3.5h-6.5L12 13v5H9v-4.5H6.5L5 17H2.5L4 11.5H2z" fill="currentColor"/><path d="M20 9h2" stroke="currentColor" stroke-width="1.4"/>') },
  { id: 'shotgun', name: '샷건', kind: 'gun', damage: 6, rivalDamage: 16, range: 13, cooldown: 1,
    icon: svg('<path d="M1.5 9h15v2.5h-15z" fill="currentColor"/><path d="M16.5 8.5h3l3 5.5-2.2 1.2-3.3-3.7h-.5z" fill="currentColor"/><path d="M8 11.5h5v2H8z" fill="currentColor"/>') },
];
export const weaponById = (id: WeaponId) => WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];

/** Hands every rival a different weapon, never bare fists. */
export function dealWeapons(count: number, random: () => number): Weapon[] {
  const pool = WEAPONS.filter((w) => w.id !== 'fist');
  for (let k = pool.length - 1; k > 0; k--) {
    const j = Math.floor(random() * (k + 1));
    [pool[k], pool[j]] = [pool[j], pool[k]];
  }
  return Array.from({ length: count }, (_, k) => pool[k % pool.length]);
}

/** Shotgun pellets spread out, so the damage falls off with distance. */
export const damageAt = (w: Weapon, distance: number) =>
  w.id === 'shotgun' ? Math.max(1, Math.round(w.damage * (1 - Math.min(1, distance / w.range) * 0.7))) : w.damage;

export interface HeldWeapon {
  readonly id: WeaponId;
  set(id: WeaponId): void;
  /** Aims the right arm along `aim` (a unit vector, or null to let the animation drive it) and puts the weapon in the hand. */
  follow(rig: THREE.Object3D | null, aim: THREE.Vector3 | null, visible: boolean): void;
  /** World position of the muzzle or the tip of the club. */
  tip(out: THREE.Vector3): THREE.Vector3;
  kick(): void;
  dispose(): void;
}

export interface WeaponKit {
  hold(scene: THREE.Scene, id: WeaponId): HeldWeapon;
  dispose(): void;
}

type Bones = { upper: THREE.Bone; lower: THREE.Bone; palm: THREE.Bone };
const boneCache = new WeakMap<THREE.Object3D, Bones | null>();
function armBones(rig: THREE.Object3D): Bones | null {
  if (boneCache.has(rig)) return boneCache.get(rig)!;
  const find = (name: string) => {
    let hit: THREE.Bone | null = null;
    rig.traverse((o) => { if (!hit && (o as THREE.Bone).isBone && o.name === name) hit = o as THREE.Bone; });
    return hit as THREE.Bone | null;
  };
  const upper = find('UpperArmR'), lower = find('LowerArmR'), palm = find('Palm2R');
  const bones = upper && lower && palm ? { upper, lower, palm } : null;
  boneCache.set(rig, bones);
  return bones;
}

const va = new THREE.Vector3();
const vb = new THREE.Vector3();
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qc = new THREE.Quaternion();
// Rotates `bone` in world space so the segment towards `child` points along `dir`; works whatever the rig's local axes are.
function pointBone(bone: THREE.Bone, child: THREE.Object3D, dir: THREE.Vector3) {
  bone.getWorldPosition(va);
  child.getWorldPosition(vb);
  const cur = vb.sub(va).normalize();
  qa.setFromUnitVectors(cur, dir);
  bone.getWorldQuaternion(qb);
  bone.parent!.getWorldQuaternion(qc);
  bone.quaternion.copy(qc.invert().multiply(qa.multiply(qb)));
  bone.updateMatrixWorld(true);
}

export function createWeaponKit(): WeaponKit {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => keep(new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra }));
  const wood = mat('#a8743f', { roughness: 0.7 });
  const grip = mat('#1f1f24', { roughness: 0.9 });
  const steel = mat('#8f96a3', { metalness: 0.8, roughness: 0.35 });
  const gunmetal = mat('#2b2e35', { metalness: 0.6, roughness: 0.45 });
  const flashMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const geos = {
    bat: keep(new THREE.CylinderGeometry(0.055, 0.022, 0.9, 10).rotateX(Math.PI / 2).translate(0, 0, 0.38)),
    batGrip: keep(new THREE.CylinderGeometry(0.026, 0.026, 0.2, 8).rotateX(Math.PI / 2).translate(0, 0, -0.1)),
    pipe: keep(new THREE.CylinderGeometry(0.03, 0.03, 1.05, 10).rotateX(Math.PI / 2).translate(0, 0, 0.4)),
    pipeJoint: keep(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 10).rotateX(Math.PI / 2).translate(0, 0, 0.88)),
    flash: keep(new THREE.SphereGeometry(0.09, 8, 6)),
    box: keep(new THREE.BoxGeometry(1, 1, 1)),
    barrel: keep(new THREE.CylinderGeometry(1, 1, 1, 10).rotateX(Math.PI / 2)),
  };
  const part = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  // Every model is built along +Z from the grip, sights up (+Y), so one lookAt puts it in the hand.
  function build(id: WeaponId): { group: THREE.Group; tip: number } {
    const g = new THREE.Group();
    switch (id) {
      case 'fist': return { group: g, tip: 0.1 };
      case 'bat':
        part(g, geos.bat, wood);
        part(g, geos.batGrip, grip);
        return { group: g, tip: 0.8 };
      case 'pipe':
        part(g, geos.pipe, steel);
        part(g, geos.pipeJoint, steel);
        return { group: g, tip: 0.9 };
      case 'pistol':
        part(g, geos.box, gunmetal, 0, 0.07, 0.1, 0.05, 0.07, 0.26);
        part(g, geos.box, grip, 0, -0.02, 0, 0.045, 0.14, 0.06);
        return { group: g, tip: 0.24 };
      case 'smg':
        part(g, geos.box, gunmetal, 0, 0.06, 0.12, 0.06, 0.09, 0.4);
        part(g, geos.barrel, gunmetal, 0, 0.07, 0.38, 0.018, 0.018, 0.16);
        part(g, geos.box, grip, 0, -0.04, 0.02, 0.045, 0.14, 0.05);
        part(g, geos.box, grip, 0, -0.05, 0.16, 0.035, 0.18, 0.05);
        return { group: g, tip: 0.46 };
      case 'shotgun':
        part(g, geos.barrel, gunmetal, 0, 0.07, 0.3, 0.028, 0.028, 0.8);
        part(g, geos.box, wood, 0, 0.04, 0.2, 0.06, 0.06, 0.22);
        part(g, geos.box, wood, 0, 0.0, -0.14, 0.06, 0.12, 0.3);
        part(g, geos.box, grip, 0, -0.03, 0.02, 0.04, 0.1, 0.04);
        return { group: g, tip: 0.7 };
    }
  }

  return {
    hold(scene, id) {
      let current = id;
      let model = build(id);
      model.group.visible = false;
      const flash = new THREE.Mesh(geos.flash, flashMat);
      flash.visible = false;
      scene.add(model.group, flash);
      let recoil = 0;
      let flashFor = 0;
      const aimDir = new THREE.Vector3();
      const tipOut = new THREE.Vector3();
      const self: HeldWeapon = {
        get id() { return current; },
        set(next) {
          if (next === current) return;
          scene.remove(model.group);
          current = next;
          model = build(next);
          model.group.visible = false;
          scene.add(model.group);
        },
        follow(rig, aim, visible) {
          const bones = rig ? armBones(rig) : null;
          model.group.visible = visible && !!bones;
          if (!bones || !visible) { flash.visible = false; return; }
          if (aim) {
            aimDir.copy(aim).setY(aim.y - 0.08).normalize();
            pointBone(bones.upper, bones.lower, aimDir);
            pointBone(bones.lower, bones.palm, aimDir);
          }
          bones.palm.getWorldPosition(va);
          bones.lower.getWorldPosition(vb);
          const dir = va.clone().sub(vb).normalize();
          model.group.position.copy(va).addScaledVector(dir, 0.04 - recoil * 0.08);
          model.group.lookAt(va.clone().add(dir));
          model.group.updateMatrixWorld();
          recoil = Math.max(0, recoil - 0.12);
          flashFor = Math.max(0, flashFor - 1);
          flash.visible = flashFor > 0;
          if (flash.visible) flash.position.copy(self.tip(tipOut));
        },
        tip(out) {
          return model.group.localToWorld(out.set(0, 0.07, model.tip));
        },
        kick() {
          recoil = 1;
          if (weaponById(current).kind === 'gun') flashFor = 2;
        },
        dispose() {
          scene.remove(model.group, flash);
        },
      };
      return self;
    },
    dispose() {
      owned.forEach((o) => o.dispose());
    },
  };
}

export interface Tracers {
  fire(from: THREE.Vector3, to: THREE.Vector3, color?: string): void;
  update(dt: number): void;
  dispose(): void;
}

const TRACERS = 48;
// Bullet streaks as one pooled line-segment buffer that fades each segment out on its own.
export function createTracers(scene: THREE.Scene): Tracers {
  const pos = new Float32Array(TRACERS * 6);
  const col = new Float32Array(TRACERS * 6);
  const life = new Float32Array(TRACERS);
  const base = new Float32Array(TRACERS * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);
  let next = 0;
  const c = new THREE.Color();
  return {
    fire(from, to, color = '#ffe08a') {
      const k = next;
      next = (next + 1) % TRACERS;
      pos.set([from.x, from.y, from.z, to.x, to.y, to.z], k * 6);
      c.set(color).multiplyScalar(3);
      base.set([c.r, c.g, c.b], k * 3);
      life[k] = 1;
      geo.attributes.position.needsUpdate = true;
    },
    update(dt) {
      for (let k = 0; k < TRACERS; k++) {
        if (life[k] <= 0) continue;
        life[k] = Math.max(0, life[k] - dt * 7);
        const f = life[k];
        col.set([base[k * 3] * f, base[k * 3 + 1] * f, base[k * 3 + 2] * f, base[k * 3] * f * 0.3, base[k * 3 + 1] * f * 0.3, base[k * 3 + 2] * f * 0.3], k * 6);
      }
      geo.attributes.color.needsUpdate = true;
    },
    dispose() {
      scene.remove(lines);
      geo.dispose();
      mat.dispose();
    },
  };
}
