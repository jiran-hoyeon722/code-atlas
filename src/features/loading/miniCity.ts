import {
  AmbientLight, BoxGeometry, Color, DirectionalLight, InstancedMesh, MeshLambertMaterial,
  Object3D, PerspectiveCamera, Scene, WebGLRenderer,
} from 'three';

const MAX = 600;
const RISE_MS = 400;
const SIDE = Math.ceil(Math.sqrt(MAX));
const GAP = 1.3;

export function mountMiniCity(root: HTMLElement): { add(color: string): void; dispose(): void } {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  root.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';

  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1.1));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(8, 16, 6);
  scene.add(sun);

  const camera = new PerspectiveCamera(38, 1, 0.1, 500);
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  const material = new MeshLambertMaterial();
  const mesh = new InstancedMesh(geometry, material, MAX);
  mesh.count = 0;
  scene.add(mesh);

  const heights = new Float32Array(MAX);
  const bornAt = new Float32Array(MAX);
  const dummy = new Object3D();
  const half = ((SIDE - 1) * GAP) / 2;
  let count = 0;
  let total = 0;
  let raf = 0;
  let disposed = false;

  const place = (i: number, now: number) => {
    const k = Math.min(1, (now - bornAt[i]) / RISE_MS);
    const eased = 1 - (1 - k) * (1 - k);
    dummy.position.set((i % SIDE) * GAP - half, 0, Math.floor(i / SIDE) * GAP - half);
    dummy.scale.set(0.9, Math.max(0.001, heights[i] * eased), 0.9);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    return k < 1;
  };

  const resize = () => {
    const w = root.clientWidth || 1;
    const h = root.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const r = (Math.ceil(Math.sqrt(Math.max(count, 16))) * GAP) / 2;
    camera.position.set(r * 1.9, r * 1.7, r * 1.9);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  };

  const frame = (now: number) => {
    if (disposed) return;
    let animating = false;
    for (let i = 0; i < mesh.count; i++) if (place(i, now)) animating = true;
    mesh.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
    raf = animating ? requestAnimationFrame(frame) : 0;
  };
  const kick = () => { if (!raf && !disposed) raf = requestAnimationFrame(frame); };

  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { resize(); kick(); });
  ro?.observe(root);
  resize();

  return {
    add(color: string) {
      if (disposed) return;
      const height = 0.6 + ((total * 7919) % 100) / 100 * 3.2;
      total++;
      if (count < MAX) {
        const i = count++;
        heights[i] = height;
        bornAt[i] = performance.now();
        mesh.count = count;
        mesh.setColorAt(i, new Color(color));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        if (count % 16 === 0) resize();
      } else {
        const i = total % MAX;
        heights[i] = Math.min(6, heights[i] + 0.15);
        bornAt[i] = performance.now() - RISE_MS;
      }
      kick();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      geometry.dispose();
      material.dispose();
      mesh.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
