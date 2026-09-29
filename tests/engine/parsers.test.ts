import { expect, test } from 'vitest';
import { loadParsers, nodeLocate } from '../../src/engine/parsers';

test('parses PHP and TSX without syntax errors', async () => {
  const p = await loadParsers(nodeLocate);
  expect(p.php.parse('<?php namespace A; use B\\{C, D as E}; class X extends C {}')!.rootNode.hasError).toBe(false);
  expect(p.tsx.parse("import type { A } from './a'; const x = <div/>; import('./b');")!.rootNode.hasError).toBe(false);
});

test('loadParsers is memoized', async () => {
  expect(await loadParsers(nodeLocate)).toBe(await loadParsers(nodeLocate));
});
