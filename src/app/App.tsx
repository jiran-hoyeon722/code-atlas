import { useState } from 'react';
import { ChoiceDialog, FolderInput, Landing } from '../features/landing/Landing';
import { LoadingScreen } from '../features/loading/LoadingScreen';
import { ViewerShell } from '../features/shell/ViewerShell';
import type { Lang } from '../engine/types';
import { useRepoSession, type SessionDeps } from './useRepoSession';

const LANG_QUESTION = '이 폴더에는 PHP 와 TypeScript 가 함께 있어요. 어느 쪽으로 볼까요?';

export function App({ deps }: { deps?: Partial<SessionDeps> }) {
  const s = useRepoSession(deps);
  const { state } = s;

  if (state.phase === 'viewer' && state.viewer) {
    const v = state.viewer;
    return (
      <>
        <ViewerShell
          key={v.id}
          arch={v.arch}
          readSource={s.readSource}
          canReconnect={v.canReconnect}
          onReconnect={s.onReconnect}
          onReanalyze={() => void s.onReanalyze()}
          onOpenOther={s.onOpenOther}
          origin={v.origin}
        />
        {v.skipped > 0 && <SkippedNote key={v.id} count={v.skipped} />}
        {state.notice && (
          <div className="ca-app-skipped ca-app-notice" role="alert">
            <span>{state.notice}</span>
            <button type="button" aria-label="닫기" onClick={s.onDismissNotice}>×</button>
          </div>
        )}
        {!s.hasPicker && <FolderInput onFiles={s.onFiles} inputRef={s.viewerInput} />}
      </>
    );
  }

  if ((state.phase === 'listing' || state.phase === 'reading' || state.phase === 'analyzing') && state.loading) {
    const l = state.loading;
    return <LoadingScreen name={l.name} framework={l.framework} sourceDir={l.sourceDir} roles={l.roles} step={l.step} remote={l.remote} onCancel={s.onCancel} />;
  }

  const counts = state.langCounts;
  return (
    <Landing
      recent={state.recent}
      notice={state.notice}
      failedGithub={state.failedGithub}
      samples={state.samples}
      onOpenGithub={s.onOpenGithub}
      onOpenSample={s.onOpenSample}
      hasPicker={s.hasPicker}
      blocked={state.phase === 'confirmTooMany' || state.phase === 'chooseLang'}
      onPickFolder={s.onPickFolder}
      onDrop={s.onDrop}
      onFiles={s.onFiles}
      onOpenRecent={(k) => void s.onOpenRecent(k)}
      onDeleteRecent={(k) => void s.onDeleteRecent(k)}
      onClearAll={() => void s.onClearAll()}
    >
      {state.phase === 'confirmTooMany' && state.tooMany !== undefined && (
        <ChoiceDialog
          title={`파일이 ${state.tooMany.toLocaleString('ko-KR')}개예요. 소스 폴더(예: src)만 골라서 다시 열면 더 빨라요. 그대로 진행할까요?`}
          choices={[{ label: '그대로 진행', value: 'yes' }]}
          initial="yes"
          onChoose={(v) => s.onConfirmTooMany(v === 'yes')}
        />
      )}
      {state.phase === 'chooseLang' && counts && (
        <ChoiceDialog
          title={LANG_QUESTION}
          choices={[
            { label: `PHP · ${(counts.php ?? 0).toLocaleString('ko-KR')}개`, value: 'php' },
            { label: `TypeScript · ${(counts.ts ?? 0).toLocaleString('ko-KR')}개`, value: 'ts' },
          ]}
          initial={(counts.php ?? 0) >= (counts.ts ?? 0) ? 'php' : 'ts'}
          onChoose={(v) => s.onChooseLang(v as Lang | null)}
        />
      )}
    </Landing>
  );
}

function SkippedNote({ count }: { count: number }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="ca-app-skipped" role="status">
      <span>{`2MB 가 넘는 파일 ${count}개는 건너뛰었어요.`}</span>
      <button type="button" aria-label="닫기" onClick={() => setOpen(false)}>×</button>
    </div>
  );
}
