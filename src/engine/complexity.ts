import type { Node } from 'web-tree-sitter';
import type { Lang } from './types';

export interface Complexity {
  functions: number;
  complexity: number;
  maxComplexity: number;
}

const FUNCTIONS: Record<Lang, Set<string>> = {
  php: new Set(['function_definition', 'method_declaration', 'anonymous_function', 'arrow_function']),
  ts: new Set([
    'function_declaration',
    'function_expression',
    'arrow_function',
    'method_definition',
    'generator_function_declaration',
  ]),
};

const BRANCHES: Record<Lang, Set<string>> = {
  php: new Set([
    'if_statement',
    'else_if_clause',
    'for_statement',
    'foreach_statement',
    'while_statement',
    'do_statement',
    'case_statement',
    'catch_clause',
    'conditional_expression',
    'match_conditional_expression',
  ]),
  ts: new Set([
    'if_statement',
    'for_statement',
    'for_in_statement',
    'while_statement',
    'do_statement',
    'switch_case',
    'catch_clause',
    'ternary_expression',
  ]),
};

const OPERATORS: Record<Lang, Set<string>> = {
  php: new Set(['&&', '||', 'and', 'or', '??']),
  ts: new Set(['&&', '||', '??']),
};

function isBranch(node: Node, lang: Lang): boolean {
  if (BRANCHES[lang].has(node.type)) return true;
  if (node.type !== 'binary_expression') return false;
  const op = node.childForFieldName('operator');
  // PHP keyword operators may be written in any case ("AND", "Or").
  return op !== null && OPERATORS[lang].has(lang === 'php' ? op.type.toLowerCase() : op.type);
}

export function measure(root: Node, lang: Lang): Complexity {
  const fnTypes = FUNCTIONS[lang];
  const perFunction: number[] = [];
  let outside = 0;
  // Explicit stack: deeply nested code must not overflow the JS call stack.
  const stack: { node: Node; fn: number }[] = [{ node: root, fn: -1 }];
  while (stack.length > 0) {
    const { node, fn: parentFn } = stack.pop()!;
    let fn = parentFn;
    if (fnTypes.has(node.type)) {
      fn = perFunction.length;
      perFunction.push(1);
    } else if (isBranch(node, lang)) {
      if (fn >= 0) perFunction[fn]++;
      else outside++;
    }
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child) stack.push({ node: child, fn });
    }
  }
  const sum = perFunction.reduce((a, b) => a + b, 0);
  return {
    functions: perFunction.length,
    complexity: sum + outside,
    maxComplexity: perFunction.length ? Math.max(...perFunction) : 0,
  };
}
