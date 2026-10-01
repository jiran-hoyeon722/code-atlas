import * as THREE from 'three';
import { esc } from '../escape';
import { CHARACTERS, type Character } from './walkCharacters';
import { spawnRobot, type Robot } from './walkRobot';

const GAP = 4;

// Its own small renderer draws one viewport per card, so the city renderer keeps its size and passes untouched.
export function openPicker(host: HTMLElement, url: string, initial: Character, onPick: (c: Character) => void): () => void {
  const el = document.createElement('div');
  el.className = 'wk-pick';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', '캐릭터 고르기');
  el.innerHTML = `
    <div class="p-panel glass">
      <h2>캐릭터를 고르세요</h2>
      <p>고르지 않은 4명은 라이벌로 도시에 나타나요.</p>
      <div class="p-stage">
        <canvas></canvas>
        <div class="p-list" role="radiogroup" aria-label="캐릭터">${CHARACTERS.map((c, k) => `
          <button role="radio" aria-checked="false" data-id="${esc(c.id)}" style="--c:${esc(c.color)}">
            <kbd>${k + 1}</kbd><b>${esc(c.name)}</b><span>${esc(c.blurb)}</span>
          </button>`).join('')}
        </div>
      </div>
      <button class="p-go" data-go>이 캐릭터로 시작 <kbd>Enter</kbd></button>
    </div>`;
  host.append(el);
  const canvas = el.querySelector('canvas')!;
  const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-id]'));
  let chosen = initial;
  let done = false;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setScissorTest(true);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#dfe6ff', '#2a2433', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 2.4);
  sun.position.set(2, 4, 5);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const robots: (Robot | null)[] = CHARACTERS.map(() => null);
  CHARACTERS.forEach((c, k) => {
    void spawnRobot(url, 1.75, c).then((r) => {
      if (done) { r.dispose(); return; }
      robots[k] = r;
      r.root.position.x = k * GAP;
      r.root.rotation.y = 0.35;
      scene.add(r.root);
      r.play(c === chosen ? 'Wave' : 'Idle', 0);
    }).catch(() => {});
  });

  const select = (c: Character) => {
    if (c !== chosen) {
      chosen = c;
      robots[CHARACTERS.indexOf(c)]?.play('Wave', 0.15);
    }
    buttons.forEach((b) => {
      const on = b.dataset.id === c.id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  };
  select(initial);
  const finish = () => {
    if (done) return;
    close();
    onPick(chosen);
  };

  const onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const id = t.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (id) { select(CHARACTERS.find((c) => c.id === id)!); return; }
    if (t.closest('[data-go]')) finish();
  };
  const onDouble = (e: MouseEvent) => { if ((e.target as HTMLElement).closest('[data-id]')) finish(); };
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = CHARACTERS.indexOf(chosen);
    const slot = /^Digit([1-9])$/.exec(e.code);
    if (slot && CHARACTERS[Number(slot[1]) - 1]) select(CHARACTERS[Number(slot[1]) - 1]);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') select(CHARACTERS[(k + 1) % CHARACTERS.length]);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') select(CHARACTERS[(k + CHARACTERS.length - 1) % CHARACTERS.length]);
    else if (e.key === 'Enter' || e.key === ' ') finish();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  el.addEventListener('click', onClick);
  el.addEventListener('dblclick', onDouble);
  window.addEventListener('keydown', onKey, true);

  const resize = () => renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const box = canvas.getBoundingClientRect();
    renderer.setClearColor(0x000000, 0);
    renderer.setScissor(0, 0, box.width, box.height);
    renderer.clear();
    robots.forEach((r, k) => {
      if (!r) return;
      if (CHARACTERS[k] === chosen) r.root.rotation.y += dt * 0.8;
      else r.root.rotation.y += (0.35 - r.root.rotation.y) * Math.min(1, dt * 4);
      if (r.current && !r.current.isRunning() && r.current !== r.actions.Idle) r.play('Idle', 0.3);
      r.mixer.update(dt);
      const card = buttons[k].getBoundingClientRect();
      const x = card.left - box.left, w = card.width, h = Math.min(card.height, w * 1.25);
      const y = box.height - (card.top - box.top) - h;
      renderer.setViewport(x, y, w, h);
      renderer.setScissor(x, y, w, h);
      camera.aspect = w / Math.max(1, h);
      camera.position.set(k * GAP, 1.25, 5.2);
      camera.lookAt(k * GAP, 0.95, 0);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    });
  });
  el.querySelector<HTMLButtonElement>('[data-go]')!.focus();

  function close() {
    done = true;
    renderer.setAnimationLoop(null);
    observer.disconnect();
    el.removeEventListener('click', onClick);
    el.removeEventListener('dblclick', onDouble);
    window.removeEventListener('keydown', onKey, true);
    robots.forEach((r) => r?.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    el.remove();
  }
  return () => { if (!done) close(); };
}
