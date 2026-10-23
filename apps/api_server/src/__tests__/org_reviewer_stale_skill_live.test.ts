/**
 * Checked live contract for stale signed Org Reviewer skill approval.
 * Uses only an explicitly isolated synthetic fixture and the real API/fork.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { stripFrontmatterBlock } from '../services/skill_frontmatter';
import { assertLiveE2EIsolation } from './_live_e2e_guard';
import { ReviewerHarness, REVIEWER, READ, SUBMIT, api, type Json } from './org_reviewer_harness';

const enabled = process.env.RHYTHM_LIVE_E2E === '1' && process.env.RHYTHM_ORG_REVIEWER_STALE_SKILL === '1';
const liveDescribe = enabled ? describe.sequential : describe.skip;
const apiBase = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const engineBase = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';
const harness = new ReviewerHarness();
let token = '';
let reviewerSession: Json;
let ownerId = 0;
const createdSkills: Array<{ id: string; name: string }> = [];

function sha(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function ownerRequest(path: string, init: RequestInit = {}): Promise<Response> {
  if (!token) throw new Error('UNVERIFIED: synthetic owner actor was not established');
  return api(path, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
}

async function ownerJson<T extends Json>(path: string): Promise<T> {
  const response = await ownerRequest(path);
  if (!response.ok) throw new Error(`UNVERIFIED: owned API read returned HTTP ${response.status}`);
  return await response.json() as T;
}

async function managedFile(name: string): Promise<{ raw: string; body: string }> {
  const response = await ownerJson<{ name: string; content: string }>(`/opencode/skills/${encodeURIComponent(name)}/content`);
  if (response.name !== name || typeof response.content !== 'string') throw new Error('UNVERIFIED: owned managed skill readback mismatch');
  return { raw: response.content, body: stripFrontmatterBlock(response.content).trim() };
}

async function cleanupSkill(id: string, name: string): Promise<void> {
  const file = await ownerRequest(`/opencode/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (file.status !== 204) throw new Error(`UNVERIFIED: owned managed skill cleanup returned HTTP ${file.status}`);
  const row = await ownerRequest(`/agent-skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (row.status !== 204) throw new Error(`UNVERIFIED: owned skill metadata cleanup returned HTTP ${row.status}`);
  const fileRead = await ownerRequest(`/opencode/skills/${encodeURIComponent(name)}/content`);
  const rowRead = await ownerRequest(`/agent-skills/${encodeURIComponent(id)}`);
  expect([fileRead.status, rowRead.status]).toEqual([404, 404]);
}

async function measureSessionIds(): Promise<string[]> {
  const response = await ownerRequest('/agent-sessions?scope=self_improvement&search=skill-measure-score&limit=100');
  if (!response.ok) throw new Error(`UNVERIFIED: measurement-session read returned HTTP ${response.status}`);
  const value = await response.json() as { sessions?: Array<{ id?: unknown; name?: unknown }> };
  if (!Array.isArray(value.sessions)) throw new Error('UNVERIFIED: measurement-session response omitted sessions');
  return value.sessions.filter((row) => typeof row.id === 'string' && typeof row.name === 'string' && /skill-measure-score/i.test(row.name))
    .map((row) => String(row.id)).sort();
}

liveDescribe('Org Reviewer stale skill approval live contract', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    expect(new URL(apiBase).origin).toBe('http://127.0.0.1:4098');
    expect(new URL(engineBase).origin).toBe('http://127.0.0.1:4097');
    if (!process.env.RHYTHM_ORG_REVIEWER_OWNER_USER_ID || !process.env.RHYTHM_ORG_REVIEWER_OWNER_EMAIL) {
      throw new Error('UNVERIFIED: this contract requires the owner identity pins from the approved synthetic fixture manifest');
    }
    await harness.setup();
    const actor = await harness.syntheticOwner();
    token = actor.token;
    ownerId = actor.userId;
    const session = await harness.session(REVIEWER, `${harness.marker} owner-bound stale approval`, token);
    reviewerSession = session;
    expect(session.mcpRole).toBe(REVIEWER);
    expect(session.ownerUserId).toBe(ownerId);
  }, 120_000);

  afterAll(async () => {
    for (const skill of createdSkills.reverse()) await cleanupSkill(skill.id, skill.name);
    await harness.cleanup();
  }, 180_000);

  it('preserves a newer managed SKILL.md byte-for-byte when stale reviewer approval is refused', async () => {
    const suffix = randomUUID().slice(0, 10);
    const name = `smoke-org-review-stale-${suffix}`;
    const description = 'Owned stale approval fixture';
    const originalBody = 'Use the original safe summary procedure.';
    const revisedBody = 'Use the reviewed revised summary procedure.';
    const newerBody = 'Use the independently edited summary procedure.';
    const rowResponse = await ownerRequest('/agent-skills', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: name, description, status: 'published', source: 'smoke-fixture' }),
    });
    if (!rowResponse.ok) throw new Error(`UNVERIFIED: owned skill metadata create returned HTTP ${rowResponse.status}`);
    const skill = await rowResponse.json() as { id: string; body: string | null; version: number };
    const fileCreate = await ownerRequest('/opencode/skills', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, description, content: originalBody }),
    });
    if (!fileCreate.ok) throw new Error(`UNVERIFIED: owned managed skill create returned HTTP ${fileCreate.status}`);
    createdSkills.push({ id: skill.id, name });

    const originalFile = await managedFile(name);
    expect(originalFile.body).toBe(originalBody);
    const targetRef = `skill:${skill.id}`;
    const profile = await harness.profile(`stale-skill-evidence ${name}`, 'Prepare a plain-text summary using only the assigned skill.');
    const evidence = [
      await harness.transcript(profile, `Owned evidence ${name}: output omitted the required summary procedure.`, token),
      await harness.transcript(profile, `Owned evidence ${name}: the same summary procedure was omitted again.`, token),
    ];
    for (const item of evidence) expect(harness.sessions.find((entry) => entry.id === item.sessionId)?.ownerUserId).toBe(ownerId);

    const context = await harness.call(READ, { windowDays: 7, sessionLimit: 100, targetRef }, reviewerSession);
    expect(context.error, context.raw).toBe(false);
    const state = context.value.currentState as Json;
    expect(state.skill).toMatchObject({ id: skill.id, name, body: originalBody });
    expect(state.managedFile).toMatchObject({ present: true, sha256: expect.any(String) });
    const payload = {
      kind: 'refine-skill', title: `Revise owned summary skill ${name}`,
      rationale: 'Two independent owned sessions show the same procedure is missing.',
      evidence, targetRef,
      change: { priorBody: originalBody, revisedBody },
      currentState: {
        targetRevision: context.value.targetRevision,
        targetStateHash: context.value.targetStateHash,
        checks: [{ source: 'managed-skill', ref: targetRef, observed: state.managedFile.sha256 }],
      },
      confidence: 0.8, dedupKey: `stale-skill-${name}`,
      verificationPlan: {
        steps: ['Inspect the managed SKILL.md through its normal content read path.'],
        expectedOutcome: 'The exact reviewed body is present in the managed file.',
        rollback: 'Restore the exact prior managed file bytes.', risk: 'A text-only skill revision may change summary instructions.',
      },
    };
    const submitted = await harness.call(SUBMIT, payload, reviewerSession);
    expect(submitted.error, submitted.raw).toBe(false);
    expect(submitted.value.proposal).toMatchObject({ kind: 'refine-skill', targetRef, status: 'proposed', ownerUserId: ownerId });
    const proposalId = String(submitted.value.proposal.id);

    const measureBefore = await measureSessionIds();
    const edit = await ownerRequest(`/opencode/skills/${encodeURIComponent(name)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description, content: newerBody }),
    });
    if (!edit.ok) throw new Error(`UNVERIFIED: normal managed-file edit returned HTTP ${edit.status}`);
    const editedFile = await managedFile(name);
    const editedRow = await ownerJson<{ body: string | null; version: number }>(`/agent-skills/${encodeURIComponent(skill.id)}`);
    expect(editedFile.body).toBe(newerBody);
    expect(editedRow.body).toBe(skill.body);
    expect(editedRow.version).toBe(skill.version);
    const editedRawSha = sha(editedFile.raw);
    const editedRawBytes = Buffer.byteLength(editedFile.raw, 'utf8');

    const approval = await ownerRequest(`/agent-org-proposals/${encodeURIComponent(proposalId)}/approve`, { method: 'POST' });
    const bodyText = await approval.text();
    let errorBody: Json = {};
    try { errorBody = JSON.parse(bodyText) as Json; } catch { /* Never persist the raw response body. */ }
    const message = String((errorBody.error as Json | undefined)?.message ?? errorBody.message ?? '');
    expect(approval.status).toBe(400);
    expect(message).toMatch(/refine-skill target content changed after proposal submission/i);
    expect(await measureSessionIds()).toEqual(measureBefore);

    const finalFile = await managedFile(name);
    const finalRow = await ownerJson<{ body: string | null; version: number }>(`/agent-skills/${encodeURIComponent(skill.id)}`);
    const queueResponse = await ownerRequest('/agent-org-proposals?status=proposed');
    if (!queueResponse.ok) throw new Error(`UNVERIFIED: owned proposal queue read returned HTTP ${queueResponse.status}`);
    const queue = await queueResponse.json() as Array<{ id?: string; status?: string }>;
    expect(finalFile.raw).toBe(editedFile.raw);
    expect(sha(finalFile.raw)).toBe(editedRawSha);
    expect(Buffer.byteLength(finalFile.raw, 'utf8')).toBe(editedRawBytes);
    expect(finalRow.body).toBe(skill.body);
    expect(finalRow.version).toBe(skill.version);
    expect(queue.find((proposal) => proposal.id === proposalId)).toMatchObject({ id: proposalId, status: 'proposed' });
  }, 180_000);
});
