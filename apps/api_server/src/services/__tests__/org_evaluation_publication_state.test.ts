import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { OrgEvaluationTargetSnapshot } from '../org_evaluation_fixture';
import { captureOrgPublicationStateAsync, publicationReceiverInput } from '../org_evaluation_publication_state';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const baseURL = 'http://127.0.0.1:63781';
const skillName = 'reviewed-skill';
const localBody = '---\nname: reviewed-skill\n---\n# Improved\n';
const oldBody = '---\nname: reviewed-skill\n---\n# Old\n';

const fetcher = (listed: boolean, body: string | null): typeof fetch =>
  (async (url: string | URL | Request) => {
    if (String(url).endsWith('/index.json')) return new Response(JSON.stringify({
      skills: listed ? [{ name: skillName, files: ['SKILL.md'] }] : [],
    }));
    return body === null ? new Response('', { status: 404 }) : new Response(body);
  }) as typeof fetch;

function snapshot(published: boolean): OrgEvaluationTargetSnapshot {
  return {
    schemaVersion: 1, kind: 'publish-skill-to-org', targetRef: 'skill:skill-1', targetRevision: '1',
    effectiveModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5', source: 'profile' },
    profiles: [], skills: [{ id: 'skill-1', title: skillName, body: null,
      description: 'Description', whenToUse: null, version: 1 }],
    schedules: [], recipes: [], creationControl: undefined,
    managedSkillFiles: [{ name: skillName, bytesBase64: Buffer.from(localBody).toString('base64'),
      sha256: hash(localBody) }],
    publicationOriginal: { skillName, published,
      bodyBase64: published ? Buffer.from(oldBody).toString('base64') : null,
      sha256: published ? hash(oldBody) : null },
  };
}

describe('frozen org publication state', () => {
  it('captures exact published bytes and verified absence through the production GET contract', async () => {
    expect(await captureOrgPublicationStateAsync({ skillName, baseURL, fetcher: fetcher(true, oldBody) }))
      .toEqual(snapshot(true).publicationOriginal);
    expect(await captureOrgPublicationStateAsync({ skillName, baseURL, fetcher: fetcher(false, null) }))
      .toEqual(snapshot(false).publicationOriginal);
    await expect(captureOrgPublicationStateAsync({ skillName, baseURL, fetcher: fetcher(true, null) }))
      .rejects.toThrow('unavailable');
    await expect(captureOrgPublicationStateAsync({ skillName, baseURL, fetcher: fetcher(false, oldBody) }))
      .rejects.toThrow('disagree');
  });

  it('binds private receiver to frozen old bytes and the exact production POST body', () => {
    expect(publicationReceiverInput({ snapshot: snapshot(true), changeJson: '{}', baseline: true }))
      .toEqual({ action: 'none', expectedSkillName: skillName, initialPublishedBody: oldBody,
        expectedBodyHash: hash('') });
    expect(publicationReceiverInput({ snapshot: snapshot(false), changeJson: '{}', baseline: true }))
      .toEqual({ action: 'none', expectedSkillName: skillName, expectedBodyHash: hash('') });
    const input = publicationReceiverInput({ snapshot: snapshot(true),
      changeJson: JSON.stringify({ skillName, action: 'publish' }), baseline: false });
    expect(input).toEqual({ action: 'publish', expectedSkillName: skillName,
      initialPublishedBody: oldBody,
      expectedBodyHash: hash(JSON.stringify({ description: 'Description', content: localBody, published: true })) });
    expect(publicationReceiverInput({ snapshot: snapshot(true),
      changeJson: JSON.stringify({ skillName, action: 'unpublish' }), baseline: false }))
      .toMatchObject({ action: 'unpublish', initialPublishedBody: oldBody });
    expect(() => publicationReceiverInput({ snapshot: snapshot(false),
      changeJson: JSON.stringify({ skillName, action: 'unpublish' }), baseline: false }))
      .toThrow('without a published original');
    expect(() => publicationReceiverInput({ snapshot: snapshot(true),
      changeJson: JSON.stringify({ skillName: 'other-skill', action: 'publish' }), baseline: false }))
      .toThrow('differs from frozen target');
  });
});
