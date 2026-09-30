import * as THREE from 'three';
import { spawnRobot, type Robot } from './walkRobot';

export interface HeroPose {
  speed: number;
  run: number;
  airborne: boolean;
  turn: number;
  dt: number;
  time: number;
}

export interface Hero {
  root: THREE.Group;
  animate(p: HeroPose): void;
  dispose(): void;
}

// Procedural rig: hip/knee and shoulder/elbow joints driven by one gait phase, so no animation clips are needed.
export function createHero(): Hero {
  const owned: { dispose(): void }[] = [];
  const mat = (color: string, roughness = 0.7) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness });
    owned.push(m);
    return m;
  };
  const jacket = mat('#6f86f0', 0.55);
  const pants = mat('#262a36');
  const skin = mat('#e6c3a2', 0.6);
  const hair = mat('#1d1a1c', 0.9);
  const shoe = mat('#f1f1f4', 0.5);
  const box = (w: number, h: number, d: number, m: THREE.Material, parent: THREE.Object3D, y: number, z = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    owned.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(0, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const joint = (parent: THREE.Object3D, x: number, y: number) => {
    const j = new THREE.Group();
    j.position.set(x, y, 0);
    parent.add(j);
    return j;
  };

  const root = new THREE.Group();
  const hips = joint(root, 0, 0.92);
  const torso = joint(hips, 0, 0.02);
  box(0.46, 0.6, 0.26, jacket, torso, 0.3);
  box(0.3, 0.18, 0.1, jacket, torso, 0.5, 0.14);
  const neck = joint(torso, 0, 0.62);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 20, 14), skin);
  owned.push(head.geometry);
  head.position.y = 0.17;
  head.castShadow = true;
  neck.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.162, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  owned.push(cap.geometry);
  cap.position.y = 0.19;
  cap.rotation.x = -0.25;
  neck.add(cap);

  const leg = (x: number) => {
    const hip = joint(hips, x, 0);
    box(0.17, 0.46, 0.19, pants, hip, -0.23);
    const knee = joint(hip, 0, -0.46);
    box(0.15, 0.44, 0.16, pants, knee, -0.22);
    box(0.16, 0.08, 0.28, shoe, knee, -0.45, 0.05);
    return { hip, knee };
  };
  const arm = (x: number) => {
    const shoulder = joint(torso, x, 0.56);
    box(0.12, 0.32, 0.13, jacket, shoulder, -0.16);
    const elbow = joint(shoulder, 0, -0.32);
    box(0.1, 0.28, 0.11, jacket, elbow, -0.13);
    box(0.09, 0.09, 0.09, skin, elbow, -0.3);
    return { shoulder, elbow };
  };
  const legs = [leg(-0.11), leg(0.11)];
  const arms = [arm(-0.3), arm(0.3)];

  let phase = 0;
  let lean = 0;
  let roll = 0;
  let stride = 0;
  const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * Math.min(1, dt * rate);

  return {
    root,
    animate({ speed, run, airborne, turn, dt, time }) {
      const moving = Math.min(1, speed / 3);
      phase += dt * speed * (Math.PI / (1.1 + run * 0.5));
      stride = damp(stride, moving, 10, dt);
      const thigh = (0.45 + run * 0.4) * stride;
      const shin = (0.7 + run * 0.7) * stride;
      legs.forEach(({ hip, knee }, k) => {
        const p = phase + k * Math.PI;
        const tHip = airborne ? (k ? -0.9 : -0.2) : -Math.sin(p) * thigh;
        const tKnee = airborne ? (k ? 1.3 : 0.5) : Math.max(0, Math.cos(p)) * shin + 0.05;
        hip.rotation.x = damp(hip.rotation.x, tHip, airborne ? 10 : 30, dt);
        knee.rotation.x = damp(knee.rotation.x, tKnee, airborne ? 10 : 30, dt);
      });
      arms.forEach(({ shoulder, elbow }, k) => {
        const p = phase + (1 - k) * Math.PI;
        const tSh = airborne ? -0.7 + k * 0.3 : -Math.sin(p) * (0.35 + run * 0.55) * stride;
        shoulder.rotation.x = damp(shoulder.rotation.x, tSh, 14, dt);
        shoulder.rotation.z = (k ? 1 : -1) * (0.06 + run * 0.08);
        elbow.rotation.x = damp(elbow.rotation.x, -(0.25 + run * 0.9 * stride), 14, dt);
      });
      lean = damp(lean, airborne ? 0.12 : 0.06 * stride + run * 0.22 * stride, 6, dt);
      roll = damp(roll, -turn * 0.12 * (0.4 + run), 6, dt);
      torso.rotation.x = lean;
      torso.rotation.z = roll;
      torso.rotation.y = Math.sin(phase) * 0.12 * stride;
      const breathe = Math.sin(time * 1.8) * 0.008 * (1 - stride);
      torso.scale.y = 1 + breathe;
      neck.rotation.x = -lean * 0.6;
      hips.position.y = 0.92 - Math.abs(Math.cos(phase)) * 0.05 * stride - run * 0.04 * stride;
    },
    dispose() {
      owned.forEach((o) => o.dispose());
    },
  };
}

export type Emote = 'Wave' | 'ThumbsUp' | 'Dance' | 'Punch';

export interface ModelHero extends Hero {
  emote(name: Emote): void;
  die(): void;
  revive(): void;
  sit(on: boolean): void;
  readonly ready: boolean;
}

// Shows the procedural rig until the glTF arrives, then cross-fades between the model's own clips by speed.
export function createModelHero(url: string, onError: () => void): ModelHero {
  const fallback = createHero();
  const root = new THREE.Group();
  root.add(fallback.root);
  let robot: Robot | null = null;
  let emoting: THREE.AnimationAction | null = null;
  let dead = false;
  let seated = false;
  let disposed = false;

  void spawnRobot(url, 1.75).then((r) => {
    if (disposed) { r.dispose(); return; }
    robot = r;
    r.mixer.addEventListener('finished', (e) => { if (e.action === emoting) emoting = null; });
    root.remove(fallback.root);
    root.add(r.root);
    r.play('Idle', 0);
  }).catch(() => { if (!disposed) onError(); });

  return {
    root,
    get ready() { return !!robot; },
    emote(name) {
      if (!robot || dead) return;
      emoting = robot.play(name, name === 'Punch' ? 0.08 : 0.2);
    },
    die() {
      dead = true;
      emoting = null;
      robot?.play('Death', 0.15);
    },
    revive() {
      dead = false;
      robot?.play('Idle', 0.1);
    },
    sit(on) {
      seated = on;
      emoting = null;
      robot?.play(on ? 'Sitting' : 'Idle', 0.15);
    },
    animate(p) {
      if (!robot) { fallback.animate(p); return; }
      if (!dead && !seated) {
        const moving = p.speed > 0.4;
        if ((moving || p.airborne) && emoting && emoting !== robot.actions.Punch) emoting = null;
        if (!emoting) robot.play(p.airborne ? 'Jump' : !moving ? 'Idle' : p.run > 0.35 ? 'Running' : 'Walking', p.airborne ? 0.12 : 0.28);
        const cur = robot.current;
        if (cur === robot.actions.Walking) cur.timeScale = Math.max(0.6, p.speed / 3.2);
        if (cur === robot.actions.Running) cur.timeScale = Math.max(0.8, p.speed / 9);
        robot.root.rotation.z = -p.turn * 0.05 * (0.4 + p.run);
      }
      robot.mixer.update(p.dt);
    },
    dispose() {
      disposed = true;
      fallback.dispose();
      robot?.dispose();
    },
  };
}
