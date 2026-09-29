import { useEffect, useRef, useState, type DragEvent, type ReactNode, type Ref } from 'react';
import type { CacheSummary } from '../../storage/cache';
import './landing.css';

export interface LandingProps {
  recent: CacheSummary[];
  onPickFolder(): void;
  onDrop(items: DataTransferItemList): void;
  onFiles(files: FileList): void;
  onOpenRecent(key: string): void;
  onDeleteRecent(key: string): void;
  onClearAll(): void;
  notice?: string;
  /** false when `showDirectoryPicker` is missing: the button opens the hidden folder input instead */
  hasPicker?: boolean;
  /** a dialog (passed as children) is open: the page behind it is inert and ignores drops */
  blocked?: boolean;
  children?: ReactNode;
}

const TITLE = '레포 폴더를 여기에 끌어다 놓으세요';
const NO_PICKER = '이 브라우저에서는 폴더를 끌어다 놓거나 "폴더 선택"으로 골라 주세요. 다시 열 때 코드 보기는 폴더를 한 번 더 넣어야 해요.';
const FRAMEWORK = { laravel: 'Laravel', react: 'React' } as Record<string, string>;
const LANG = { php: 'PHP', ts: 'TypeScript' } as const;

const hasNativePicker = () => typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ko-KR');
}

export function FolderInput({ onFiles, inputRef, testId }: { onFiles(files: FileList): void; inputRef?: Ref<HTMLInputElement>; testId?: string }) {
  return (
    <input
      ref={inputRef}
      type="file"
      className="ca-land-input"
      data-testid={testId}
      tabIndex={-1}
      aria-hidden="true"
      // non-standard attributes React does not know about
      {...{ webkitdirectory: '', directory: '' }}
      multiple
      onChange={(e) => {
        const files = e.currentTarget.files;
        if (files) onFiles(files);
        e.currentTarget.value = '';
      }}
    />
  );
}

export function Landing({
  recent, onPickFolder, onDrop, onFiles, onOpenRecent, onDeleteRecent, onClearAll, notice, hasPicker = hasNativePicker(), blocked = false, children,
}: LandingProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const pick = () => (hasPicker ? onPickFolder() : input.current?.click());

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    if (blocked) return;
    depth.current++;
    setOver(true);
  };
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = blocked ? 'none' : 'copy';
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const onDropZone = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    if (!blocked && e.dataTransfer?.items) onDrop(e.dataTransfer.items);
  };

  return (
    <div className="ca-land" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDropZone}>
      <div className="ca-land-body" inert={blocked}>
      <header className="ca-land-head">
        <h1>Code Atlas</h1>
      </header>
      <main className="ca-land-main">
        <section
          className={over ? 'ca-land-zone over' : 'ca-land-zone'}
          role="region"
          aria-labelledby="ca-land-title"
        >
          <div className="ca-land-icon" aria-hidden="true">📁</div>
          <h2 id="ca-land-title">{TITLE}</h2>
          <p className="ca-land-sub">PHP (Laravel) · TypeScript / JavaScript (React)</p>
          <button type="button" className="ca-land-pick" onClick={pick}>폴더 선택</button>
          <p className="ca-land-lock">🔒 파일은 브라우저 밖으로 나가지 않아요</p>
          <FolderInput onFiles={onFiles} inputRef={input} testId="folder-input" />
        </section>
        {!hasPicker && <p className="ca-land-hint">{NO_PICKER}</p>}
        {notice && <p className="ca-land-notice" role="alert">{notice}</p>}
        {recent.length > 0 && (
          <section className="ca-land-recent" aria-labelledby="ca-land-recent-title">
            <div className="ca-land-recent-head">
              <h2 id="ca-land-recent-title">최근 분석</h2>
              <button type="button" className="ca-land-clear" onClick={onClearAll}>캐시 지우기</button>
            </div>
            <ul>
              {recent.map((r) => (
                <li key={r.key} className="ca-land-card">
                  <button type="button" className="ca-land-open" onClick={() => onOpenRecent(r.key)}>
                    <strong>{r.name}</strong>{' '}
                    <span>{`${r.framework ? (FRAMEWORK[r.framework] ?? r.framework) : LANG[r.lang]} · ${r.files.toLocaleString('ko-KR')} 파일 · ${formatDate(r.analyzedAt)}`}</span>
                  </button>
                  <button type="button" className="ca-land-del" aria-label={`${r.name} 삭제`} onClick={() => onDeleteRecent(r.key)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      </div>
      {children}
    </div>
  );
}

export interface ChoiceDialogProps {
  title: string;
  choices: { label: string; value: string }[];
  initial?: string;
  onChoose(value: string | null): void;
}

export function ChoiceDialog({ title, choices, initial, onChoose }: ChoiceDialogProps) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>('button.primary') ?? el).focus();
  }, []);
  return (
    <div className="ca-land-backdrop">
      <div
        ref={box}
        tabIndex={-1}
        className="ca-land-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChoose(null);
        }}
      >
        <p>{title}</p>
        <div className="ca-land-dialog-actions">
          <button type="button" onClick={() => onChoose(null)}>취소</button>
          {choices.map((c) => (
            <button
              key={c.value}
              type="button"
              className={c.value === initial ? 'primary' : undefined}
              autoFocus={c.value === initial}
              onClick={() => onChoose(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
