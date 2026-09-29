import { expect, test } from 'vitest';
import { loadParsers } from '../../src/engine/parsers';
import { nodeLocate } from '../../src/engine/node';
import { measure } from '../../src/engine/complexity';

test('php method complexity', async () => {
  const { php } = await loadParsers(nodeLocate);
  const t = php.parse('<?php class A { function f($a) { if ($a && $b) {} foreach ($x as $y) {} } function g() {} }')!;
  expect(measure(t.rootNode, 'php')).toEqual({ functions: 2, complexity: 5, maxComplexity: 4 });
});

test('ts nested function counted separately', async () => {
  const { tsx } = await loadParsers(nodeLocate);
  const t = tsx.parse('function f(a){ if(a){} const g = () => a ? 1 : 2; }')!;
  expect(measure(t.rootNode, 'ts')).toEqual({ functions: 2, complexity: 4, maxComplexity: 2 });
});

test('branches outside functions only add to the total', async () => {
  const { tsx } = await loadParsers(nodeLocate);
  const t = tsx.parse('if (x) {} function f(){}')!;
  expect(measure(t.rootNode, 'ts')).toEqual({ functions: 1, complexity: 2, maxComplexity: 1 });
});

test('php operators, else-if, match, catch, ternary', async () => {
  const { php } = await loadParsers(nodeLocate);
  const src = '<?php function f($a){ if($a){} elseif($b){} else {} $x = $a ?? 1; $y = $a or $b; $z = $a ? 1 : 2; try{}catch(E $e){} $m = match($a){1=>2, default=>3}; switch($a){case 1: break;} while($a){} do{}while($a); for(;;){} $w = $a + 1; }';
  expect(measure(php.parse(src)!.rootNode, 'php')).toEqual({ functions: 1, complexity: 12, maxComplexity: 12 });
});

test('ts operators, switch, catch, loops', async () => {
  const { tsx } = await loadParsers(nodeLocate);
  const src = 'class C { m(a){ for(const k in a){} for(const v of a){} for(;;){} while(a){} do{}while(a); switch(a){case 1: break; default: break;} try{}catch(e){} return (a && a) || (a ?? a); } }';
  expect(measure(tsx.parse(src)!.rootNode, 'ts')).toEqual({ functions: 1, complexity: 11, maxComplexity: 11 });
});
