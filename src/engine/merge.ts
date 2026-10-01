import type { Architecture } from './architecture';
import { LANGS } from './langs';
import { layers, type Role } from './presets';
import type { Lang } from './types';

const SEP = ' · ';

const prefixed = (lang: Lang, roles: Role[]): Role[] =>
  roles.map((r) => ({ ...r, name: `${LANGS[lang].label}${SEP}${r.name}`, patterns: [...r.patterns] }));

/** Preset role names never contain ' · ', so the first one ends the language prefix. */
export function baseRoleName(name: string): string {
  const at = name.indexOf(SEP);
  return at < 0 ? name : name.slice(at + SEP.length);
}

export function mergeRoles(parts: { lang: Lang; roles: Role[] }[]): Role[] {
  return parts.flatMap((p) => prefixed(p.lang, p.roles));
}

/** parts[0] 이 주 언어. parts 가 하나면 그대로 돌려준다(새 필드 없음). */
export function mergeArchitectures(parts: Architecture[]): Architecture {
  if (parts.length === 0) throw new Error('mergeArchitectures needs at least one part');
  if (parts.length === 1) return parts[0];
  const [main] = parts;
  const nodes: Architecture['nodes'] = [];
  const edges: Architecture['edges'] = [];
  let roleBase = 0;
  for (const part of parts) {
    const nodeBase = nodes.length;
    for (const n of part.nodes) nodes.push({ ...n, role: n.role + roleBase, lang: part.lang });
    for (const [from, to, weight, kinds, upward] of part.edges) edges.push([from + nodeBase, to + nodeBase, weight, { ...kinds }, upward]);
    roleBase += part.roles.length;
  }
  return {
    version: 1,
    name: main.name,
    lang: main.lang,
    framework: null,
    sourceDir: '',
    generatedAt: main.generatedAt,
    layers: layers('애플리케이션', '도메인·인프라'),
    roles: mergeRoles(parts),
    nodes,
    edges,
    failed: parts.flatMap((p) => p.failed),
    unresolved: parts.reduce((s, p) => s + p.unresolved, 0),
    langs: parts.map((p) => p.lang),
  };
}
