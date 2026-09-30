import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import './shell.css';
import type { Architecture } from '../../engine/architecture';
import type { GithubOrigin } from '../../app/files/github';
import type { MountViewer, Selection, TabId, ViewerEnv } from '../viewer-env';
import { downloadCodeCharta } from './codecharta';
import { formatHash, parseHash } from './hash';
import { getRepoRoot, setRepoRoot, vscodeHref } from './vscode';
import { hasWebGL } from './webgl';
import { LANGS } from '../../engine/langs';

export interface ViewerShellProps {
  arch: Architecture;
  readSource(path: string): Promise<string | null>;
  canReconnect: boolean;
  onReconnect(): void;
  onReanalyze(): void;
  onOpenOther(): void;
  /** the analysis is of a public GitHub repo at this commit */
  origin?: GithubOrigin;
}

const LOADERS: Record<TabId, () => Promise<MountViewer>> = {
  city: () => import('../city/mountCity').then((m) => m.mountCity),
  graph: () => import('../graph/mountGraph').then((m) => m.mountGraph),
  explorer: () => import('../explorer/mountExplorer').then((m) => m.mountExplorer),
};
const TABS: { id: TabId; label: string }[] = [
  { id: 'city', label: '도시' },
  { id: 'graph', label: '그래프' },
  { id: 'explorer', label: '탐색기' },
];
const NO_WEBGL = '이 브라우저에서는 3D 화면을 쓸 수 없어요. 탐색기에서 같은 정보를 볼 수 있어요.';
const FAIL_REASON = { syntax: '구문 오류', read: '읽기 실패' } as const;
const FRAMEWORK_LABEL = { laravel: 'Laravel', react: 'React' } as const;

const isAbsolute = (p: string) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

function initialState(webgl: boolean): { tab: TabId; sel: Selection } {
  const hash = location.hash;
  const parsed = parseHash(hash);
  const explicit = /^#(city|graph|explorer)(&|$)/.test(hash);
  return { tab: explicit ? parsed.tab : webgl ? 'city' : 'explorer', sel: parsed.sel };
}

const treeUrl = (o: GithubOrigin) => `https://github.com/${o.owner}/${o.repo}/tree/${o.sha}${o.subdir ? `/${o.subdir.split('/').map(encodeURIComponent).join('/')}` : ''}`;

