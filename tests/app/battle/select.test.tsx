import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Quality } from '../../../src/engine/battle/types';
import type { RepoInput } from '../../../src/engine/types';
import { BattleApp } from '../../../src/features/battle/BattleApp';
import { defaultDeps, MEASURE_NOT_READY, type BattleDeps } from '../../../src/features/battle/deps';
import { MSG } from '../../../src/features/battle/select/useSlot';

afterEach(cleanup);

function quality(name: string, over: Partial<Quality> = {}): Quality {
  return {
    ruleVersion: '1.4',
    name,
    lang: 'ts',
    fingerprint: 'f',
    config: { sourceDir: '', exclude: [], testPatterns: [], excludedLines: 0 },
    totals: { prodLines: 184_321, testLines: 0, testFiles: 0 },
    files: [],
    clones: [],
    cycles: [],
    commander: { files: [], display: '' },
    scores: { readability: 0, complexityExcess: 0, lengthExcess: 0, tangle: 0, duplication: 0, duplicationExcess: 0, tests: 0, hotspot: null },
    warnings: [],
    ...over,
  };
}

interface Run {
  input: RepoInput;
  progress(step: string): void;
  resolve(q: Quality): void;
  reject(e: unknown): void;
  cancel: ReturnType<typeof vi.fn>;
}

function fakes(pickDirectory: BattleDeps['pickDirectory'] = null) {
  const runs: Run[] = [];
  const deps: BattleDeps = {
    pickDirectory,
    measure(input, onProgress) {
      let resolve!: (q: Quality) => void;
      let reject!: (e: unknown) => void;
      const result = new Promise<Quality>((ok, fail) => {
        resolve = ok;
        reject = fail;
      });
      const cancel = vi.fn();
      runs.push({ input, progress: onProgress, resolve, reject, cancel });
      return { result, cancel };
    },
  };
  return { deps, runs };
}

function file(path: string, text: string): File {
  const f = new File([text], path.split('/').pop()!, { lastModified: 1 });
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}

const card = (label: '레포 A' | '레포 B') => screen.getByRole('region', { name: label });

function choose(side: 'a' | 'b', files: File[]) {
  const input = screen.getByTestId(`folder-input-${side}`) as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  fireEvent.change(input);
}

const repo = (name: string) => [file(`${name}/src/a.ts`, 'export const a = 1;'), file(`${name}/package.json`, '{}')];
const brief = () => screen.getByRole('button', { name: '작전 브리핑 보기' }) as HTMLButtonElement;

test('pick A and B through the folder input, measure, then open the briefing', async () => {
  const { deps, runs } = fakes();
  render(<BattleApp deps={deps} />);
  expect(screen.getByRole('heading', { name: '레포 전쟁' })).toBeTruthy();
  expect(screen.getByText('코드 양이 아니라 품질로 싸워요')).toBeTruthy();
  expect(screen.getByText('코드는 이 브라우저 밖으로 나가지 않아요')).toBeTruthy();
  expect(within(card('레포 A')).getByText('레포 폴더를 골라 주세요')).toBeTruthy();
  expect(brief().disabled).toBe(true);

  const input = screen.getByTestId('folder-input-a') as HTMLInputElement;
  const click = vi.spyOn(input, 'click');
  fireEvent.click(within(card('레포 A')).getByRole('button', { name: '폴더 고르기' }));
  expect(click).toHaveBeenCalledTimes(1);

  choose('a', repo('alpha'));
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(runs[0].input.name).toBe('alpha');
  expect(runs[0].input.files.map((f) => f.path)).toEqual(['src/a.ts']);
  expect(Object.keys(runs[0].input.configs)).toEqual(['package.json']);
  expect(within(card('레포 A')).getByText('품질을 재는 중')).toBeTruthy();
  act(() => runs[0].progress('함수를 세는 중이에요'));
  expect(within(card('레포 A')).getByText('함수를 세는 중이에요')).toBeTruthy();
  await act(async () => runs[0].resolve(quality('alpha')));
  expect(within(card('레포 A')).getByText('alpha')).toBeTruthy();
  expect(within(card('레포 A')).getByText('TypeScript · 코드 18만 4천 줄')).toBeTruthy();
  expect(brief().disabled).toBe(true);

  choose('b', repo('beta'));
  await waitFor(() => expect(runs).toHaveLength(2));
  await act(async () => runs[1].resolve(quality('beta', { lang: 'php', totals: { prodLines: 61_000, testLines: 0, testFiles: 0 } })));
  expect(within(card('레포 B')).getByText('PHP · 코드 6만 1천 줄')).toBeTruthy();
  expect(brief().disabled).toBe(false);

  fireEvent.click(brief());
  const heading = screen.getByRole('heading', { name: '작전 브리핑' });
  expect(document.activeElement).toBe(heading);
  expect(screen.getByText('alpha')).toBeTruthy();
  expect(screen.getByText('beta')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '레포 다시 고르기' }));
  expect(within(card('레포 A')).getByText('alpha')).toBeTruthy();
  expect(within(card('레포 B')).getByText('beta')).toBeTruthy();
  expect(brief().disabled).toBe(false);
});

