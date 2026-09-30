import { describe, expect, test } from 'vitest';
import { compileRoles, presetFor } from '../../src/engine/presets';
import type { Detection } from '../../src/engine/detect';

// Timing is compared against a same-length benign pattern on the same input, so machine load cancels out.
const minMs = (fn: () => void, runs: number, reps: number) => {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    for (let k = 0; k < reps; k++) fn();
    best = Math.min(best, (performance.now() - start) / reps);
  }
  return best;
};

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

describe('compileRoles pathological patterns', () => {
  test('matching stays linear', () => {
    const hostile = compileRoles([role('P', 1, ['*a*a*a*a*a*a*a*a*a*a*b']), role('X', 3, [''])]);
    const benign = compileRoles([role('P', 1, ['*c*c*c*c*c*c*c*c*c*c*b']), role('X', 3, [''])]);
    // Ends in `b` so the literal-tail shortcut passes and the matcher itself must reject it.
    const input = `${'a'.repeat(40)}/b`;
    expect(hostile(input)).toBe(1);
    expect(hostile('xaaaaaaaaaab')).toBe(0);
    benign(input); // warm-up
    // Backtracking blow-up is exponential (ratio in the thousands); a linear matcher stays near 1.
    const tBenign = minMs(() => { benign(input); }, 5, 50);
    const tHostile = minMs(() => { hostile(input); }, 5, 1);
    expect(tHostile / Math.max(tBenign, 0.0005)).toBeLessThan(20);
  });

  test('consecutive star runs behave like one', () => {
    const m = compileRoles([role('S', 1, ['a/***/z']), role('D', 1, ['b/**/**/z']), role('X', 3, [''])]);
    expect(m('a/q/z')).toBe(0);
    expect(m('a/q/r/z')).toBe(0);
    expect(m('a/qz')).toBe(2);
    expect(m('b/z')).toBe(1);
    expect(m('b/q/r/z')).toBe(1);
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

  test('default preset treats glob characters in folder names literally', () => {
    const d: Detection = { lang: 'ts', framework: null, sourceDir: '', routeDirs: [] };
    const p = presetFor(d, ['a*b/x.ts', 'axxb/y.ts']);
    const m = compileRoles(p.roles);
    expect(p.roles.map((r) => r.name)).toEqual(['a*b', 'axxb', '기타']);
    expect(m('a*b/x.ts')).toBe(0);
    expect(m('axxb/y.ts')).toBe(1);
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

  test('python preset matches role folders and files anywhere in the path', () => {
    const d: Detection = { lang: 'py', framework: null, sourceDir: '', routeDirs: [] };
    const p = presetFor(d, []);
    const m = compileRoles(p.roles);
    const roleOf = (path: string) => p.roles[m(path)].name;
    expect(roleOf('api/users.py')).toBe('진입점');
    expect(roleOf('shop/web/views.py')).toBe('진입점');
    expect(roleOf('manage.py')).toBe('진입점');
    expect(roleOf('shop/services/pay.py')).toBe('서비스');
    expect(roleOf('shop/models.py')).toBe('모델/데이터');
    expect(roleOf('a/b/db/session.py')).toBe('모델/데이터');
    expect(roleOf('shop/core/base.py')).toBe('공용/설정');
    expect(roleOf('tests/test_a.py')).toBe('테스트');
    expect(roleOf('tests/api/test_b.py')).toBe('테스트');
    expect(roleOf('shop/myapi/x.py')).toBe('기타');
    expect(roleOf('shop/oldviews.py')).toBe('기타');
    expect(p.layers.map((l) => l.label)).toEqual(['진입점', '애플리케이션', '도메인', '기반']);
    expect(p.roles[p.roles.length - 1]).toMatchObject({ name: '기타', patterns: [''] });
  });
  test('go preset: tests first, then entry, application, domain, foundation', () => {
    const d: Detection = { lang: 'go', framework: null, sourceDir: '', routeDirs: [] };
    const p = presetFor(d, []);
    const m = compileRoles(p.roles);
    const roleOf = (path: string) => p.roles[m(path)].name;
    expect(p.roles[0].name).toBe('테스트');
    expect(roleOf('internal/handler/user_test.go')).toBe('테스트');
    expect(roleOf('main.go')).toBe('진입점');
    expect(roleOf('cmd/api/run.go')).toBe('진입점');
    expect(roleOf('internal/handler/user.go')).toBe('진입점');
    expect(roleOf('app/services/pay.go')).toBe('애플리케이션');
    expect(roleOf('internal/store/db.go')).toBe('도메인');
    expect(roleOf('internal/auth/token.go')).toBe('기반');
    expect(roleOf('pkg/util/strings.go')).toBe('기반');
    expect(roleOf('tools/lint.go')).toBe('기타');
    expect(p.layers.map((l) => l.label)).toEqual(['진입점', '애플리케이션', '도메인', '기반']);
    expect(p.roles[p.roles.length - 1]).toMatchObject({ name: '기타', patterns: [''] });
  });
  test('java preset: tests first, then Spring-style entry, application, domain, foundation', () => {
    const d: Detection = { lang: 'java', framework: null, sourceDir: '', routeDirs: [] };
    const p = presetFor(d, []);
    const m = compileRoles(p.roles);
    const roleOf = (path: string) => p.roles[m(path)].name;
    expect(p.roles[0].name).toBe('테스트');
    expect(roleOf('src/test/java/a/controller/HomeControllerIT.java')).toBe('테스트');
    expect(roleOf('mod/src/test/java/a/Helper.java')).toBe('테스트');
    expect(roleOf('src/main/java/a/service/OrderServiceTest.java')).toBe('테스트');
    expect(roleOf('src/main/java/a/OrderTests.java')).toBe('테스트');
    expect(roleOf('controller/Home.java')).toBe('진입점');
    expect(roleOf('src/main/java/a/web/Home.java')).toBe('진입점');
    expect(roleOf('src/main/java/a/ShopApplication.java')).toBe('진입점');
    expect(roleOf('src/main/java/a/usecase/Pay.java')).toBe('애플리케이션');
    expect(roleOf('src/main/java/a/application/Pay.java')).toBe('애플리케이션');
    expect(roleOf('src/main/java/a/entity/User.java')).toBe('도메인');
    expect(roleOf('src/main/java/a/dto/UserDto.java')).toBe('도메인');
    expect(roleOf('src/main/java/a/exception/Oops.java')).toBe('기반');
    expect(roleOf('src/main/java/a/Contest.java')).toBe('기타');
    expect(p.layers.map((l) => l.label)).toEqual(['진입점', '애플리케이션', '도메인', '기반']);
    expect(p.roles[p.roles.length - 1]).toMatchObject({ name: '기타', patterns: [''] });
  });
  test('kotlin preset: tests first, then Java roles with Android UI entry points', () => {
    const d: Detection = { lang: 'kotlin', framework: null, sourceDir: '', routeDirs: [] };
    const p = presetFor(d, []);
    const m = compileRoles(p.roles);
    const roleOf = (path: string) => p.roles[m(path)].name;
    expect(p.roles[0].name).toBe('테스트');
    expect(roleOf('src/test/kotlin/a/ui/HomeScreenIT.kt')).toBe('테스트');
    expect(roleOf('app/src/androidTest/kotlin/a/Helper.kt')).toBe('테스트');
    expect(roleOf('src/main/kotlin/a/viewmodel/HomeViewModelTest.kt')).toBe('테스트');
    expect(roleOf('ui/Home.kt')).toBe('진입점');
    expect(roleOf('app/src/main/kotlin/a/viewmodel/HomeViewModel.kt')).toBe('진입점');
    expect(roleOf('app/src/main/kotlin/a/activity/MainActivity.kt')).toBe('진입점');
    expect(roleOf('app/src/main/kotlin/a/fragment/ListFragment.kt')).toBe('진입점');
    expect(roleOf('src/main/kotlin/a/ShopApplication.kt')).toBe('진입점');
    expect(roleOf('src/main/kotlin/a/service/Pay.kt')).toBe('애플리케이션');
    expect(roleOf('src/main/kotlin/a/domain/User.kt')).toBe('도메인');
    expect(roleOf('src/main/kotlin/a/util/Strings.kt')).toBe('기반');
    expect(roleOf('src/main/kotlin/a/Contest.kt')).toBe('기타');
    expect(p.layers.map((l) => l.label)).toEqual(['진입점', '애플리케이션', '도메인', '기반']);
    expect(p.roles[p.roles.length - 1]).toMatchObject({ name: '기타', patterns: [''] });
  });
  test('swift preset: tests first, then iOS folder conventions', () => {
    const d: Detection = { lang: 'swift', framework: null, sourceDir: '', routeDirs: [] };
    const p = presetFor(d, []);
    const m = compileRoles(p.roles);
    const roleOf = (path: string) => p.roles[m(path)].name;
    expect(p.roles[0].name).toBe('테스트');
    expect(roleOf('Tests/KitTests/Views/HomeViewTests.swift')).toBe('테스트');
    expect(roleOf('ShopTests/Models/CartTests.swift')).toBe('테스트');
    expect(roleOf('Shop/App/Main.swift')).toBe('진입점');
    expect(roleOf('ShopApp.swift')).toBe('진입점');
    expect(roleOf('Shop/AppDelegate.swift')).toBe('진입점');
    expect(roleOf('Shop/SceneDelegate.swift')).toBe('진입점');
    expect(roleOf('Sources/Shop/Views/CartView.swift')).toBe('진입점');
    expect(roleOf('Shop/Screens/Home/HomeScreen.swift')).toBe('진입점');
    expect(roleOf('Sources/Shop/ViewModels/CartViewModel.swift')).toBe('애플리케이션');
    expect(roleOf('Shop/Coordinators/Flow.swift')).toBe('애플리케이션');
    expect(roleOf('Shop/Features/Pay/PayFlow.swift')).toBe('애플리케이션');
    expect(roleOf('Sources/Shop/Models/Cart.swift')).toBe('도메인');
    expect(roleOf('Shop/Networking/Client.swift')).toBe('도메인');
    expect(roleOf('Shop/Repositories/CartRepo.swift')).toBe('도메인');
    expect(roleOf('Sources/Shop/Extensions/String+Trim.swift')).toBe('기반');
    expect(roleOf('Shop/Utilities/Log.swift')).toBe('기반');
    expect(roleOf('Shop/Contest.swift')).toBe('기타');
    expect(roleOf('Package.swift')).toBe('기타');
    expect(p.layers.map((l) => l.label)).toEqual(['진입점', '애플리케이션', '도메인', '기반']);
    expect(p.roles[p.roles.length - 1]).toMatchObject({ name: '기타', patterns: [''] });
  });
});
