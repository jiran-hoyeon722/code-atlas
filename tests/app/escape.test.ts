import { expect, test } from 'vitest';
import { esc } from '../../src/features/escape';

test('escapes html', () => { expect(esc('<img src=x onerror="a">&\'')).toBe('&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;'); });
