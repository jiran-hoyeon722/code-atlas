import { expect, test } from 'vitest';
import { GUIDE, guideHtml } from '../../src/features/walk/walkGuide';

test('the guide walks through the five topics, each with keys to try', () => {
  expect(GUIDE.map((g) => g.title)).toEqual(['여기는 당신의 코드시티예요', '건물에 들어가 코드 보기', '라이벌 4명을 잡으세요', '날씨 · 무기 · 탈것', '바이러스 모드']);
  GUIDE.forEach((g) => expect(g.keys.length).toBeGreaterThan(0));
});

test('guide text is escaped before **bold** is applied', () => {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  expect(guideHtml('**E** 를 <눌러요>', esc)).toBe('<b>E</b> 를 &lt;눌러요&gt;');
  GUIDE.forEach((g) => expect(g.spot.length).toBeGreaterThan(0));
});
