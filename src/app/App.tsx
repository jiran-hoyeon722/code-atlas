import { useState } from 'react';
import { ChoiceDialog, FolderInput, Landing } from '../features/landing/Landing';
import { LoadingScreen } from '../features/loading/LoadingScreen';
import { ViewerShell } from '../features/shell/ViewerShell';
import { useRepoSession, type SessionDeps } from './useRepoSession';

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
          allowSource={s.allowSource}
          canReconnect={v.canReconnect}
          onReconnect={s.onReconnect}
          onReanalyze={() => void s.onReanalyze()}
          onOpenOther={s.onOpenOther}
          onCollapse={() => void s.onCollapse()}
          origin={v.origin}
          battle={v.battle}
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

  return (
    <Landing
      recent={state.recent}
      notice={state.notice}
      failedGithub={state.failedGithub}
      samples={state.samples}
      onOpenGithub={s.onOpenGithub}
      onOpenSample={s.onOpenSample}
      hasPicker={s.hasPicker}
      blocked={state.phase === 'confirmTooMany'}
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
