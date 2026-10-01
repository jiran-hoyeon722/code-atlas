import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Character } from './walkCharacters';

let cached: { url: string; promise: Promise<GLTF> } | null = null;

export function loadRobot(url: string): Promise<GLTF> {
  if (cached?.url !== url) {
    cached = {
      url,
      promise: Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
      ]).then(([{ GLTFLoader }]) => new GLTFLoader().loadAsync(url)),
    };
    // A failed load must not stick: the next mount retries instead of reusing the rejection.
    cached.promise.catch(() => { if (cached?.url === url) cached = null; });
  }
  return cached.promise;
}

export interface Robot {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  play(name: string, fade?: number): THREE.AnimationAction | null;
  readonly current: THREE.AnimationAction | null;
  dispose(): void;
}

const ONCE = ['Jump', 'Wave', 'ThumbsUp', 'Punch', 'Death', 'No', 'Yes', 'Sitting'];

// Each robot is a skeleton-aware clone with its own mixer; a character repaints copies of the materials, never the shared original.
export async function spawnRobot(url: string, height: number, look?: Character): Promise<Robot> {
  const [{ clone }, gltf] = await Promise.all([import('three/examples/jsm/utils/SkeletonUtils.js'), loadRobot(url)]);
  const root = clone(gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  root.scale.setScalar(height / Math.max(0.01, box.max.y - box.min.y));
  const owned: { dispose(): void }[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const copies = source.map((m) => {
      const c = m.clone() as THREE.MeshStandardMaterial;
      if (look && c.color) {
        if (m.name === 'Main') c.color.set(look.body);
        else if (m.name === 'Grey') c.color.set(look.joint);
        else if (m.name === 'Black') { c.emissive.set(look.glow); c.emissiveIntensity = 0.9; }
      }
      owned.push(c);
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? copies : copies[0];
  });
  if (look) wearGear(root, look, owned);
  const mixer = new THREE.AnimationMixer(root);
  const actions = Object.fromEntries(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
  ONCE.forEach((name) => {
    const a = actions[name];
    if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
  });
  let current: THREE.AnimationAction | null = null;
  return {
    root, mixer, actions,
    get current() { return current; },
    play(name, fade = 0.25) {
      const next = actions[name];
      if (!next) return null;
      if (next === current && !ONCE.includes(name)) return next;
      next.reset().setEffectiveWeight(1).fadeIn(fade).play();
      if (current && current !== next) current.fadeOut(fade);
      current = next;
      return next;
    },
    dispose() {
      mixer.stopAllAction();
      owned.forEach((m) => m.dispose());
    },
  };
}

// Built in metres on top of the bind-pose head, then re-expressed in the head bone's frame so it nods along.
function wearGear(root: THREE.Object3D, look: Character, owned: { dispose(): void }[]) {
  let bone: THREE.Object3D | undefined;
  root.traverse((o) => { if (!bone && o.name === 'Head' && (o as THREE.Bone).isBone) bone = o; });
  if (!bone) return;
  root.updateMatrixWorld(true);
  const head = new THREE.Box3().setFromObject(bone);
  const size = head.getSize(new THREE.Vector3());
  const top = head.getCenter(new THREE.Vector3()).setY(head.max.y);
  const gear = look.gear({ w: size.x, h: size.y, d: size.z });
  gear.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    owned.push(mesh.geometry);
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => owned.push(m));
  });
  const holder = new THREE.Group();
  new THREE.Matrix4().copy(bone.matrixWorld).invert()
    .multiply(new THREE.Matrix4().makeTranslation(top.x, top.y, top.z))
    .decompose(holder.position, holder.quaternion, holder.scale);
  holder.add(gear);
  bone.add(holder);
}