test('the same folder can fight itself, through briefing → battle → result and back', async () => {
  const { deps, runs } = fakes();
  render(<BattleApp deps={deps} />);
  choose('a', repo('twin'));
  choose('b', repo('twin'));
  await waitFor(() => expect(runs).toHaveLength(2));
  await act(async () => {
    runs[0].resolve(quality('twin'));
    runs[1].resolve(quality('twin'));
  });
  expect(brief().disabled).toBe(false);
  fireEvent.click(brief());
  fireEvent.click(screen.getByRole('button', { name: '전투 시작하기' }));
  expect(screen.getByRole('heading', { name: '전투' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '결과 보기' }));
  expect(screen.getByRole('heading', { name: '결과' })).toBeTruthy();
  expect(screen.getAllByText('twin')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '레포 다시 고르기' }));
  expect(brief().disabled).toBe(false);
});

test('too-small repo cannot fight', async () => {
  const { deps, runs } = fakes();
  render(<BattleApp deps={deps} />);
  choose('a', repo('tiny'));
  await waitFor(() => expect(runs).toHaveLength(1));
  await act(async () => runs[0].resolve(quality('tiny', { totals: { prodLines: 120, testLines: 0, testFiles: 0 } })));
  expect(within(card('레포 A')).getByRole('alert').textContent).toContain('코드가 300줄보다 적어서 대결할 수 없어요');
  expect(brief().disabled).toBe(true);
});

test('warnings show as chips', async () => {
  const { deps, runs } = fakes();
  render(<BattleApp deps={deps} />);
  choose('a', repo('small'));
  await waitFor(() => expect(runs).toHaveLength(1));
  await act(async () => runs[0].resolve(quality('small', { warnings: ['shaky', 'excluded-heavy'], totals: { prodLines: 900, testLines: 0, testFiles: 0 } })));
  const a = within(card('레포 A'));
  expect(a.getByText('TypeScript · 코드 900줄')).toBeTruthy();
  expect(a.getByText('코드가 적어 결과가 흔들릴 수 있어요')).toBeTruthy();
  expect(a.getByText('측정에서 뺀 코드가 10%를 넘어요')).toBeTruthy();
});

test('measure failure shows a plain message; the default stub says it is not wired yet', async () => {
  render(<BattleApp deps={{ ...defaultDeps(), pickDirectory: null }} />);
  choose('a', repo('alpha'));
  const alert = await within(card('레포 A')).findByRole('alert');
  expect(within(alert).getByText(MSG.measureFailed)).toBeTruthy();
  expect(within(alert).getByText(MEASURE_NOT_READY)).toBeTruthy();
  expect(within(card('레포 A')).getByRole('button', { name: '다시 고르기' })).toBeTruthy();
});

