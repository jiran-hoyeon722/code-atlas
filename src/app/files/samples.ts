import type { Architecture } from '../../engine/architecture';
import type { Role } from '../../engine/presets';
import type { Lang } from '../../engine/types';

export interface SampleRepo {
  id: string;
  owner: string;
  repo: string;
  sha: string;
  subdir: string;
  blurb: string;
  lang: Lang;
  framework: Architecture['framework'];
  files: number;
  edges: number;
  stars: number | null;
  roles: Pick<Role, 'name' | 'layer' | 'color'>[];
  roleCounts: number[];
}

export interface SampleManifest {
  generatedAt: string;
  repos: SampleRepo[];
}

const SAFE_ID = /^[a-z0-9._-]+$/;

export async function loadSampleManifest(fetchFn: typeof fetch = fetch): Promise<SampleManifest> {
  const res = await fetchFn('./samples/index.json');
  if (!res.ok) throw new Error(`samples ${res.status}`);
  return (await res.json()) as SampleManifest;
}

export async function loadSample(id: string, fetchFn: typeof fetch = fetch): Promise<Architecture> {
  if (!SAFE_ID.test(id)) throw new Error('bad sample id');
  const res = await fetchFn(`./samples/${id}.json`);
  if (!res.ok) throw new Error(`sample ${res.status}`);
  return (await res.json()) as Architecture;
}
