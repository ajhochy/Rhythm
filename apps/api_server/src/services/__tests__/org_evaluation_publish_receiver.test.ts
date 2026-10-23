import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { startOrgEvaluationPublishReceiverAsync } from '../org_evaluation_publish_receiver';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

describe('private org-skill evaluation receiver', () => {
  it('requires exact applier POST bytes, then serves the published SKILL.md through discovery routes', async () => {
    const token = randomBytes(32).toString('hex');
    const body = JSON.stringify({ description: 'Test skill', content: '# Test skill\n', published: true });
    const receiver = await startOrgEvaluationPublishReceiverAsync({
      expectedSkillName: 'private-skill', action: 'publish', expectedBodyHash: hash(body), token,
    });
    try {
      expect((await fetch(`${receiver.baseURL}/org-skills/index.json`).then((res) => res.json()))).toEqual({ skills: [] });
      const wrong = await fetch(`${receiver.baseURL}/org-skills/private-skill`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Different\n', published: true }),
      });
      expect(wrong.status).toBe(409);
      expect((await receiver.observations()).publishedBody).toBeNull();
      const unauth = await fetch(`${receiver.baseURL}/org-skills/private-skill`, {
        method: 'POST', body,
      });
      expect(unauth.status).toBe(401);
      const published = await fetch(`${receiver.baseURL}/org-skills/private-skill`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body,
      });
      expect(published.status).toBe(201);
      expect(await fetch(`${receiver.baseURL}/org-skills/index.json`).then((res) => res.json())).toEqual({
        skills: [{ name: 'private-skill', files: ['SKILL.md'] }],
      });
      expect(await fetch(`${receiver.baseURL}/org-skills/private-skill/SKILL.md`).then((res) => res.text())).toBe('# Test skill\n');
      expect(await fetch(`${receiver.baseURL}/org-skills/private-skill/SKILL.md`, {
        headers: { 'X-Rhythm-Evaluation-Verify': '1' },
      }).then((res) => res.text())).toBe('# Test skill\n');
      const receipt = await receiver.observations();
      expect(receipt.publishedBody).toBe('# Test skill\n');
      expect(receipt.requests).toContainEqual(expect.objectContaining({
        method: 'POST', status: 201, bodyHash: hash(body), contentHash: hash('# Test skill\n'),
      }));
      expect(receipt.requests).toContainEqual(expect.objectContaining({ method: 'GET', status: 200,
        client: 'engine', contentHash: hash('# Test skill\n') }));
      expect(receipt.requests).toContainEqual(expect.objectContaining({ method: 'GET', status: 200,
        client: 'worker-verifier', contentHash: hash('# Test skill\n') }));
    } finally {
      await receiver.close();
    }
  });

  it('unpublishes only the frozen original and proves subsequent discovery absence', async () => {
    const token = randomBytes(32).toString('hex');
    const receiver = await startOrgEvaluationPublishReceiverAsync({
      expectedSkillName: 'old-skill', action: 'unpublish', expectedBodyHash: hash(''), token,
      initialPublishedBody: '# Old skill\n',
    });
    try {
      expect(await fetch(`${receiver.baseURL}/org-skills/old-skill/SKILL.md`).then((res) => res.text())).toBe('# Old skill\n');
      const blocked = await fetch(`${receiver.baseURL}/org-skills/old-skill`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}',
      });
      expect(blocked.status).toBe(404);
      const deleted = await fetch(`${receiver.baseURL}/org-skills/old-skill`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      expect(deleted.status).toBe(204);
      expect(await fetch(`${receiver.baseURL}/org-skills/old-skill/SKILL.md`).then((res) => res.status)).toBe(404);
      expect(await fetch(`${receiver.baseURL}/org-skills/index.json`).then((res) => res.json())).toEqual({ skills: [] });
      expect((await receiver.observations()).requests).toContainEqual(expect.objectContaining({ method: 'DELETE', status: 204 }));
    } finally {
      await receiver.close();
    }
  });

  it('starts a publish replacement from frozen old bytes before applying new bytes', async () => {
    const token = randomBytes(32).toString('hex');
    const body = JSON.stringify({ content: '# New skill\n', published: true });
    const receiver = await startOrgEvaluationPublishReceiverAsync({
      expectedSkillName: 'existing-skill', action: 'publish', expectedBodyHash: hash(body), token,
      initialPublishedBody: '# Frozen old skill\n',
    });
    try {
      expect(await fetch(`${receiver.baseURL}/org-skills/existing-skill/SKILL.md`).then(res => res.text()))
        .toBe('# Frozen old skill\n');
      const applied = await fetch(`${receiver.baseURL}/org-skills/existing-skill`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body,
      });
      expect(applied.status).toBe(201);
      expect(await fetch(`${receiver.baseURL}/org-skills/existing-skill/SKILL.md`).then(res => res.text()))
        .toBe('# New skill\n');
    } finally { await receiver.close(); }
  });

  it('serves frozen original discovery while refusing all baseline writes', async () => {
    const token = randomBytes(32).toString('hex');
    const receiver = await startOrgEvaluationPublishReceiverAsync({
      expectedSkillName: 'existing-skill', action: 'none', expectedBodyHash: hash(''), token,
      initialPublishedBody: '# Frozen old skill\n',
    });
    try {
      expect(await fetch(`${receiver.baseURL}/org-skills/existing-skill/SKILL.md`).then(res => res.text()))
        .toBe('# Frozen old skill\n');
      for (const method of ['POST', 'DELETE'] as const) {
        const response = await fetch(`${receiver.baseURL}/org-skills/existing-skill`, {
          method, headers: { Authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(404);
      }
      expect((await receiver.observations()).publishedBody).toBe('# Frozen old skill\n');
    } finally { await receiver.close(); }
  });
});
