import * as THREE from 'three';

export const SMALL_CITY = 240;
export const MAX_HEIGHT = 70;
const MIN_CAMERA_DISTANCE = 60;

export interface HomeView {
  position: THREE.Vector3;
  target: THREE.Vector3;
  distance: number;
  fogNear: number;
  fogFar: number;
  far: number;
}

/**
 * Large cities keep the original fixed home view. Small cities are backed off along the same angle until
 * the whole city (towers and row labels included) fits on screen.
 */
export function homeView(bounds: { w: number; d: number }, labelRight: number, aspect: number): HomeView {
  const citySize = Math.max(bounds.w, bounds.d);
  if (citySize >= SMALL_CITY) {
    const position = new THREE.Vector3(-citySize * 0.3, citySize * 0.62, citySize * 1.02);
    const target = new THREE.Vector3(citySize * 0.06, 0, citySize * 0.08);
    return { position, target, distance: position.distanceTo(target), fogNear: citySize * 1.1, fogFar: citySize * 3.2, far: citySize * 8 };
  }

  const target = new THREE.Vector3((labelRight - bounds.w / 2) / 2, 0, 0);
  const dir = new THREE.Vector3(-0.3, 0.62, 1.02).normalize();
  const camera = new THREE.PerspectiveCamera(45, aspect, 1, citySize * 8);
  const corners = [-bounds.w / 2, labelRight].flatMap((x) =>
    [-bounds.d / 2, bounds.d / 2 + 8].flatMap((z) => [0, MAX_HEIGHT].map((y) => new THREE.Vector3(x, y, z))));
  const fits = (distance: number) => {
    camera.position.copy(target).addScaledVector(dir, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    return corners.every((c) => {
      const p = c.clone().project(camera);
      return p.z < 1 && Math.abs(p.x) <= 0.92 && Math.abs(p.y) <= 0.92;
    });
  };
  let lo = MIN_CAMERA_DISTANCE;
  let hi = Math.max(lo, citySize * 6);
  if (!fits(lo)) {
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid; else lo = mid;
    }
    lo = hi;
  }
  const position = target.clone().addScaledVector(dir, lo);
  return { position, target, distance: lo, fogNear: lo * 0.9, fogFar: lo + citySize * 2.1, far: Math.max(citySize, lo) * 8 };
}
