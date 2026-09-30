import { describe, expect, test } from 'vitest';
import type { Detection } from '../../../src/engine/detect';
import type { RepoInput } from '../../../src/engine/types';
import { splitScope } from '../../../src/engine/battle/scope';
import { DEFAULT_EXCLUDE, DEFAULT_TEST_PATTERNS } from '../../../src/engine/battle/rules';

const repo = (files: Record<string, string>): RepoInput => ({
  name: 'fake',
  files: Object.entries(files).map(([path, text]) => ({ path, text })),
  configs: {},
});
const paths = (files: { path: string }[]) => files.map((f) => f.path);

describe('splitScope', () => {
  test('laravel: prod under app, tests under the repo-level tests folder', () => {
    const detection: Detection = { lang: 'php', framework: 'laravel', sourceDir: 'app', routeDirs: ['routes'] };
    const scope = splitScope(detection, repo({
      'app/Models/User.php': '<?php\nclass User {}\n',
      'app/Http/Kernel.php': '<?php\n',
      'routes/web.php': '<?php\n',
      'tests/Feature/UserTest.php': '<?php\nclass UserTest {}\n',
      'tests/fixtures/data.json': '{}',
      'resources/js/app.ts': 'x',
    }));
    expect(paths(scope.prod)).toEqual(['app/Http/Kernel.php', 'app/Models/User.php']);
    expect(paths(scope.tests)).toEqual(['tests/Feature/UserTest.php']);
    expect(scope.excludedLines).toBe(0);
    expect(scope.testPatterns).toEqual([...DEFAULT_TEST_PATTERNS]);
    expect(scope.exclude).toEqual([...DEFAULT_EXCLUDE]);
  });

  test('react: test and spec files and __tests__ folders are tests, .d.ts is excluded', () => {
    const detection: Detection = { lang: 'ts', framework: 'react', sourceDir: 'src', routeDirs: [] };
    const scope = splitScope(detection, repo({
      'src/App.tsx': 'export const App = 1;\n',
      'src/App.test.tsx': 'test(1);\n\ntest(2);\n',
      'src/util/format.spec.ts': 'x;\n',
      'src/util/__tests__/format.ts': 'y;\n',
      'src/util/format.ts': 'export {};\n',
      'src/env.d.ts': 'declare const a: 1;\n\ndeclare const b: 2;\n',
      'src/api.gen.ts': 'export const g = 1;\n',
      'e2e/login.test.ts': 'z;\n',
      'README.md': '# x',
    }));
    expect(paths(scope.prod)).toEqual(['src/App.tsx', 'src/util/format.ts']);
    expect(paths(scope.tests)).toEqual(['e2e/login.test.ts', 'src/App.test.tsx', 'src/util/__tests__/format.ts', 'src/util/format.spec.ts']);
    expect(scope.excludedLines).toBe(3);
  });

  test('a test file matching an exclude pattern is not counted as excluded', () => {
    const detection: Detection = { lang: 'ts', framework: null, sourceDir: '', routeDirs: [] };
    const scope = splitScope(detection, repo({
      'a.ts': 'a;\n',
      'tests/types.d.ts': 'declare const t: 1;\n',
    }));
    expect(paths(scope.prod)).toEqual(['a.ts']);
    expect(paths(scope.tests)).toEqual(['tests/types.d.ts']);
    expect(scope.excludedLines).toBe(0);
  });
});
