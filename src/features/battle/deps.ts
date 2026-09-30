import type { Quality } from '../../engine/battle/types';
import type { RepoInput } from '../../engine/types';

export interface MeasureJob {
  result: Promise<Quality>;
  cancel(): void;
}

export interface BattleDeps {
  /** null when the browser has no `showDirectoryPicker`: the hidden folder input is used instead */
  pickDirectory: (() => Promise<FileSystemDirectoryHandle>) | null;
  /** `onProgress` receives a plain Korean line describing the current step */
  measure(input: RepoInput, onProgress: (step: string) => void): MeasureJob;
}

export const MEASURE_NOT_READY = '품질 측정 기능이 아직 연결되지 않았어요';

function nativePicker(): BattleDeps['pickDirectory'] {
  const w = globalThis as unknown as { showDirectoryPicker?: (o: { mode: 'read' }) => Promise<FileSystemDirectoryHandle> };
  return typeof w.showDirectoryPicker === 'function' ? () => w.showDirectoryPicker!({ mode: 'read' }) : null;
}

/** The single wiring point: replace `measure` here with the quality worker client. */
export function defaultDeps(): BattleDeps {
  return {
    pickDirectory: nativePicker(),
    measure: () => ({ result: Promise.reject(new Error(MEASURE_NOT_READY)), cancel() {} }),
  };
}
