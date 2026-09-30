import { expect, test } from 'vitest';
import { loadParsers } from '../../src/engine/parsers';
import { nodeLocate } from '../../src/engine/node';
import type { Lang } from '../../src/engine/langs';

const SAMPLE: Record<Exclude<Lang, 'swift'>, string> = {
  php: '<?php namespace A; use B\\{C, D as E}; class X extends C {}',
  ts: "import type { A } from './a'; const x = <div/>; import('./b');",
  py: 'from .a import b\ndef f(x):\n  return x and 1\n',
  go: 'package a\nimport "b/c"\nfunc F(x int) int { return x }\n',
  java: 'package a;\nimport b.C;\nclass X { int f(int x) { return x; } }\n',
  kotlin: 'package a\nimport b.C\nfun f(x: Int): Int = x\n',
  shell: '#!/bin/sh\nsource ./a.sh\nf() { echo "$1"; }\n',
};

test.each(['php', 'ts', 'py', 'go', 'java', 'kotlin', 'shell'] as const)('%s grammar loads and parses', async (lang) => {
  const p = await loadParsers(nodeLocate, [lang]);
  expect(p.get(lang).parse(SAMPLE[lang])!.rootNode.hasError).toBe(false);
});

test('asking for an unloaded language throws', async () => {
  const p = await loadParsers(nodeLocate, ['php']);
  expect(() => p.get('go')).toThrow('parser for go is not loaded');
});

test('loadParsers is memoized per grammar', async () => {
  expect((await loadParsers(nodeLocate, ['py'])).get('py')).toBe((await loadParsers(nodeLocate, ['py'])).get('py'));
});
