import { expect, test } from 'vitest';
import { GUIDE } from '../../src/features/walk/walkGuide';

test('the guide walks through the five topics, each with keys to try', () => {
  expect(GUIDE.map((g) => g.title)).toEqual(['여기는 당신의 코드시티예요', '건물에 들어가 코드 보기', '라이벌 4명을 잡으세요', '날씨 · 무기 · 탈것', '바이러스 모드']);
  GUIDE.forEach((g) => expect(g.keys.length).toBeGreaterThan(0));
});
