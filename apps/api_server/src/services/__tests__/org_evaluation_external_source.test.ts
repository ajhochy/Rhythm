import { createHash, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrgEvaluationTargetSnapshot } from '../org_evaluation_fixture';
import { captureExternalSkillSourceAsync, downloadPrivateExternalSkillAsync,
  externalSkillReceiverInput, startExternalSkillReceiverAsync } from '../org_evaluation_external_source';
import { downloadSkillBody } from '../generators/external_discovery_search';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const body = '---\nname: checked-skill\n---\n# Checked skill\n';
const url = `https://raw.githubusercontent.com/owner/repo/${'a'.repeat(40)}/skills/checked-skill/SKILL.md`;
const change = { candidateKind: 'skill', skillName: 'checked-skill', agentConfigId: 'profile-1',
  downloadUrl: url, contentSha256: hash(body) };
const source = { candidateKind: 'skill' as const, skillName: change.skillName,
  downloadUrl: url, contentSha256: hash(body), bodyBase64: Buffer.from(body).toString('base64') };
const previous = new Map<string, string | undefined>();
const envNames = [
  'RHYTHM_EVALUATION_WORKER', 'RHYTHM_EVALUATION_EXTERNAL_SOURCE_URL',
  'RHYTHM_EVALUATION_EXTERNAL_SOURCE_SHA256', 'RHYTHM_EVALUATION_EXTERNAL_RECEIVER_URL',
  'RHYTHM_EVALUATION_EXTERNAL_RECEIVER_TOKEN',
];
for (const name of envNames) previous.set(name, process.env[name]);
afterEach(() => { for (const name of envNames) {
  const value = previous.get(name);
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
} });

function snapshot(): OrgEvaluationTargetSnapshot {
  return { schemaVersion: 1, kind: 'external-adoption', targetRef: 'agent_config:profile-1',
    targetRevision: '1', effectiveModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5', source: 'profile' },
    profiles: [], skills: [], schedules: [], recipes: [], managedSkillFiles: [], externalSkillSource: source };
}

describe('external adoption immutable skill source', () => {
  it('captures only commit-pinned bytes that match the reviewed digest', async () => {
    const observed: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      observed.push(String(input));
      return new Response(body);
    }) as typeof fetch;
    expect(await captureExternalSkillSourceAsync({ change, fetcher })).toEqual(source);
    expect(observed).toEqual([url]);
    await expect(captureExternalSkillSourceAsync({ change: { ...change, contentSha256: hash('other') }, fetcher }))
      .rejects.toThrow('differs from the reviewed digest');
    await expect(captureExternalSkillSourceAsync({ change: { ...change, downloadUrl: 'https://evil.invalid/x' }, fetcher }))
      .rejects.toThrow('allowlist');
  });

  it('locks candidate source and target to the frozen original', () => {
    expect(externalSkillReceiverInput({ snapshot: snapshot(), changeJson: '{}', baseline: true })).toEqual(source);
    expect(externalSkillReceiverInput({ snapshot: snapshot(), changeJson: JSON.stringify(change), baseline: false }))
      .toEqual(source);
    expect(() => externalSkillReceiverInput({ snapshot: snapshot(),
      changeJson: JSON.stringify({ ...change, agentConfigId: 'other' }), baseline: false }))
      .toThrow('differs from frozen source or target');
  });

  it('serves only the exact frozen bytes to the worker downloader', async () => {
    const token = randomBytes(32).toString('hex');
    const receiver = await startExternalSkillReceiverAsync({ source, token });
    try {
      process.env.RHYTHM_EVALUATION_WORKER = '1';
      process.env.RHYTHM_EVALUATION_EXTERNAL_SOURCE_URL = url;
      process.env.RHYTHM_EVALUATION_EXTERNAL_SOURCE_SHA256 = hash(body);
      process.env.RHYTHM_EVALUATION_EXTERNAL_RECEIVER_URL = receiver.baseURL;
      process.env.RHYTHM_EVALUATION_EXTERNAL_RECEIVER_TOKEN = token;
      await expect(downloadPrivateExternalSkillAsync(url)).resolves.toBe(body);
      await expect(downloadSkillBody(url)).resolves.toBe(body);
      await expect(downloadPrivateExternalSkillAsync(url + '?other')).rejects.toThrow('differs');
      expect(await receiver.observations()).toContainEqual({
        path: '/source/SKILL.md', status: 200, bodyHash: hash(body),
      });
      expect((await fetch(`${receiver.baseURL}/source/SKILL.md`)).status).toBe(401);
      expect((await fetch(`${receiver.baseURL}/different`, {
        headers: { Authorization: `Bearer ${token}` },
      })).status).toBe(404);
    } finally { await receiver.close(); }
  });
});
