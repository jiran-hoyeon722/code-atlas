export type QuestId = 'walk' | 'run' | 'jump' | 'enter';

export const QUEST_KEY = 'code-atlas.walk.quest-done';

/** Plain text; **word** is shown as a key. */
export const QUEST: { id: QuestId; text: string }[] = [
  { id: 'walk', text: '**W A S D** 로 걸어 보기' },
  { id: 'run', text: '**Shift** 를 누른 채 달리기' },
  { id: 'jump', text: '**Space** 로 점프하기' },
  { id: 'enter', text: '건물 문 앞에서 **E** 로 들어가기' },
];

export interface Quest {
  /** True only the first time `id` is done. */
  mark(id: QuestId): boolean;
  has(id: QuestId): boolean;
  readonly count: number;
  readonly finished: boolean;
}

export function createQuest(): Quest {
  const done = new Set<QuestId>();
  return {
    mark(id) {
      if (done.has(id)) return false;
      done.add(id);
      return true;
    },
    has: (id) => done.has(id),
    get count() { return done.size; },
    get finished() { return done.size === QUEST.length; },
  };
}
