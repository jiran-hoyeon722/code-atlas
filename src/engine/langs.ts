export type Lang = 'php' | 'ts' | 'py' | 'go' | 'java' | 'kotlin' | 'shell' | 'swift';

export type WasmFile =
  | 'web-tree-sitter.wasm'
  | 'tree-sitter-php.wasm'
  | 'tree-sitter-tsx.wasm'
  | 'tree-sitter-python.wasm'
  | 'tree-sitter-go.wasm'
  | 'tree-sitter-java.wasm'
  | 'tree-sitter-kotlin.wasm'
  | 'tree-sitter-bash.wasm'
  | 'tree-sitter-swift.wasm';

export interface LangSpec {
  label: string;
  exts: readonly string[];
  wasm: WasmFile;
  hljs: string;
  functions: ReadonlySet<string>;
  branches: ReadonlySet<string>;
  logical?: { node: string; ops: ReadonlySet<string>; caseInsensitive?: boolean };
}

const set = (...items: string[]): ReadonlySet<string> => new Set(items);

export const LANGS: Record<Lang, LangSpec> = {
  php: {
    label: 'PHP',
    exts: ['php'],
    wasm: 'tree-sitter-php.wasm',
    hljs: 'php',
    functions: set('function_definition', 'method_declaration', 'anonymous_function', 'arrow_function'),
    branches: set(
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
    ),
    logical: { node: 'binary_expression', ops: set('&&', '||', 'and', 'or', '??'), caseInsensitive: true },
  },
  ts: {
    label: 'TypeScript',
    exts: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'],
    wasm: 'tree-sitter-tsx.wasm',
    hljs: 'typescript',
    functions: set(
      'function_declaration',
      'function_expression',
      'arrow_function',
      'method_definition',
      'generator_function_declaration',
    ),
    branches: set(
      'if_statement',
      'for_statement',
      'for_in_statement',
      'while_statement',
      'do_statement',
      'switch_case',
      'catch_clause',
      'ternary_expression',
    ),
    logical: { node: 'binary_expression', ops: set('&&', '||', '??') },
  },
  py: {
    label: 'Python',
    exts: ['py'],
    wasm: 'tree-sitter-python.wasm',
    hljs: 'python',
    functions: set('function_definition', 'lambda'),
    branches: set(
      'if_statement',
      'elif_clause',
      'for_statement',
      'while_statement',
      'except_clause',
      'conditional_expression',
      'case_clause',
      'boolean_operator',
    ),
  },
  go: {
    label: 'Go',
    exts: ['go'],
    wasm: 'tree-sitter-go.wasm',
    hljs: 'go',
    functions: set('function_declaration', 'method_declaration', 'func_literal'),
    branches: set('if_statement', 'for_statement', 'expression_case', 'type_case', 'communication_case'),
    logical: { node: 'binary_expression', ops: set('&&', '||') },
  },
  java: {
    label: 'Java',
    exts: ['java'],
    wasm: 'tree-sitter-java.wasm',
    hljs: 'java',
    functions: set('method_declaration', 'constructor_declaration', 'lambda_expression'),
    branches: set(
      'if_statement',
      'for_statement',
      'enhanced_for_statement',
      'while_statement',
      'do_statement',
      'switch_label',
      'catch_clause',
      'ternary_expression',
    ),
    logical: { node: 'binary_expression', ops: set('&&', '||') },
  },
  kotlin: {
    label: 'Kotlin',
    exts: ['kt', 'kts'],
    wasm: 'tree-sitter-kotlin.wasm',
    hljs: 'kotlin',
    functions: set('function_declaration', 'anonymous_function', 'lambda_literal'),
    branches: set(
      'if_expression',
      'for_statement',
      'while_statement',
      'do_while_statement',
      'when_entry',
      'catch_block',
      'conjunction_expression',
      'disjunction_expression',
      'elvis_expression',
    ),
  },
  shell: {
    label: 'Shell',
    exts: ['sh', 'bash'],
    wasm: 'tree-sitter-bash.wasm',
    hljs: 'bash',
    functions: set('function_definition'),
    branches: set('if_statement', 'elif_clause', 'for_statement', 'c_style_for_statement', 'while_statement', 'case_item'),
  },
  swift: {
    label: 'Swift',
    exts: ['swift'],
    wasm: 'tree-sitter-swift.wasm',
    hljs: 'swift',
    functions: set('function_declaration', 'init_declaration', 'lambda_literal'),
    branches: set(
      'if_statement',
      'guard_statement',
      'for_statement',
      'while_statement',
      'repeat_while_statement',
      'switch_entry',
      'catch_block',
      'ternary_expression',
      'conjunction_expression',
      'disjunction_expression',
      'nil_coalescing_expression',
    ),
  },
};

export const ALL_LANGS: readonly Lang[] = ['php', 'ts', 'py', 'go', 'java', 'kotlin', 'shell', 'swift'];