test('a folder without source files and a folder with too many files are refused', async () => {
  const { deps, runs } = fakes();
  render(<BattleApp deps={deps} />);
  choose('a', [file('docs/README.md', '# hi')]);
  expect((await within(card('레포 A')).findByRole('alert')).textContent).toContain(MSG.noSources);

  const many = Array.from({ length: 20_001 }, (_, i) => ({
    name: `f${i}.ts`, webkitRelativePath: `big/f${i}.ts`, size: 1, lastModified: 1, text: async () => '',
  })) as unknown as File[];
  choose('b', many);
  const alert = await within(card('레포 B')).findByRole('alert');
  expect(alert.textContent).toContain(MSG.tooMany);
  expect(alert.textContent).toContain('소스 폴더');
  expect(runs).toHaveLength(0);
});

test('stopping while measuring cancels the job and empties the card', async () => {
  const { deps, runs } = fakes();
  render(<BattleApp deps={deps} />);
  choose('a', repo('alpha'));
  await waitFor(() => expect(runs).toHaveLength(1));
  fireEvent.click(within(card('레포 A')).getByRole('button', { name: '그만두기' }));
  expect(runs[0].cancel).toHaveBeenCalledTimes(1);
  expect(within(card('레포 A')).getByText('레포 폴더를 골라 주세요')).toBeTruthy();
  await act(async () => runs[0].resolve(quality('alpha')));
  expect(within(card('레포 A')).queryByText('alpha')).toBeNull();
});

test('native picker: a picked folder is measured, a cancelled picker changes nothing', async () => {
  const handle = {
    kind: 'directory',
    name: 'native',
    async *values() {
      yield { kind: 'file', name: 'a.ts', getFile: async () => new File(['export const a = 1;'], 'a.ts') };
    },
  } as unknown as FileSystemDirectoryHandle;
  const pick = vi.fn<() => Promise<FileSystemDirectoryHandle>>()
    .mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
    .mockResolvedValueOnce(handle);
  const { deps, runs } = fakes(pick);
  render(<BattleApp deps={deps} />);
  fireEvent.click(within(card('레포 B')).getByRole('button', { name: '폴더 고르기' }));
  await act(async () => {});
  expect(within(card('레포 B')).getByText('레포 폴더를 골라 주세요')).toBeTruthy();
  fireEvent.click(within(card('레포 B')).getByRole('button', { name: '폴더 고르기' }));
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(runs[0].input.name).toBe('native');
});

function dropOn(target: HTMLElement, items: unknown[]) {
  const ev = createEvent.drop(target);
  Object.defineProperty(ev, 'dataTransfer', { value: { items: Object.assign([...items], { length: items.length }) } });
  fireEvent(target, ev);
}

test('dropping a folder measures it; dropping a file asks for a folder', async () => {
  const { deps, runs } = fakes();
  render(<BattleApp deps={deps} />);
  dropOn(card('레포 A'), [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }]);
  expect(within(card('레포 A')).getByRole('alert').textContent).toContain(MSG.notFolder);

  const fileEntry = { isDirectory: false, name: 'a.ts', file: (ok: (f: File) => void) => ok(new File(['export const a = 1;'], 'a.ts')) };
  const dirEntry = {
    isDirectory: true,
    name: 'dropped',
    createReader: () => {
      let read = false;
      return {
        readEntries(ok: (e: unknown[]) => void) {
          ok(read ? [] : [fileEntry]);
          read = true;
        },
      };
    },
  };
  dropOn(card('레포 B'), [{ kind: 'file', webkitGetAsEntry: () => dirEntry }]);
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(runs[0].input.name).toBe('dropped');
  expect(runs[0].input.files.map((f) => f.path)).toEqual(['a.ts']);
});

test('repo names are rendered as text, never as markup', async () => {
  const { deps, runs } = fakes();
  const { container } = render(<BattleApp deps={deps} />);
  const evil = '<img src=x onerror=alert(1)>';
  choose('a', repo('x'));
  choose('b', repo('y'));
  await waitFor(() => expect(runs).toHaveLength(2));
  await act(async () => {
    runs[0].resolve(quality(evil));
    runs[1].resolve(quality('plain'));
  });
  expect(within(card('레포 A')).getByText(evil)).toBeTruthy();
  expect(container.querySelector('img')).toBeNull();
  fireEvent.click(brief());
  expect(screen.getByText(evil)).toBeTruthy();
  expect(container.querySelector('img')).toBeNull();
});
