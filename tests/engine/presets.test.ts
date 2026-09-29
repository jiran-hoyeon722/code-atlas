import { describe, expect, test } from 'vitest';
import { compileRoles, presetFor } from '../../src/engine/presets';
import type { Detection } from '../../src/engine/detect';

const role = (name: string, layer: 0 | 1 | 2 | 3, patterns: string[]) => ({ name, layer, patterns, description: '' });

describe('compileRoles', () => {
  test('glob role patterns', () => {
    const m = compileRoles([role('H', 1, ['components/**/hooks/']), role('C', 1, ['components/']), role('X', 3, [''])]);
    expect(m('components/a/b/hooks/useX.ts')).toBe(0);
    expect(m('components/hooks/y.ts')).toBe(0);
    expect(m('components/a/x.tsx')).toBe(1);
    expect(m('main.tsx')).toBe(2);
  });

  test('pattern escaping', () => {
    const m = compileRoles([role('K', 0, ['Http/Kernel.php']), role('X', 3, [''])]);
    expect(m('Http/Kernel.php')).toBe(0);
    expect(m('Http/KernelXphp')).toBe(1);
  });

  test('single star spans one segment', () => {
    const m = compileRoles([role('S', 1, ['a/*/z/']), role('X', 3, [''])]);
    expect(m('a/b/z/f.ts')).toBe(0);
    expect(m('a/b/c/z/f.ts')).toBe(1);
  });
});

describe('presetFor', () => {
  const laravel: Detection = { lang: 'php', framework: 'laravel', sourceDir: 'app', routeDirs: ['routes'] };
  const react: Detection = { lang: 'ts', framework: 'react', sourceDir: 'src', routeDirs: [] };

  test('laravel preset maps standard folders', () => {
    const p = presetFor(laravel, []);
    const m = compileRoles(p.roles);
    const at = (path: string) => p.roles[m(path.slice('app/'.length))];
    expect(at('app/Http/Controllers/X.php').name).toBe('Controller');
    expect(at('app/Http/Controllers/X.php').layer).toBe(0);
    expect(at('app/Models/U.php').layer).toBe(2);
    expect(at('app/Foo/Bar.php').name).toBe('기타');
    expect(at('app/Foo/Bar.php').layer).toBe(3);
    expect(p.layers.map((l) => l.key)).toEqual(['entry', 'application', 'domain', 'foundation']);
  });

  test('react preset maps standard folders', () => {
    const p = presetFor(react, []);
    const m = compileRoles(p.roles);
    const layerOf = (inner: string) => p.roles[m(inner)].layer;
    expect(layerOf('main.tsx')).toBe(0);
    expect(layerOf('pages/Home.tsx')).toBe(0);
    expect(layerOf('features/a/x.ts')).toBe(1);
    expect(layerOf('components/a/hooks/useX.ts')).toBe(1);
    expect(layerOf('store/user.ts')).toBe(2);
    expect(layerOf('components/ui/Button.tsx')).toBe(3);
    expect(layerOf('utils/x.ts')).toBe(3);
    expect(layerOf('weird/x.ts')).toBe(3);
    expect(p.layers[1].label).toBe('화면·기능');
    expect(p.roles[p.roles.length - 1].patterns).toEqual(['']);
  });

  test('default preset makes one role per first-level folder', () => {
    const d: Detection = { lang: 'ts', framework: null, sourceDir: 'lib', routeDirs: [] };
    const p = presetFor(d, ['lib/alpha/a.ts', 'lib/alpha/b/c.ts', 'lib/beta/d.ts', 'lib/root.ts', 'other/x.ts']);
    const m = compileRoles(p.roles);
    expect(p.roles.map((r) => r.name)).toEqual(['alpha', 'beta', '기타']);
    expect(p.roles.every((r) => r.layer === 3)).toBe(true);
    expect(m('alpha/a.ts')).toBe(0);
    expect(m('beta/d.ts')).toBe(1);
    expect(m('root.ts')).toBe(2);
  });
});
