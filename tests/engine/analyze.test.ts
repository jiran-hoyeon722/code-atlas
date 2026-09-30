import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { loadParsers, type Parsers } from '../../src/engine/parsers';
import { nodeLocate } from '../../src/engine/node';
import { isSourcePath, isConfigPath } from '../../src/engine/collect';
import { analyze, UnsupportedRepoError, type Progress } from '../../src/engine/analyze';
import type { RepoInput } from '../../src/engine/types';

function loadRepo(name: string): RepoInput {
  const dir = join(__dirname, '../fixtures', name);
  const input: RepoInput = { name, files: [], configs: {} };
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else {
        const path = relative(dir, abs).split('\\').join('/');
        if (isSourcePath(path)) input.files.push({ path, text: readFileSync(abs, 'utf8') });
        else if (isConfigPath(path)) input.configs[path] = readFileSync(abs, 'utf8');
      }
    }
  };
  walk(dir);
  return input;
}

const NOW = new Date('2026-01-01T00:00:00Z');
let parsers: Parsers;
beforeAll(async () => {
  parsers = await loadParsers(nodeLocate, ['php', 'ts', 'py', 'go', 'java', 'kotlin']);
});

describe('analyze', () => {
  test('laravel fixture end to end', () => {
    const input = loadRepo('laravel-mini');
    const phpUnderApp = input.files.filter((f) => f.path.startsWith('app/')).length;
    const a = analyze(input, parsers, { now: NOW });
    expect(a.framework).toBe('laravel');
    expect(a.lang).toBe('php');
    expect(a.nodes.length).toBe(phpUnderApp);
    const controller = a.nodes.find((n) => n.path === 'app/Http/Controllers/PostController.php')!;
    expect(a.roles[controller.role].name).toBe('Controller');
  });

  test('react fixture end to end', () => {
    const a = analyze(loadRepo('react-mini'), parsers, { now: NOW });
    expect(a.framework).toBe('react');
    expect(a.nodes.some((n) => n.path.endsWith('routeTree.gen.ts'))).toBe(false);
    expect(a.nodes.length).toBe(9);
  });

  test('py fixture end to end', () => {
    const a = analyze(loadRepo('py-mini'), parsers, { now: NOW });
    expect(a.lang).toBe('py');
    expect(a.framework).toBeNull();
    expect(a.nodes.length).toBe(10);
    const path = (i: number) => a.nodes[i].path;
    expect(a.edges.map(([from, to]) => `${path(from)}→${path(to)}`).sort()).toEqual([
      'shop/api/views.py→shop/api/__init__.py',
      'shop/api/views.py→shop/api/sibling.py',
      'shop/api/views.py→shop/core/__init__.py',
      'shop/api/views.py→shop/models/order.py',
      'shop/models/order.py→src/billing/tasks/charge.py',
      'tests/test_views.py→shop/api/views.py',
    ]);
    expect(a.unresolved).toBe(1);
    expect(a.failed).toEqual([{ path: 'shop/utils/broken.py', reason: 'syntax' }]);
    const byRole: Record<string, string[]> = {};
    for (const n of a.nodes) (byRole[a.roles[n.role].name] ??= []).push(n.path);
    expect(byRole).toEqual({
      진입점: ['shop/api/__init__.py', 'shop/api/sibling.py', 'shop/api/views.py'],
      서비스: ['src/billing/tasks/charge.py'],
      '모델/데이터': ['shop/models/order.py'],
      '공용/설정': ['shop/core/__init__.py', 'shop/utils/broken.py'],
      테스트: ['tests/test_views.py'],
      기타: ['shop/__init__.py', 'src/billing/__init__.py'],
    });
    expect(a.nodes.find((n) => n.path === 'tests/test_views.py')!.kind).toBe('test');
    expect(a.nodes.find((n) => n.path === 'shop/api/__init__.py')!.name).toBe('api/__init__');
  });

  test('go fixture end to end', () => {
    const input = loadRepo('go-mini');
    expect(Object.keys(input.configs).sort()).toEqual(['go.mod', 'tools/go.mod']);
    const a = analyze(input, parsers, { now: NOW });
    expect(a.lang).toBe('go');
    expect(a.framework).toBeNull();
    expect(a.nodes.length).toBe(8);
    const path = (i: number) => a.nodes[i].path;
    expect(a.edges.map(([from, to]) => `${path(from)}→${path(to)}`).sort()).toEqual([
      'cmd/shop/main.go→internal/service/order.go',
      'cmd/shop/main.go→pkg/util/strings.go',
      'internal/service/order.go→internal/model/item.go',
      'internal/service/order.go→internal/model/order.go',
      'internal/service/order_test.go→internal/model/item.go',
      'internal/service/order_test.go→internal/model/order.go',
      'tools/gen/main.go→tools/lint/lint.go',
    ]);
    expect(a.unresolved).toBe(1);
    expect(a.failed).toEqual([]);
    const byRole: Record<string, string[]> = {};
    for (const n of a.nodes) (byRole[a.roles[n.role].name] ??= []).push(n.path);
    expect(byRole).toEqual({
      테스트: ['internal/service/order_test.go'],
      진입점: ['cmd/shop/main.go', 'tools/gen/main.go'],
      애플리케이션: ['internal/service/order.go'],
      도메인: ['internal/model/item.go', 'internal/model/order.go'],
      기반: ['pkg/util/strings.go'],
      기타: ['tools/lint/lint.go'],
    });
    const kind = (p: string) => a.nodes.find((n) => n.path === p)!.kind;
    expect(kind('internal/service/order_test.go')).toBe('test');
    expect(kind('cmd/shop/main.go')).toBe('main');
    expect(kind('internal/model/order.go')).toBe('module');
  });

  test('java fixture end to end', () => {
    const a = analyze(loadRepo('java-mini'), parsers, { now: NOW });
    expect(a.lang).toBe('java');
    expect(a.framework).toBeNull();
    expect(a.nodes.length).toBe(8);
    const J = 'src/main/java/com/acme/shop';
    const T = 'src/test/java/com/acme/shop';
    const path = (i: number) => a.nodes[i].path;
    expect(a.edges.map(([from, to]) => `${path(from)}→${path(to)}`).sort()).toEqual([
      `${J}/ShopApplication.java→${J}/controller/OrderController.java`,
      `${J}/controller/OrderController.java→${J}/domain/Order.java`,
      `${J}/controller/OrderController.java→${J}/service/OrderService.java`,
      `${J}/domain/Order.java→${J}/domain/OrderStatus.java`,
      `${J}/service/OrderService.java→${J}/domain/Order.java`,
      `${J}/service/OrderService.java→${J}/service/PriceCalculator.java`,
      `${J}/service/OrderService.java→${J}/util/Money.java`,
      `${T}/service/OrderServiceTest.java→${J}/service/OrderService.java`,
    ]);
    const kinds = Object.fromEntries(a.edges.map(([from, to, , k]) => [`${path(from)}→${path(to)}`, k]));
    expect(kinds).toEqual({
      [`${J}/ShopApplication.java→${J}/controller/OrderController.java`]: { import: 1 },
      [`${J}/controller/OrderController.java→${J}/domain/Order.java`]: { import: 1 },
      [`${J}/controller/OrderController.java→${J}/service/OrderService.java`]: { 'class-ref': 2 },
      [`${J}/domain/Order.java→${J}/domain/OrderStatus.java`]: { 'class-ref': 4 },
      [`${J}/service/OrderService.java→${J}/domain/Order.java`]: { import: 1 },
      [`${J}/service/OrderService.java→${J}/service/PriceCalculator.java`]: { 'class-ref': 1 },
      [`${J}/service/OrderService.java→${J}/util/Money.java`]: { import: 1 },
      [`${T}/service/OrderServiceTest.java→${J}/service/OrderService.java`]: { 'class-ref': 2 },
    });
    expect(a.unresolved).toBe(1);
    expect(a.failed).toEqual([]);
    const byRole: Record<string, string[]> = {};
    for (const n of a.nodes) (byRole[a.roles[n.role].name] ??= []).push(n.path);
    expect(byRole).toEqual({
      진입점: [`${J}/ShopApplication.java`, `${J}/controller/OrderController.java`],
      도메인: [`${J}/domain/Order.java`, `${J}/domain/OrderStatus.java`],
      애플리케이션: [`${J}/service/OrderService.java`, `${J}/service/PriceCalculator.java`],
      기반: [`${J}/util/Money.java`],
      테스트: [`${T}/service/OrderServiceTest.java`],
    });
    const kind = (p: string) => a.nodes.find((n) => n.path === p)!.kind;
    expect(kind(`${J}/service/PriceCalculator.java`)).toBe('interface');
    expect(kind(`${J}/domain/Order.java`)).toBe('class');
    expect(kind(`${T}/service/OrderServiceTest.java`)).toBe('test');
  });

  test('kotlin fixture end to end', () => {
    const a = analyze(loadRepo('kotlin-mini'), parsers, { now: NOW });
    expect(a.lang).toBe('kotlin');
    expect(a.framework).toBeNull();
    expect(a.nodes.length).toBe(7);
    const K = 'src/main/kotlin/com/acme/notes';
    const T = 'src/test/kotlin/com/acme/notes';
    const path = (i: number) => a.nodes[i].path;
    expect(a.nodes.some((n) => n.path.endsWith('.gradle.kts'))).toBe(false);
    const kinds = Object.fromEntries(a.edges.map(([from, to, , k]) => [`${path(from)}→${path(to)}`, k]));
    expect(kinds).toEqual({
      [`${K}/NotesApp.kt→${K}/ui/NoteScreen.kt`]: { import: 1 },
      [`${K}/ui/NoteScreen.kt→${K}/viewmodel/NoteViewModel.kt`]: { import: 1 },
      [`${K}/viewmodel/NoteViewModel.kt→${K}/domain/Models.kt`]: { 'class-ref': 3 },
      [`${K}/viewmodel/NoteViewModel.kt→${K}/domain/NoteRepository.kt`]: { 'class-ref': 1 },
      [`${K}/viewmodel/NoteViewModel.kt→${K}/util/Strings.kt`]: { import: 1 },
      [`${K}/domain/NoteRepository.kt→${K}/domain/Models.kt`]: { 'class-ref': 1 },
      [`${T}/viewmodel/NoteViewModelTest.kt→${K}/viewmodel/NoteViewModel.kt`]: { 'class-ref': 1 },
    });
    expect(a.edges.map(([from, to]) => `${path(from)}→${path(to)}`).sort()).toEqual(Object.keys(kinds).sort());
    expect(a.unresolved).toBe(1);
    expect(a.failed).toEqual([]);
    const byRole: Record<string, string[]> = {};
    for (const n of a.nodes) (byRole[a.roles[n.role].name] ??= []).push(n.path);
    expect(byRole).toEqual({
      기타: [`${K}/NotesApp.kt`],
      도메인: [`${K}/domain/Models.kt`, `${K}/domain/NoteRepository.kt`],
      진입점: [`${K}/ui/NoteScreen.kt`, `${K}/viewmodel/NoteViewModel.kt`],
      기반: [`${K}/util/Strings.kt`],
      테스트: [`${T}/viewmodel/NoteViewModelTest.kt`],
    });
    const node = (p: string) => a.nodes.find((n) => n.path === p)!;
    expect(node(`${K}/domain/Models.kt`)).toMatchObject({ name: 'Models', kind: 'class' });
    expect(node(`${K}/NotesApp.kt`).kind).toBe('class');
    expect(node(`${K}/domain/NoteRepository.kt`).kind).toBe('interface');
    expect(node(`${K}/util/Strings.kt`).kind).toBe('module');
    expect(node(`${T}/viewmodel/NoteViewModelTest.kt`).kind).toBe('test');
  });

  test('progress events', () => {
    const input = loadRepo('laravel-mini');
    const events: Progress[] = [];
    analyze(input, parsers, { onProgress: (p) => events.push(p), now: NOW });
    const parse = events.filter((e): e is Extract<Progress, { phase: 'parse' }> => e.phase === 'parse');
    const total = input.files.filter((f) => f.path.startsWith('app/')).length;
    expect(parse.length).toBe(total);
    expect(parse.map((e) => e.done)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(parse.every((e) => e.total === total)).toBe(true);
    expect(parse.at(-1)!.done).toBe(parse.at(-1)!.total);
    const ctrl = parse.find((e) => e.path === 'app/Http/Controllers/PostController.php')!;
    expect(ctrl.role).toBeGreaterThanOrEqual(0);
    expect(events.slice(total).map((e) => e.phase)).toEqual(['link', 'metrics']);
  });

  test('react progress excludes generated files', () => {
    const events: Progress[] = [];
    analyze(loadRepo('react-mini'), parsers, { onProgress: (p) => events.push(p), now: NOW });
    const parse = events.filter((e) => e.phase === 'parse');
    expect(parse.length).toBe(9);
    expect(parse.some((e) => e.phase === 'parse' && e.path.endsWith('.gen.ts'))).toBe(false);
  });

  test('unsupported repo', () => {
    const input: RepoInput = { name: 'x', files: [], configs: {} };
    expect(() => analyze(input, parsers, { now: NOW })).toThrow(UnsupportedRepoError);
  });

  test('output is JSON-serializable and stable', () => {
    const input = loadRepo('react-mini');
    const a = analyze(input, parsers, { now: NOW });
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(analyze(input, parsers, { now: NOW })).toEqual(a);
  });

  test('options object: prefer picks the language on mixed input', () => {
    const input: RepoInput = {
      name: 'mixed',
      files: [
        { path: 'a.php', text: '<?php class A {}' },
        { path: 'b.php', text: '<?php class B {}' },
        { path: 'c.ts', text: 'export const c = 1;' },
      ],
      configs: {},
    };
    expect(analyze(input, parsers, { now: NOW }).lang).toBe('php');
    expect(analyze(input, parsers, { prefer: 'ts', now: NOW }).lang).toBe('ts');
  });
});
