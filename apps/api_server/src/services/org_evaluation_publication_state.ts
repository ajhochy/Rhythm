/** Exact public org-library state frozen before a publication evaluation. */
import { createHash } from 'node:crypto';
import type { OrgEvaluationTargetSnapshot } from './org_evaluation_fixture';
import { resolveProdApiBase } from './opencode_plugin_config';

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const MAX_BYTES = 256 * 1024;

export interface FrozenOrgPublicationState {
  skillName: string;
  published: boolean;
  bodyBase64: string | null;
  sha256: string | null;
}

async function boundedBody(response: Response): Promise<Buffer> {
  if (!response.body) throw Error('Org publication response has no body');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_BYTES) throw Error('Org publication response exceeded byte limit');
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks);
}

/** Reads the same public index and bytes used by the production engine. */
export async function captureOrgPublicationStateAsync(input: {
  skillName: string;
  baseURL?: string;
  fetcher?: typeof fetch;
}): Promise<FrozenOrgPublicationState> {
  const { skillName } = input;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(skillName))
    throw Error('Org publication skill name is invalid');
  const base = new URL(input.baseURL ?? resolveProdApiBase());
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password ||
      base.search || base.hash || (base.protocol === 'http:' && base.hostname !== '127.0.0.1'))
    throw Error('Org publication source URL is not approved');
  const get = input.fetcher ?? fetch;
  const root = `${base.toString().replace(/\/+$/, '')}/org-skills`;
  const index = await get(`${root}/index.json`, { signal: AbortSignal.timeout(10_000) });
  if (!index.ok) throw Error(`Org publication index unavailable (${index.status})`);
  if (index.url && new URL(index.url).origin !== base.origin)
    throw Error('Org publication index redirected outside the approved source');
  let parsed: unknown;
  try { parsed = JSON.parse((await boundedBody(index)).toString('utf8')); }
  catch { throw Error('Org publication index is malformed'); }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { skills?: unknown }).skills))
    throw Error('Org publication index is malformed');
  const skills = (parsed as { skills: unknown[] }).skills;
  if (skills.some((entry) => !entry || typeof entry !== 'object' ||
      typeof (entry as { name?: unknown }).name !== 'string'))
    throw Error('Org publication index is malformed');
  const matches = skills.filter((entry) => (entry as { name: string }).name === skillName);
  if (matches.length > 1) throw Error('Org publication index duplicates the target skill');
  if (matches.length === 1 && (!Array.isArray((matches[0] as { files?: unknown }).files) ||
      !(matches[0] as { files: unknown[] }).files.includes('SKILL.md')))
    throw Error('Org publication index omits the target SKILL.md');
  const file = await get(`${root}/${encodeURIComponent(skillName)}/SKILL.md`,
    { signal: AbortSignal.timeout(10_000) });
  if (file.url && new URL(file.url).origin !== base.origin)
    throw Error('Org publication target redirected outside the approved source');
  if (matches.length === 0) {
    if (file.status !== 404) throw Error('Org publication index and target body disagree');
    return { skillName, published: false, bodyBase64: null, sha256: null };
  }
  if (!file.ok) throw Error(`Org publication target unavailable (${file.status})`);
  const bytes = await boundedBody(file);
  if (!bytes.length) throw Error('Org publication target body is empty');
  return { skillName, published: true, bodyBase64: bytes.toString('base64'), sha256: sha256(bytes) };
}

/** Derives the receiver's exact initial state and expected production POST bytes. */
export function publicationReceiverInput(input: {
  snapshot: OrgEvaluationTargetSnapshot;
  changeJson: string;
  baseline: boolean;
}): {
  action: 'publish' | 'unpublish' | 'none';
  expectedSkillName: string;
  expectedBodyHash: string;
  initialPublishedBody?: string;
} {
  const { snapshot } = input;
  if (snapshot.kind !== 'publish-skill-to-org' || !snapshot.targetRef.startsWith('skill:') ||
      !snapshot.publicationOriginal) throw Error('Publication requires a frozen original library state');
  const original = snapshot.publicationOriginal;
  const skill = snapshot.skills.find((item) =>
    (snapshot.targetRef === `skill:${item.id}` || snapshot.targetRef === `skill:${item.title}`)
      && item.title === original.skillName);
  if (!skill || original.published !== (original.bodyBase64 !== null) ||
      original.published !== (original.sha256 !== null))
    throw Error('Publication original state is malformed');
  const initial = original.bodyBase64 === null ? undefined : Buffer.from(original.bodyBase64, 'base64');
  if (initial && sha256(initial) !== original.sha256)
    throw Error('Publication original bytes changed');
  if (input.baseline) {
    if (input.changeJson !== '{}') throw Error('Publication baseline change must be empty');
    return { action: 'none', expectedSkillName: skill.title, expectedBodyHash: sha256(''),
      ...(initial ? { initialPublishedBody: initial.toString('utf8') } : {}) };
  }
  let change: unknown;
  try { change = JSON.parse(input.changeJson); } catch { throw Error('Publication change is malformed'); }
  if (!change || typeof change !== 'object' || Array.isArray(change))
    throw Error('Publication change is malformed');
  const action = change as Record<string, unknown>;
  if (Object.keys(action).sort().join(',') !== 'action,skillName' ||
      (action.action !== 'publish' && action.action !== 'unpublish') ||
      typeof action.skillName !== 'string') throw Error('Publication action is malformed');
  if (action.skillName !== skill.title)
    throw Error('Publication action differs from frozen target');
  if (action.action === 'unpublish' && !initial)
    throw Error('Cannot evaluate unpublish without a published original');
  const local = snapshot.managedSkillFiles.find((item) => item.name === skill.title);
  if (action.action === 'publish' && !local)
    throw Error('Publication has no frozen managed SKILL.md');
  let expectedBodyHash = sha256('');
  if (local) {
    const bytes = Buffer.from(local.bytesBase64, 'base64');
    if (sha256(bytes) !== local.sha256) throw Error('Publication managed bytes changed');
    expectedBodyHash = sha256(JSON.stringify({
      description: skill.description ?? undefined, content: bytes.toString('utf8'), published: true,
    }));
  }
  return {
    action: action.action,
    expectedSkillName: skill.title,
    expectedBodyHash,
    ...(initial ? { initialPublishedBody: initial.toString('utf8') } : {}),
  };
}
