import assert from 'node:assert/strict';
import { it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { retiredSkillUnavailableEvent, skillNotFoundEvent, unpublishedOrgSkillEvent } from '../org_evaluation_skill_absence';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentSkillsRepository } from '../../repositories/agent_skills_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { registerAllProposalAppliers } from '../org_proposal_appliers_wiring';
import { applyApprovedProposalAsync } from '../org_proposal_apply_service';
import { readManagedSkillBytes, writeManagedSkill } from '../rhythm_managed_skills';
import { captureOrgPublicationStateAsync } from '../org_evaluation_publication_state';
import { startOrgEvaluationPublishReceiverAsync } from '../org_evaluation_publish_receiver';
import { createHash } from 'node:crypto';

it('proves copied skill retirement and private unpublication only with exact engine denial', async () => {
  const root = mkdtempSync('/private/tmp/rhythm-skill-absence-test-');
  const priorManagedRoot = process.env.RHYTHM_MANAGED_SKILLS_DIR;
  process.env.RHYTHM_MANAGED_SKILLS_DIR = root;
  const db = new Database(':memory:');
  runMigrations(db);
  const previous = setDb(db);
  try {
    registerAllProposalAppliers();
    const skills = new AgentSkillsRepository();
    const survivor = skills.create({ title: 'scratch-survivor', body: 'Before', status: 'active' });
    const retired = skills.create({ title: 'scratch-retired', body: 'Retire me', status: 'active' });
    writeManagedSkill({ name: survivor.title, body: survivor.body! });
    writeManagedSkill({ name: retired.title, body: retired.body! });
    const changeJson = JSON.stringify({ survivorSkillId: survivor.id, retiredSkillId: retired.id,
      priorSurvivorBody: survivor.body, priorRetiredBody: retired.body, revisedBody: 'Merged body' });
    const errorPart = { type: 'tool', tool: 'skill', callID: 'real-engine-call-1',
      state: { status: 'error', input: { name: retired.title },
        error: `Tool execution failed: Skill "${retired.title}" not found. Available skills: scratch-survivor` } };
    const check = (historyParts: unknown[]) => retiredSkillUnavailableEvent({ db,
      targetRef: `skill:${survivor.id}`, changeJson, historyParts, readManagedBytes: readManagedSkillBytes });
    assert.equal(check([errorPart]), null, 'pre-apply cannot claim absent skill');
    const repo = new AgentOrgProposalsRepository();
    const proposal = await repo.createAsync({ kind: 'consolidate-skill', targetRef: `skill:${survivor.id}`,
      title: 'Scratch consolidation', risk: 'high', changeJson });
    const result = await applyApprovedProposalAsync({ proposal, decidedByUserId: 0, proposalsRepo: repo,
      finalizePostApply: async () => null, measure: async () => 'skipped' });
    assert.equal(result.kind, 'applied');
    assert.equal(skills.getById(retired.id)?.status, 'retired');
    assert.equal(readManagedSkillBytes(retired.title), null);
    assert.equal(check([]), null, 'DB and file absence alone cannot claim engine denial');
    assert.equal(check([{ ...errorPart, state: { ...errorPart.state, error: 'Generic failure' } }]), null);
    assert.equal(check([{ ...errorPart, state: { ...errorPart.state, status: 'completed' } }]), null);
    assert.equal(check([errorPart])?.kind, 'retired-skill-unavailable');
    writeManagedSkill({ name: retired.title, body: 'Unexpectedly restored' });
    assert.equal(check([errorPart]), null, 'reappearing managed bytes invalidate denial');

    const name = 'scratch-org-skill';
    const receiver = await startOrgEvaluationPublishReceiverAsync({ expectedSkillName: name,
      action: 'unpublish', expectedBodyHash: createHash('sha256').update('').digest('hex'),
      token: 'a'.repeat(64), initialPublishedBody: 'Original published skill' });
    try {
      const original = await captureOrgPublicationStateAsync({ skillName: name, baseURL: receiver.baseURL });
      assert.equal(original.published, true);
      assert.equal(unpublishedOrgSkillEvent({ name, action: 'unpublish', ...(await receiver.observations()) }), null);
      const deletion = await fetch(`${receiver.baseURL}/org-skills/${name}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${'a'.repeat(64)}` } });
      assert.equal(deletion.status, 204);
      const after = await captureOrgPublicationStateAsync({ skillName: name, baseURL: receiver.baseURL });
      assert.equal(after.published, false);
      const workerReadback = await fetch(`${receiver.baseURL}/org-skills/${name}/SKILL.md`,
        { headers: { 'X-Rhythm-Evaluation-Verify': '1' } });
      assert.equal(workerReadback.status, 404);
      // This unmarked catalog read represents the engine HTTP client, while
      // captureOrgPublicationStateAsync supplied the worker readback marker.
      const engineIndex = await fetch(`${receiver.baseURL}/org-skills/index.json`);
      assert.equal(engineIndex.status, 200);
      const observations = await receiver.observations();
      assert.equal(unpublishedOrgSkillEvent({ name, action: 'unpublish', ...observations })?.kind,
        'org-skill-unavailable');
      assert.equal(unpublishedOrgSkillEvent({ name, action: 'unpublish', publishedBody: null,
        requests: observations.requests.filter((entry) => entry.client !== 'engine') }), null);
      assert.equal(unpublishedOrgSkillEvent({ name, action: 'unpublish', publishedBody: null,
        requests: observations.requests.filter((entry) => entry.client !== 'worker-verifier') }), null);
      const deletedAt = observations.requests.findIndex((entry) => entry.method === 'DELETE' && entry.status === 204);
      assert.equal(unpublishedOrgSkillEvent({ name, action: 'unpublish', publishedBody: null,
        requests: observations.requests.filter((entry, index) => index <= deletedAt || entry.client !== 'engine') }), null,
        'a catalog read before deletion cannot prove post-delete engine state');
      assert.equal(unpublishedOrgSkillEvent({ name, action: 'publish', ...observations }), null);
      assert.equal(unpublishedOrgSkillEvent({ name, action: 'unpublish', publishedBody: 'stale', requests: observations.requests }), null);
      const unavailablePart = { type: 'tool', tool: 'skill', callID: 'real-engine-call-2',
        state: { status: 'error', input: { name }, error: `Skill "${name}" not found. Available skills: none` } };
      assert.equal(skillNotFoundEvent([unavailablePart], name)?.kind, 'skill-unavailable');
      assert.equal(skillNotFoundEvent([{ ...unavailablePart, state: { ...unavailablePart.state,
        error: `Skill "${name}" is not permitted for this agent.` } }], name), null);
    } finally { await receiver.close(); }
  } finally {
    setDb(previous); db.close(); rmSync(root, { recursive: true, force: true });
    if (priorManagedRoot === undefined) delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
    else process.env.RHYTHM_MANAGED_SKILLS_DIR = priorManagedRoot;
  }
}, 30_000);
