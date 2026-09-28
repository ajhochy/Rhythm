/**
 * Live contract for web/Electron profile skill management.
 * Drives the already-running isolated sandbox API + fork engine. It creates
 * only disposable resources and removes them in afterAll.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assertLiveE2EIsolation } from './_live_e2e_guard';

const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = enabled ? describe.sequential : describe.skip;
const apiBase = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const engineBase = (process.env.RHYTHM_LIVE_ENGINE_URL ?? '').replace(/\/$/, '');
const sandboxHome = process.env.RHYTHM_SANDBOX_HOME ?? '';
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const managedSkillsDir = process.env.RHYTHM_MANAGED_SKILLS_DIR ?? '';
const nonce = randomUUID().slice(0, 8);
const skillName = `profile-skill-e2e-${nonce}`;
let profileId = '';
let skillCreated = false;

async function request<T>(path: string, init?: RequestInit, expected = 200): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  expect(response.status, `${init?.method ?? 'GET'} ${path}: ${text}`).toBe(expected);
  return (text ? JSON.parse(text) : undefined) as T;
}

describeLive('profile allowed-skills management live contract', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    for (const [label, value] of Object.entries({ apiBase, engineBase, sandboxHome, dbPath, managedSkillsDir })) {
      if (!value) throw new Error(`${label} is required`);
    }
    const sandboxRoot = resolve(process.env.RHYTHM_SANDBOX_DIR ?? '');
    for (const path of [sandboxHome, dbPath, managedSkillsDir]) {
      if (!resolve(path).startsWith(`${sandboxRoot}/`)) throw new Error(`${path} is outside RHYTHM_SANDBOX_DIR`);
    }
    const [apiHealth, engineHealth] = await Promise.all([fetch(`${apiBase}/health`), fetch(`${engineBase}/global/health`)]);
    expect(apiHealth.ok).toBe(true);
    expect(engineHealth.ok).toBe(true);
  });

  afterAll(async () => {
    if (skillCreated) await fetch(`${apiBase}/opencode/skills/${encodeURIComponent(skillName)}`, { method: 'DELETE' }).catch(() => {});
    if (profileId) await fetch(`${apiBase}/agent-configs/${encodeURIComponent(profileId)}`, { method: 'DELETE' }).catch(() => {});
  });

  it('task-profile-allowed-skills-management-c15: managed skill CRUD and exact profile projection round-trip through the real sandbox', async () => {
    const createdSkill = await request<{ name: string; managed: boolean; source: string }>('/opencode/skills', {
      method: 'POST',
      body: JSON.stringify({ name: skillName, description: 'Disposable profile scope proof', content: `Use the disposable ${nonce} workflow.` }),
    });
    skillCreated = true;
    expect(createdSkill).toMatchObject({ name: skillName, managed: true, source: 'managed' });

    const catalog = await request<Array<{ name: string; managed: boolean }>>('/opencode/skills');
    expect(catalog).toContainEqual(expect.objectContaining({ name: skillName, managed: true }));
    const content = await request<{ name: string; content: string }>(`/opencode/skills/${encodeURIComponent(skillName)}/content`);
    expect(content.name).toBe(skillName);
    expect(content.content).toContain(`name: ${skillName}`);
    expect(content.content).toContain(`Use the disposable ${nonce} workflow.`);
    expect(content.content).not.toContain(managedSkillsDir);
    const skillFile = join(managedSkillsDir, skillName, 'SKILL.md');
    expect(existsSync(skillFile)).toBe(true);

    const profile = await request<{ id: string }>('/agent-configs', {
      method: 'POST',
      body: JSON.stringify({ label: `Profile skill E2E ${nonce}`, icon: 'PS', isAgent: true, enabled: true, sessionSelectable: true }),
    }, 201);
    profileId = profile.id;
    const allowedSkillsJson = JSON.stringify([skillName]);
    const patched = await request<{ id: string; allowedSkillsJson: string | null }>(`/agent-configs/${encodeURIComponent(profileId)}`, {
      method: 'PATCH', body: JSON.stringify({ allowedSkillsJson }),
    });
    expect(patched.allowedSkillsJson).toBe(allowedSkillsJson);
    const readback = await request<{ allowedSkillsJson: string | null }>(`/agent-configs/${encodeURIComponent(profileId)}`);
    expect(readback.allowedSkillsJson).toBe(allowedSkillsJson);

    await request(`/agent-configs/${encodeURIComponent(profileId)}/resync-agent-file`, { method: 'POST' });
    const projectedProfile = join(sandboxHome, '.config', 'opencode', 'agents', `${profileId}.md`);
    expect(existsSync(projectedProfile)).toBe(true);
    const projected = readFileSync(projectedProfile, 'utf8');
    expect(projected).toContain(`description: "Profile skill E2E ${nonce}"`);
    expect(projected).toContain(`options: {"skillAllowlist":{"skills":["${skillName}"]}}`);
    const db = new Database(dbPath, { readonly: true });
    try {
      expect(db.prepare('SELECT allowed_skills_json FROM agent_configs WHERE id = ?').get(profileId)).toEqual({ allowed_skills_json: allowedSkillsJson });
    } finally { db.close(); }

    await request(`/opencode/skills/${encodeURIComponent(skillName)}`, {
      method: 'PUT', body: JSON.stringify({ description: 'Updated disposable proof', content: `Updated ${nonce} instructions.` }),
    });
    const updated = await request<{ content: string }>(`/opencode/skills/${encodeURIComponent(skillName)}/content`);
    expect(updated.content).toContain(`Updated ${nonce} instructions.`);

    await request(`/opencode/skills/${encodeURIComponent(skillName)}`, { method: 'DELETE' }, 204);
    skillCreated = false;
    const afterDelete = await request<Array<{ name: string }>>('/opencode/skills');
    expect(afterDelete.some(skill => skill.name === skillName)).toBe(false);
    expect(existsSync(skillFile)).toBe(false);
  }, 60_000);
});
