import type { Node } from 'web-tree-sitter';
import { LANGS, type Lang } from '../langs';
import type { FnInfo } from './types';
import { CCN_TIERS, FOUR_STAR, LENGTH_TIERS, tierOf } from './rules';
import { codeLineMapper, codeLines } from './lines';

// Same tables as ../complexity.ts, copied so battle rules stay fixed when that module changes.
const FUNCTIONS: Partial<Record<Lang, ReadonlySet<string>>> = {
  php: new Set(['function_definition', 'method_declaration', 'anonymous_function', 'arrow_function']),
  ts: new Set([
    'function_declaration',
    'function_expression',
    'arrow_function',
    'method_definition',
    'generator_function_declaration',
  ]),
};

const BRANCHES: Partial<Record<Lang, ReadonlySet<string>>> = {
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

const OPERATORS: Partial<Record<Lang, ReadonlySet<string>>> = {
  php: new Set(['&&', '||', 'and', 'or', '??']),
  ts: new Set(['&&', '||', '??']),
};

function isBranch(node: Node, lang: Lang): boolean {
  const spec = LANGS[lang];
  if ((BRANCHES[lang] ?? spec.branches).has(node.type)) return true;
  const logical = spec.logical;
  if (!logical || node.type !== logical.node) return false;
  const op = node.childForFieldName('operator');
  return op !== null && (OPERATORS[lang] ?? logical.ops).has(lang === 'php' ? op.type.toLowerCase() : op.type);
}

export interface FunctionProfile {
  lines: number;
  functions: FnInfo[];
  ccnTier: number[];
  lenTier: number[];
}

export function measureFunctions(root: Node, lang: Lang, text: string): FunctionProfile {
  const physical = codeLines(text);
  const map = codeLineMapper(physical);
  const fnTypes = FUNCTIONS[lang] ?? LANGS[lang].functions;
  const functions: FnInfo[] = [];
  // Explicit stack: deeply nested code must not overflow the JS call stack.
  const stack: { node: Node; fn: number }[] = [{ node: root, fn: -1 }];
  while (stack.length > 0) {
    const { node, fn: parentFn } = stack.pop()!;
    let fn = parentFn;
    if (fnTypes.has(node.type)) {
      fn = functions.length;
      const startRow = node.startPosition.row;
      const end = node.endPosition;
      const endRow = end.column === 0 && end.row > startRow ? end.row - 1 : end.row;
      functions.push({ start: map.atOrAfter(startRow), end: map.atOrBefore(endRow), nloc: 0, ccn: 1 });
    } else if (fn >= 0 && isBranch(node, lang)) {
      functions[fn].ccn++;
    }
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child) stack.push({ node: child, fn });
    }
  }

  // Functions arrive in pre-order and nest, so a sweep with an open-function stack finds each line's innermost owner.
  const lines = physical.length;
  const owner = new Int32Array(lines).fill(-1);
  const open: number[] = [];
  let next = 0;
  for (let line = 0; line < lines; line++) {
    while (open.length > 0 && functions[open[open.length - 1]].end < line) open.pop();
    while (next < functions.length && functions[next].start <= line) {
      const f = functions[next];
      while (open.length > 0 && functions[open[open.length - 1]].end < f.start) open.pop();
      if (f.end >= line) open.push(next);
      next++;
    }
    if (open.length > 0) {
      const o = open[open.length - 1];
      owner[line] = o;
      functions[o].nloc++;
    }
  }

  const ccnTier = new Array<number>(lines).fill(0);
  const lenTier = new Array<number>(lines).fill(0);
  const fnCcn = functions.map((f) => tierOf(f.ccn, CCN_TIERS));
  const fnLen = functions.map((f) => tierOf(f.nloc, LENGTH_TIERS));
  for (let line = 0; line < lines; line++) {
    const o = owner[line];
    if (o < 0) continue;
    ccnTier[line] = fnCcn[o];
    lenTier[line] = fnLen[o];
  }
  return { lines, functions, ccnTier, lenTier };
}

export interface ReadabilityScores {
  complexityExcess: number;
  lengthExcess: number;
  readability: number;
}

function excess(
  files: readonly { functions: readonly FnInfo[] }[],
  prodLines: number,
  bands: readonly { above: number; max: number }[],
  value: (f: FnInfo) => number,
): number {
  if (prodLines <= 0) return 0;
  let worst = 0;
  for (const band of bands) {
    let sum = 0;
    for (const file of files) for (const f of file.functions) if (value(f) > band.above) sum += f.nloc;
    worst = Math.max(worst, sum / prodLines / band.max);
  }
  return worst;
}

export function readabilityScores(files: readonly { functions: readonly FnInfo[] }[], prodLines: number): ReadabilityScores {
  const complexityExcess = excess(files, prodLines, FOUR_STAR.complexity, (f) => f.ccn);
  const lengthExcess = excess(files, prodLines, FOUR_STAR.length, (f) => f.nloc);
  return { complexityExcess, lengthExcess, readability: (complexityExcess + lengthExcess) / 2 };
}
