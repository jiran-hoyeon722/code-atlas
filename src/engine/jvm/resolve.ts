import type { FileFacts, ProjectIndex } from '../link';

// Built once per index; the linker passes the same facts map for every import of a run.
const scopeCache = new WeakMap<ReadonlyMap<string, FileFacts>, Set<string>>();

function scopesOf(facts: ReadonlyMap<string, FileFacts>): Set<string> {
  let scopes = scopeCache.get(facts);
  if (scopes) return scopes;
  scopes = new Set();
  for (const f of facts.values()) if (f.scope !== '') scopes.add(f.scope);
  scopeCache.set(facts, scopes);
  return scopes;
}

/**
 * `a.b.C` → the file declaring `C` in package `a.b`; members and nested classes fall back
 * one segment at a time (`a.b.C.m` → (a.b.C, m) → (a.b, C)). Wildcards are `[]`: mentions link them.
 * Not found → `null` when a project package is a dot-prefix of the specifier, else `[]` (JDK, libraries).
 */
export function resolveJvmImport(specifier: string, index: ProjectIndex): string[] | null {
  if (specifier.endsWith('.*')) return [];
  const parts = specifier.split('.');
  for (let k = parts.length - 1; k >= 1; k--) {
    const scope = parts.slice(0, k).join('.');
    const hits = (index.bySymbol.get(parts[k]) ?? []).filter((p) => index.facts.get(p)?.scope === scope);
    if (hits.length > 0) return hits;
  }
  const scopes = scopesOf(index.facts);
  for (let k = parts.length - 1; k >= 1; k--) {
    if (scopes.has(parts.slice(0, k).join('.'))) return null;
  }
  return [];
}
