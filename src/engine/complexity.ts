import type { Node } from 'web-tree-sitter';
import { LANGS, type Lang, type LangSpec } from './langs';

export interface Complexity {
  functions: number;
  complexity: number;
  maxComplexity: number;
}

function isBranch(node: Node, spec: LangSpec): boolean {
  if (spec.branches.has(node.type)) return true;
  const logical = spec.logical;
  if (!logical || node.type !== logical.node) return false;
  const op = node.childForFieldName('operator');
  // PHP keyword operators may be written in any case ("AND", "Or").
  return op !== null && logical.ops.has(logical.caseInsensitive ? op.type.toLowerCase() : op.type);
}

export function measure(root: Node, lang: Lang): Complexity {
  const spec = LANGS[lang];
  const fnTypes = spec.functions;
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
    } else if (isBranch(node, spec)) {
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
    maxComplexity: perFunction.reduce((a, b) => (b > a ? b : a), 0),
  };
}
