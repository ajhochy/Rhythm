/**
 * Regression: a fresh install must be usable before any paid-provider setup.
 * These assertions fail if migrations seed either onboarding profile with a
 * paid model, omit the narrowly-scoped Zen skill, or hide the live keyless
 * OpenCode provider from the picker.
 */
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { OpencodeClientService } from '../services/opencode_client_service';

describe('Zen free-model bootstrap acceptance contract', () => {
  it('seeds both fresh-install handoff profiles with the free OpenCode route and Zen skill', () => {
    const db = new Database(':memory:');
    runMigrations(db);

    const profiles = db.prepare(`
      SELECT id, model_provider, model_id, allowed_skills_json, core_permissions_json
        FROM agent_configs
       WHERE id IN ('config-doctor', 'rhythm-setup')
       ORDER BY id
    `).all() as Array<{
      id: string;
      model_provider: string | null;
      model_id: string | null;
      allowed_skills_json: string | null;
      core_permissions_json: string | null;
    }>;

    expect(profiles).toHaveLength(2);
    for (const profile of profiles) {
      expect(profile.model_provider).toBe('opencode');
      expect(profile.model_id).toBe('deepseek-v4-flash-free');
      expect(JSON.parse(profile.allowed_skills_json ?? '[]')).toContain('zen-free-models');
    }
    // Rhythm Setup remains a handoff-only profile; granting the skill must not widen its tools.
    expect(profiles.find((profile) => profile.id === 'rhythm-setup')!.core_permissions_json).toBeNull();
  });

  it('leaves existing handoff profiles outside the Zen bootstrap, even when Config Doctor v2 still runs', () => {
    const db = new Database(':memory:');
    runMigrations(db);

    // Regression: the Zen bootstrap must be keyed to INSERT OR IGNORE's result,
    // not to a missing historical Config Doctor marker.
    db.prepare(`
      UPDATE agent_configs
         SET model_provider = 'user-provider',
             model_id = 'user-model',
             allowed_skills_json = '["existing-skill"]'
       WHERE id IN ('config-doctor', 'rhythm-setup')
    `).run();
    db.prepare(`DELETE FROM schema_meta WHERE key = 'config_doctor_prompt_v2'`).run();

    runMigrations(db);

    const profiles = db.prepare(`
      SELECT id, model_provider, model_id, allowed_skills_json
        FROM agent_configs
       WHERE id IN ('config-doctor', 'rhythm-setup')
       ORDER BY id
    `).all() as Array<{
      id: string;
      model_provider: string | null;
      model_id: string | null;
      allowed_skills_json: string | null;
    }>;

    const configDoctor = profiles.find((profile) => profile.id === 'config-doctor')!;
    // Historical v2 retains its main-branch Anthropic model repair, but must not
    // add Zen or overwrite the row through this feature.
    expect(configDoctor.model_provider).toBe('anthropic');
    expect(configDoctor.model_id).toBe('claude-sonnet-4-6');
    expect(JSON.parse(configDoctor.allowed_skills_json ?? '[]')).toEqual(['existing-skill']);

    const rhythmSetup = profiles.find((profile) => profile.id === 'rhythm-setup')!;
    expect(rhythmSetup.model_provider).toBe('user-provider');
    expect(rhythmSetup.model_id).toBe('user-model');
    expect(JSON.parse(rhythmSetup.allowed_skills_json ?? '[]')).toEqual(['existing-skill']);
  });

  it('lists a live keyless OpenCode provider without an auth-store credential', async () => {
    const service = new OpencodeClientService();
    (service as unknown as { authStore: { listAuthedProviders(): string[] } }).authStore = {
      listAuthedProviders: () => [],
    };
    service.__setTestClient({
      config: { providers: vi.fn().mockResolvedValue({ data: { providers: [{ id: 'opencode' }] } }) },
    } as never);

    await expect(service.listAuthedProviders()).resolves.toContain('opencode');
  });
});
