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

  const split = (lang: Detection['lang'], files: string[]) => {
    const scope = splitScope({ lang, framework: null, sourceDir: '', routeDirs: [] }, repo(Object.fromEntries(files.map((f) => [f, 'x\n']))));
    return { prod: paths(scope.prod), tests: paths(scope.tests) };
  };

  test('go: _test.go files are tests', () => {
    expect(split('go', ['main.go', 'pkg/util/str.go', 'pkg/util/str_test.go'])).toEqual({
      prod: ['main.go', 'pkg/util/str.go'],
      tests: ['pkg/util/str_test.go'],
    });
  });

  test('java: src/test and *Test classes are tests', () => {
    expect(split('java', ['src/main/java/a/App.java', 'src/test/java/a/AppIT.java', 'lib/a/FooTest.java', 'lib/a/FooTests.java'])).toEqual({
      prod: ['src/main/java/a/App.java'],
      tests: ['lib/a/FooTest.java', 'lib/a/FooTests.java', 'src/test/java/a/AppIT.java'],
    });
  });

  test('kotlin: src/test, src/androidTest and *Test files are tests', () => {
    expect(split('kotlin', ['app/src/main/kotlin/a/Main.kt', 'app/src/test/kotlin/a/MainSpec.kt', 'app/src/androidTest/kotlin/a/Ui.kt', 'lib/FooTest.kt'])).toEqual({
      prod: ['app/src/main/kotlin/a/Main.kt'],
      tests: ['app/src/androidTest/kotlin/a/Ui.kt', 'app/src/test/kotlin/a/MainSpec.kt', 'lib/FooTest.kt'],
    });
  });

  test('swift: Tests folders and *Tests.swift files are tests', () => {
    expect(split('swift', ['Sources/Core/Model.swift', 'Tests/CoreTests/ModelSpec.swift', 'App/Feature/FeatureTests.swift'])).toEqual({
      prod: ['Sources/Core/Model.swift'],
      tests: ['App/Feature/FeatureTests.swift', 'Tests/CoreTests/ModelSpec.swift'],
    });
  });

  test('python: test_*.py, *_test.py and nested tests folders are tests', () => {
    expect(split('py', ['pkg/core.py', 'pkg/test_core.py', 'pkg/core_test.py', 'pkg/tests/helpers.py', 'tests/test_app.py'])).toEqual({
      prod: ['pkg/core.py'],
      tests: ['pkg/core_test.py', 'pkg/test_core.py', 'pkg/tests/helpers.py', 'tests/test_app.py'],
    });
  });

  test('php and ts keep the default test patterns', () => {
    for (const lang of ['php', 'ts'] as const) {
      const scope = splitScope({ lang, framework: null, sourceDir: '', routeDirs: [] }, repo({}));
      expect(scope.testPatterns).toEqual([...DEFAULT_TEST_PATTERNS]);
    }
  });
});
