export type Cheat = 'tank' | 'helicopter' | 'car' | 'motorcycle';

const CODES = new Map<string, Cheat>([
  ['tank', 'tank'], ['탱크', 'tank'],
  ['helicopter', 'helicopter'], ['헬기', 'helicopter'], ['헬리콥터', 'helicopter'],
  ['car', 'car'], ['차', 'car'], ['자동차', 'car'],
  ['motorcycle', 'motorcycle'], ['오토바이', 'motorcycle'],
]);

export const parseCheat = (text: string): Cheat | null => CODES.get(text.trim().toLowerCase()) ?? null;
