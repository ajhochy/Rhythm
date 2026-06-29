/**
 * Unify-6 — publishing a DB skill materializes it to a SKILL.md in the managed
 * dir, then re-scans the fork. Idempotent by name; dematerialize removes it.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AgentSkill } from '../../models/agent_skill';

const MANAGED_DIR = mkdtempSync(join(tmpdir(), 'rhythm-materialize-'));
process.env.RHYTHM_MANAGED_SKILLS_DIR = MANAGED_DIR;

const reloadSkills = vi.fn().mockResolvedValue([]);
vi.mock('../opencode_engine', () => ({
  opencodeClient: { reloadSkills: (...a: unknown[]) => reloadSkills(...a) },
  opencodeSessionMap: new Map(),
}));

import { materializeSkill, dematerializeSkill } from '../skill_materializer';

function skill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: 'sk_1',
    title: 'Deploy Checklist',
    whenToUse: 'Before any production deploy',
    description: 'Run the deploy checklist',
    steps: ['Check CI', 'Tag release'],
    tags: null,
    stepsJson: null,
    tagsJson: null,
    body: null,
    confidence: 0.9,
    status: 'published',
    source: 'seed',
    uses: 0,
    version: 1,
    appliedForName: null,
    baseVersion: null,
    originLocation: null,
    isExternal: 0,
    baselineScore: null,
    postScore: null,
    measureReason: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('skill_materializer (Unify-6)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterAll(() => rmSync(MANAGED_DIR, { recursive: true, force: true }));

  it('writes a valid SKILL.md (frontmatter name+description) and reloads', async () => {
    await materializeSkill(skill());
    const loc = join(MANAGED_DIR, 'Deploy__Checklist', 'SKILL.md');
    expect(existsSync(loc)).toBe(true);
    const md = readFileSync(loc, 'utf8');
    expect(md).toContain('name: Deploy Checklist');
    expect(md).toContain('description:');
    expect(md).toContain('Check CI'); // composed from steps
    expect(reloadSkills).toHaveBeenCalledTimes(1);
  });

  it('prefers the prose body when present', async () => {
    await materializeSkill(skill({ body: '# Custom\n\nProse body here.' }));
    const md = readFileSync(join(MANAGED_DIR, 'Deploy__Checklist', 'SKILL.md'), 'utf8');
    expect(md).toContain('Prose body here.');
  });

  it('re-publishing is idempotent by name (one dir, overwritten)', async () => {
    await materializeSkill(skill({ description: 'v1' }));
    await materializeSkill(skill({ description: 'v2' }));
    const md = readFileSync(join(MANAGED_DIR, 'Deploy__Checklist', 'SKILL.md'), 'utf8');
    expect(md).toContain('v2');
    expect(md).not.toContain('"v1"');
  });

  it('dematerialize removes the SKILL.md and reloads', async () => {
    await materializeSkill(skill());
    reloadSkills.mockClear();
    await dematerializeSkill(skill());
    expect(existsSync(join(MANAGED_DIR, 'Deploy__Checklist'))).toBe(false);
    expect(reloadSkills).toHaveBeenCalledTimes(1);
  });
});
