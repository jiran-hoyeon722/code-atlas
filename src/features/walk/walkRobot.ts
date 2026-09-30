import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
  /** Cross-fades to `name`; asking for the clip already playing is a no-op unless `restart`. */
  play(name: string, fade?: number, restart?: boolean): THREE.AnimationAction | null;
  readonly current: THREE.AnimationAction | null;
  dispose(): void;
}

const ONCE = ['Jump', 'Wave', 'ThumbsUp', 'Punch', 'Death', 'No', 'Yes', 'Sitting'];

// Each robot is a skeleton-aware clone with its own mixer; tint recolours the body without touching the shared original.
export async function spawnRobot(url: string, height: number, tint?: string): Promise<Robot> {
  const [{ clone }, gltf] = await Promise.all([import('three/examples/jsm/utils/SkeletonUtils.js'), loadRobot(url)]);
  const root = clone(gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  root.scale.setScalar(height / Math.max(0.01, box.max.y - box.min.y));
  const owned: THREE.Material[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const copies = source.map((m) => {
      const c = m.clone() as THREE.MeshStandardMaterial;
      if (tint && c.color && c.color.getHSL({ h: 0, s: 0, l: 0 }).s > 0.25) c.color.set(tint);
      owned.push(c);
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? copies : copies[0];
  });
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
    play(name, fade = 0.25, restart = false) {
      const next = actions[name];
      if (!next) return null;
      if (next === current) {
        if (restart) next.reset().setEffectiveWeight(1).play();
        return next;
      }
      next.reset().setEffectiveWeight(1).fadeIn(fade).play();
      current?.fadeOut(fade);
      current = next;
      return next;
    },
    dispose() {
      mixer.stopAllAction();
      owned.forEach((m) => m.dispose());
    },
  };
}
