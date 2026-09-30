import { useCallback, useEffect, useRef, useState } from 'react';
import { fromDirectoryHandle, fromEntry, fromFileList } from '../../../app/files/sources';
import type { FsDir } from '../../../app/files/types';
import { isTooMany, listRepo, loadRepo } from '../../../app/files/walk';
import { LIMITS } from '../../../engine/battle/rules';
import type { Quality } from '../../../engine/battle/types';
import { MAX_FILES } from '../../../engine/collect';
import { MEASURE_MSG, MeasureError, type BattleDeps } from '../deps';

export type SlotState =
  | { kind: 'empty' }
  | { kind: 'reading'; done: number; total: number | null }
  | { kind: 'measuring'; step: string }
  | { kind: 'ready'; quality: Quality }
  | { kind: 'error'; message: string; detail?: string };

export const MSG = {
  tooSmall: MEASURE_MSG.tooSmall,
  tooMany: `파일이 ${MAX_FILES.toLocaleString('ko-KR')}개보다 많아요. 소스 폴더(예: src)만 골라 주세요`,
  noSources: '이 폴더에서 PHP나 TypeScript·JavaScript 코드를 찾지 못했어요',
  noFiles: '폴더가 비어 있어요. 코드가 있는 폴더를 골라 주세요',
  notFolder: '파일 말고 폴더를 끌어다 놓아 주세요',
  readFailed: '폴더를 읽지 못했어요. 다시 골라 주세요',
  measureFailed: MEASURE_MSG.failed,
  measuring: '품질을 재는 중이에요',
} as const;

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export function useSlot(deps: BattleDeps, initial?: Quality) {
  const [state, setState] = useState<SlotState>(initial ? { kind: 'ready', quality: initial } : { kind: 'empty' });
  const run = useRef(0);
  const cancelJob = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    run.current++;
    cancelJob.current?.();
    cancelJob.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const open = useCallback(async (dir: FsDir) => {
    stop();
    const id = run.current;
    const alive = () => run.current === id;
    const fail = (message: string) => alive() && setState({ kind: 'error', message });
    setState({ kind: 'reading', done: 0, total: null });
    try {
      const listing = await listRepo(dir);
      if (!alive()) return;
      if (isTooMany(listing)) return fail(MSG.tooMany);
      if (listing.sources.length === 0) return fail(MSG.noSources);
      const total = listing.sources.length + listing.configs.length;
      setState({ kind: 'reading', done: 0, total });
      let last = 0;
      const input = await loadRepo(listing, (done, all) => {
        const now = Date.now();
        // one render per file would stall large repos; ~10 updates a second is enough to look alive
        if (!alive() || (done < all && now - last < 100)) return;
        last = now;
        setState({ kind: 'reading', done, total: all });
      });
      if (!alive()) return;
      setState({ kind: 'measuring', step: MSG.measuring });
      const job = deps.measure(input, (step) => alive() && setState({ kind: 'measuring', step }));
      cancelJob.current = job.cancel;
      const quality = await job.result;
      if (!alive()) return;
      cancelJob.current = null;
      if (quality.totals.prodLines < LIMITS.minLines) return fail(MSG.tooSmall);
      setState({ kind: 'ready', quality });
    } catch (e) {
      if (!alive()) return;
      cancelJob.current = null;
      if (e instanceof MeasureError) setState({ kind: 'error', message: e.message, detail: e.detail });
      else setState({ kind: 'error', message: MSG.measureFailed, detail: e instanceof Error && e.message ? e.message : undefined });
    }
  }, [deps, stop]);

  const reset = useCallback(() => {
    stop();
    setState({ kind: 'empty' });
  }, [stop]);

  const pickNative = useCallback(async () => {
    const picker = deps.pickDirectory;
    if (!picker) return;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await picker();
    } catch (e) {
      if (!isAbort(e)) setState({ kind: 'error', message: MSG.readFailed });
      return;
    }
    void open(fromDirectoryHandle(handle));
  }, [deps, open]);

  const onFiles = useCallback((files: FileList) => {
    if (files.length === 0) return setState({ kind: 'error', message: MSG.noFiles });
    void open(fromFileList(files));
  }, [open]);

  const onDrop = useCallback((items: DataTransferItemList) => {
    // DataTransferItems are only valid during the drop event, so read the entry synchronously
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].kind === 'file' ? items[i].webkitGetAsEntry?.() : null;
      if (entry?.isDirectory) return void open(fromEntry(entry as FileSystemDirectoryEntry));
    }
    setState({ kind: 'error', message: MSG.notFolder });
  }, [open]);

  return { state, pickNative, onFiles, onDrop, reset };
}
