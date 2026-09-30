import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode, type Ref } from 'react';
import { githubLabel, githubZipUrl, parseGithubUrl, type GithubSpec } from '../../app/files/github';
import type { SampleRepo } from '../../app/files/samples';
import type { CacheSummary } from '../../storage/cache';
import { roleColors } from '../palette';
import { LANGS } from '../../engine/langs';
import './landing.css';

export interface LandingProps {
  recent: CacheSummary[];
  onPickFolder(): void;
  onDrop(items: DataTransferItemList): void;
  onFiles(files: FileList): void;
  onOpenRecent(key: string): void;
  onDeleteRecent(key: string): void;
  onClearAll(): void;
  samples?: SampleRepo[];
  onOpenGithub?(input: string): void;
  onOpenSample?(sample: SampleRepo): void;
  notice?: string;
  /** the notice is about this GitHub repo: offer its ZIP as a way around the API */
  failedGithub?: GithubSpec;
  /** false when `showDirectoryPicker` is missing: the button opens the hidden folder input instead */
  hasPicker?: boolean;
  /** a dialog (passed as children) is open: the page behind it is inert and ignores drops */
  blocked?: boolean;
  children?: ReactNode;
}

const TITLE = '레포 폴더를 여기에 끌어다 놓으세요';
const NO_PICKER = '이 브라우저에서는 폴더를 끌어다 놓거나 "폴더 선택"으로 골라 주세요. 다시 열 때 코드 보기는 폴더를 한 번 더 넣어야 해요.';
const FRAMEWORK = { laravel: 'Laravel', react: 'React' } as Record<string, string>;

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg className="ca-land-gh-mark" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

function specHint(spec: GithubSpec): string {
  const parts = [`${spec.owner}/${spec.repo}`];
  parts.push(spec.ref ? `${spec.ref} 브랜치` : '기본 브랜치');
  if (spec.subdir) parts.push(`${spec.subdir} 폴더만`);
  return parts.join(' · ');
}

function GithubForm({ onOpen }: { onOpen(input: string): void }) {
  const [value, setValue] = useState('');
  const spec = useMemo(() => parseGithubUrl(value), [value]);
  const typed = value.trim().length > 0;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    onOpen(value);
  };
  return (
    <section className="ca-land-gh" aria-labelledby="ca-land-gh-title">
      <h2 id="ca-land-gh-title" className="ca-land-gh-title">
        <GithubMark size={15} />
        GitHub 공개 레포 주소로 열기
      </h2>
      <form className="ca-land-gh-form" onSubmit={onSubmit}>
        <input
          type="text"
          inputMode="url"
          aria-label="GitHub 레포 주소"
          aria-describedby="ca-land-gh-hint"
          aria-invalid={typed && !spec ? true : undefined}
          placeholder="github.com/owner/repo 붙여넣기"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" disabled={!spec}>분석하기</button>
      </form>
      <p id="ca-land-gh-hint" className={`ca-land-gh-hint${spec ? ' ok' : typed ? ' bad' : ''}`} aria-live="polite">
        {spec
          ? `✓ ${specHint(spec)}`
          : typed
            ? 'owner/repo 형식이나 GitHub 주소를 넣어 주세요'
            : '브랜치·하위 폴더 주소(…/tree/main/packages/web)도 돼요. 코드는 GitHub 에서 이 브라우저로 바로 받아요.'}
      </p>
    </section>
  );
}

function RoleBar({ sample }: { sample: SampleRepo }) {
  const colors = roleColors(sample);
  const total = sample.roleCounts.reduce((a, b) => a + b, 0) || 1;
  const parts = sample.roleCounts
    .map((n, i) => ({ n, i }))
    .filter((p) => p.n > 0)
    .sort((a, b) => sample.roles[a.i].layer - sample.roles[b.i].layer || b.n - a.n);
  return (
    <span className="ca-land-sample-bar" aria-hidden="true">
      {parts.map((p) => (
        <span key={p.i} style={{ flexGrow: p.n / total, background: colors[p.i] }} title={`${sample.roles[p.i].name} ${p.n}`} />
      ))}
    </span>
  );
}

function SampleGallery({ samples, onOpen }: { samples: SampleRepo[]; onOpen(sample: SampleRepo): void }) {
  const [opening, setOpening] = useState<string | null>(null);
  return (
    <section className="ca-land-samples" aria-labelledby="ca-land-samples-title">
      <div className="ca-land-section-head">
        <h2 id="ca-land-samples-title">내 레포가 없다면, 인기 레포부터 둘러보세요</h2>
        <span>미리 분석해 둬서 바로 열려요</span>
      </div>
      <ul>
        {samples.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className="ca-land-sample"
              aria-busy={opening === s.id || undefined}
              onClick={() => {
                setOpening(s.id);
                onOpen(s);
              }}
            >
              <RoleBar sample={s} />
              <span className="ca-land-sample-name">
                <span className="ca-land-sample-owner">{s.owner} /</span>
                <strong>{s.repo}</strong>
              </span>
              <span className="ca-land-sample-blurb">{s.blurb}</span>
              <span className="ca-land-sample-meta">
                <span className="ca-land-tag">{s.framework ? (FRAMEWORK[s.framework] ?? s.framework) : (LANGS[s.lang]?.label ?? s.lang)}</span>
                <span>{`파일 ${s.files.toLocaleString('ko-KR')}`}</span>
                {s.stars !== null && <span aria-label={`별 ${s.stars.toLocaleString('ko-KR')}개`}>{`★ ${compact.format(s.stars)}`}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

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
  recent, onPickFolder, onDrop, onFiles, onOpenRecent, onDeleteRecent, onClearAll, samples = [], onOpenGithub, onOpenSample, notice, failedGithub,
  hasPicker = hasNativePicker(), blocked = false, children,
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
          <p className="ca-land-sub">PHP · TypeScript/JavaScript · Python · Go · Java · Kotlin · Swift · Shell</p>
          <button type="button" className="ca-land-pick" onClick={pick}>폴더 선택</button>
          <p className="ca-land-lock">🔒 파일은 브라우저 밖으로 나가지 않아요</p>
          <FolderInput onFiles={onFiles} inputRef={input} testId="folder-input" />
        </section>
        {!hasPicker && <p className="ca-land-hint">{NO_PICKER}</p>}
        {onOpenGithub && (
          <>
            <div className="ca-land-or" aria-hidden="true"><span>또는</span></div>
            <GithubForm onOpen={onOpenGithub} />
          </>
        )}
        {notice && (
          <div className="ca-land-notice" role="alert">
            <p>{notice}</p>
            {failedGithub && (
              <a className="ca-land-notice-link" href={githubZipUrl(failedGithub)} target="_blank" rel="noreferrer">
                {`${githubLabel({ ...failedGithub, subdir: '' })} ZIP 내려받기 ↗`}
              </a>
            )}
          </div>
        )}
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
                    <strong>
                      {r.origin && <GithubMark size={12} />}
                      {r.name}
                    </strong>{' '}
                    <span>{`${r.framework ? (FRAMEWORK[r.framework] ?? r.framework) : (LANGS[r.lang]?.label ?? r.lang)} · ${r.files.toLocaleString('ko-KR')} 파일 · ${formatDate(r.analyzedAt)}`}</span>
                  </button>
                  <button type="button" className="ca-land-del" aria-label={`${r.name} 삭제`} onClick={() => onDeleteRecent(r.key)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {onOpenSample && samples.length > 0 && <SampleGallery key={notice ?? ''} samples={samples} onOpen={onOpenSample} />}
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
