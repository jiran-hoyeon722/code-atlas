import type { MountViewer } from '../../viewer-env';

export const mountBattle: MountViewer = (root) => {
  const el = document.createElement('p');
  el.textContent = '대결 화면을 준비하고 있어요.';
  root.append(el);
  return () => el.remove();
};