export function ViewerShell({ arch, readSource, canReconnect, onReconnect, onReanalyze, onOpenOther, origin }: ViewerShellProps) {
  const webgl = useMemo(() => hasWebGL(), []);
  const initial = useMemo(() => initialState(webgl), [webgl]);
  const [tab, setTab] = useState<TabId>(initial.tab);
  const [mountKey, setMountKey] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [setupOpen, setSetupOpen] = useState(false);

  const tabRef = useRef(tab);
  const selRef = useRef<Selection>(initial.sel);
  const repoRootRef = useRef<string | null>(getRepoRoot(arch.name));
  const readSourceRef = useRef(readSource);
  readSourceRef.current = readSource;
  const viewRef = useRef<HTMLDivElement>(null);

  const go = (next: TabId, sel: Selection) => {
    selRef.current = sel;
    const hash = formatHash(next, sel);
    if (next === tabRef.current) {
      history.replaceState(null, '', hash);
      return;
    }
    tabRef.current = next;
    history.pushState(null, '', hash);
    setTab(next);
  };

  useEffect(() => {
    history.replaceState(null, '', formatHash(tabRef.current, selRef.current));
    const onPop = () => {
      const { tab: next, sel } = parseHash(location.hash);
      const fileChanged = sel.file !== selRef.current.file;
      selRef.current = sel;
      if (next !== tabRef.current) {
        tabRef.current = next;
        setTab(next);
      } else if (fileChanged) {
        setMountKey((k) => k + 1);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const host = viewRef.current!;
    if (!webgl && tab !== 'explorer') {
      setStatus('idle');
      return;
    }
    let live = true;
    let dispose: (() => void) | null = null;
    const env: ViewerEnv = {
      readSource: (path) => readSourceRef.current(path),
      vscodeHref: (path) => (repoRootRef.current ? vscodeHref(repoRootRef.current, path) : null),
      requestVscodeSetup: () => {
        if (live) setSetupOpen(true);
      },
      selection: { ...selRef.current },
      onSelect: (sel) => {
        if (!live) return;
        selRef.current = sel;
        history.replaceState(null, '', formatHash(tabRef.current, sel));
      },
      goto: (next, sel) => {
        if (live) go(next, sel ?? {});
      },
    };
    setStatus('loading');
    LOADERS[tab]().then(
      (mount) => {
        if (!live) return;
        try {
          dispose = mount(host, arch, env);
          setStatus('idle');
        } catch {
          host.replaceChildren();
          setStatus('error');
        }
      },
      () => {
        if (live) setStatus('error');
      },
    );
    return () => {
      live = false;
      dispose?.();
      host.replaceChildren();
    };
  }, [tab, mountKey, arch, webgl]);

  const saveRepoRoot = (path: string) => {
    setRepoRoot(arch.name, path);
    repoRootRef.current = path;
    setSetupOpen(false);
    // views render VS Code links once per selection, so remount to pick up the new root
    setMountKey((k) => k + 1);
  };

  const needs3d = !webgl && tab !== 'explorer';

  return (
    <div className="ca-shell">
      <header className="ca-shell-top">
        <div className="ca-shell-brand">
          {origin ? (
            <a className="ca-shell-origin" href={treeUrl(origin)} target="_blank" rel="noreferrer" title="GitHub 에서 이 커밋 보기">
              <strong>{arch.name}</strong>
              <code>{origin.sha.slice(0, 7)}</code>
            </a>
          ) : (
            <strong>{arch.name}</strong>
          )}
          <span>{`${arch.framework ? FRAMEWORK_LABEL[arch.framework] : LANGS[arch.lang].label} · 파일 ${arch.nodes.length.toLocaleString('ko-KR')}개 · ${formatTime(arch.generatedAt)} 분석`}</span>
        </div>
        <nav className="ca-shell-tabs" role="tablist" aria-label="화면">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'on' : undefined}
              onClick={() => go(t.id, selRef.current)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ca-shell-issues">
          {arch.failed.length > 0 && (
            <details className="ca-shell-issue">
              <summary>{`${arch.failed.length}개 파일을 읽지 못했어요`}</summary>
              <ul>
                {arch.failed.map((f) => (
                  <li key={f.path}>
                    <code>{f.path}</code>
                    <span>{FAIL_REASON[f.reason]}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {arch.unresolved > 0 && <span className="ca-shell-chip">{`해석하지 못한 import ${arch.unresolved}개`}</span>}
        </div>
        <div className="ca-shell-actions">
          {canReconnect && (
            <button type="button" className="primary" onClick={onReconnect}>폴더 다시 연결</button>
          )}
          <button type="button" onClick={onReanalyze} title={origin ? 'GitHub 에서 최신 커밋을 받아 다시 분석해요' : undefined}>
            {origin ? '최신 커밋으로 다시 분석' : '다시 분석'}
          </button>
          <button type="button" onClick={() => downloadCodeCharta(arch)}>cc.json 내려받기</button>
          <button type="button" onClick={onOpenOther}>다른 레포 열기</button>
        </div>
      </header>
      <main className="ca-shell-view">
        <div ref={viewRef} className="ca-shell-mount" />
        {status === 'loading' && <div className="ca-shell-note">불러오는 중…</div>}
        {status === 'error' && <div className="ca-shell-note">화면을 불러오지 못했어요. 새로고침해 주세요.</div>}
        {needs3d && (
          <div className="ca-shell-note">
            <p>{NO_WEBGL}</p>
            <button type="button" className="primary" onClick={() => go('explorer', selRef.current)}>탐색기로 가기</button>
          </div>
        )}
      </main>
      {setupOpen && (
        <VscodeDialog initial={repoRootRef.current ?? ''} onSave={saveRepoRoot} onClose={() => setSetupOpen(false)} />
      )}
    </div>
  );
}

function VscodeDialog({ initial, onSave, onClose }: { initial: string; onSave(path: string): void; onClose(): void }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState(false);

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const path = value.trim();
    if (!isAbsolute(path)) {
      setError(true);
      return;
    }
    onSave(path);
  };

  return (
    <div className="ca-shell-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="ca-shell-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ca-vscode-title"
        onKeyDown={onKeyDown}
        onSubmit={onSubmit}
      >
        <h2 id="ca-vscode-title">VS Code로 열기 설정</h2>
        <p>브라우저는 보안상 폴더의 실제 경로를 알 수 없어요. 이 레포가 내 컴퓨터 어디에 있는지 한 번만 알려 주세요. 이 브라우저에만 저장돼요.</p>
        <label htmlFor="ca-vscode-root">레포 폴더의 절대 경로</label>
        <input
          id="ca-vscode-root"
          autoFocus
          spellCheck={false}
          placeholder="/Users/me/projects/my-repo"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
        />
        {error && <p className="ca-shell-error">절대 경로를 입력해 주세요. 예: /Users/me/projects/my-repo</p>}
        <div className="ca-shell-dialog-actions">
          <button type="button" onClick={onClose}>취소</button>
          <button type="submit" className="primary">저장</button>
        </div>
      </form>
    </div>
  );
}
