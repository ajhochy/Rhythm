/**
 * Tests for the #929 additions to rhythm_managed_skills.ts: listing/reading/
 * deleting drafts, and moving a draft into the disabled/ archive. Pre-existing
 * write/read/delete-for-managed-skills behavior (Unify-2/#949) is already
 * covered by skill_extractor.test.ts and is not re-tested here.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  writeDraftManagedSkill,
  listDraftSkillNames,
  readDraftSkill,
  deleteDraftManagedSkill,
  moveDraftToDisabled,
  listDisabledSkillNames,
  readDisabledSkill,
  draftSkillExists,
} from '../services/rhythm_managed_skills';

describe('rhythm_managed_skills — #929 draft lifecycle helpers', () => {
  let savedManagedDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rhythm-drafts-lifecycle-'));
    savedManagedDir = process.env.RHYTHM_MANAGED_SKILLS_DIR;
    process.env.RHYTHM_MANAGED_SKILLS_DIR = tempDir;
  });

  afterEach(() => {
    if (savedManagedDir === undefined) delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
    else process.env.RHYTHM_MANAGED_SKILLS_DIR = savedManagedDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('listDraftSkillNames / readDraftSkill see a freshly written draft', () => {
    expect(listDraftSkillNames()).toEqual([]);

    writeDraftManagedSkill({
      name: 'my-draft',
      description: 'a draft',
      body: '# My Draft\n\nBody text.\n',
      sourceSessionId: 'sess-1',
      confidence: 0.7,
    });

    expect(listDraftSkillNames()).toEqual(['my-draft']);
    const draft = readDraftSkill('my-draft');
    expect(draft).not.toBeNull();
    expect(draft?.frontmatter.status).toBe('draft');
    expect(draft?.frontmatter.confidence).toBe(0.7);
    expect(draft?.body).toBe('# My Draft\n\nBody text.');
  });

  it('readDraftSkill returns null for an unknown name', () => {
    expect(readDraftSkill('does-not-exist')).toBeNull();
  });

  it('deleteDraftManagedSkill removes an existing draft and returns true, false when absent', () => {
    writeDraftManagedSkill({
      name: 'to-delete',
      body: '# To Delete\n',
      sourceSessionId: 'sess-1',
      confidence: 0.7,
    });
    expect(draftSkillExists('to-delete')).toBe(true);
    expect(deleteDraftManagedSkill('to-delete')).toBe(true);
    expect(draftSkillExists('to-delete')).toBe(false);
    expect(deleteDraftManagedSkill('to-delete')).toBe(false);
  });

  it('moveDraftToDisabled archives the draft (status: disabled) and removes it from drafts/', () => {
    writeDraftManagedSkill({
      name: 'bad-skill',
      description: 'not useful',
      body: '# Bad Skill\n\nOff-topic content.\n',
      sourceSessionId: 'sess-2',
      confidence: 0.65,
      provenance: 'auto-extract',
    });

    const moved = moveDraftToDisabled('bad-skill', {
      evaluatedAt: '2026-07-09T00:00:00.000Z',
      postScore: 10,
      measureReason: 'off-topic',
    });
    expect(moved).toBe(true);

    // Gone from the live/discoverable drafts namespace.
    expect(draftSkillExists('bad-skill')).toBe(false);
    expect(listDraftSkillNames()).toEqual([]);

    // Archived with the evaluation ledger stamped in.
    expect(listDisabledSkillNames()).toEqual(['bad-skill']);
    const archived = readDisabledSkill('bad-skill');
    expect(archived?.frontmatter.status).toBe('disabled');
    expect(archived?.frontmatter.postScore).toBe(10);
    expect(archived?.frontmatter.measureReason).toBe('off-topic');
    expect(archived?.frontmatter.evaluatedAt).toBe('2026-07-09T00:00:00.000Z');
    // Body + original harvest provenance survive the move.
    expect(archived?.body).toBe('# Bad Skill\n\nOff-topic content.');
    expect(archived?.frontmatter.sourceSession).toBe('sess-2');
  });

  it('moveDraftToDisabled is a no-op returning false for an unknown draft', () => {
    expect(
      moveDraftToDisabled('missing', { evaluatedAt: 'x', postScore: 0, measureReason: 'n/a' }),
    ).toBe(false);
  });

  it('re-writing a draft in place (keep/rewrite-needed) preserves the body and updates status', () => {
    writeDraftManagedSkill({
      name: 'ok-skill',
      body: '# OK Skill\n',
      sourceSessionId: 'sess-3',
      confidence: 0.7,
    });

    writeDraftManagedSkill({
      name: 'ok-skill',
      body: '# OK Skill\n',
      sourceSessionId: 'sess-3',
      confidence: 0.7,
      status: 'active',
      evaluatedAt: '2026-07-09T01:00:00.000Z',
      postScore: 75,
      measureReason: 'accurate and actionable',
    });

    const draft = readDraftSkill('ok-skill');
    expect(draft?.frontmatter.status).toBe('active');
    expect(draft?.frontmatter.postScore).toBe(75);
    expect(draft?.frontmatter.evaluatedAt).toBe('2026-07-09T01:00:00.000Z');
  });
});
