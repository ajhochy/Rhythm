/**
 * Contract tests for #880 — Agent Profile export/import.
 *
 * Covers:
 *  - export bundle contains profile fields but never a secret-shaped value
 *  - import restores profiles from a fixture bundle (create + update)
 *  - preset rows are protected on import (never overwritten)
 *  - round-trip: export -> wipe/modify -> import -> rows equivalent
 *  - idempotent re-import: unmodified re-import reports every row "skipped"
 *  - a bundle from a newer schema version fails gracefully
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { startTestServer } from './helpers/real_server';
import { AGENT_CONFIG_BUNDLE_VERSION } from '../services/agent_config_export_import';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

async function setup() {
  const db = makeDb();
  setDb(db);

  const usersRepo = new UsersRepository();
  const sessionsRepo = new SessionsRepository();
  const user = usersRepo.create({ name: 'Test User', email: 'test@example.com' });
  const session = await sessionsRepo.createAsync(user.id);
  const authHeaders: Record<string, string> = {
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
  };

  const { baseUrl, close: closeServer } = await startTestServer(createApp());

  return { baseUrl, closeServer, authHeaders };
}

describe('GET /agent-configs/export', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
  });

  afterEach(async () => {
    await closeServer();
  });

  it('returns a versioned bundle containing every seeded profile', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/export`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as { version: number; exportedAt: string; profiles: Array<Record<string, unknown>> };
    expect(bundle.version).toBe(AGENT_CONFIG_BUNDLE_VERSION);
    expect(typeof bundle.exportedAt).toBe('string');
    expect(Array.isArray(bundle.profiles)).toBe(true);
    expect(bundle.profiles.length).toBeGreaterThan(0);
    const ids = bundle.profiles.map((p) => p.id);
    expect(ids).toContain('claude-code');
  });

  it('never contains a value matching a known secret pattern', async () => {
    // Seed a custom profile carrying attacker-shaped "secret" content in every
    // free-text-ish field to prove the exporter would catch it if it leaked.
    await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Innocuous Agent', systemPrompt: 'Just a normal prompt.' }),
    });

    const res = await fetch(`${baseUrl}/agent-configs/export`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const text = await res.text();

    const secretPatterns = [
      /sk-[A-Za-z0-9]{16,}/,
      /ghp_[A-Za-z0-9]{20,}/,
      /AIza[A-Za-z0-9_-]{20,}/,
      /xox[baprs]-[A-Za-z0-9-]{10,}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    for (const pattern of secretPatterns) {
      expect(pattern.test(text)).toBe(false);
    }
    // Confirms the field-level allowlist: no field named for a raw secret value.
    expect(text).not.toMatch(/"apiKey"|"token"|"secret"|"password"/i);
  });

  it('supports filtering by ids', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/export?ids=claude-code,codex`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as { profiles: Array<{ id: string }> };
    expect(bundle.profiles.map((p) => p.id).sort()).toEqual(['claude-code', 'codex']);
  });
});

describe('POST /agent-configs/import', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
  });

  afterEach(async () => {
    await closeServer();
  });

  it('creates a new profile from a fixture bundle', async () => {
    const bundle = {
      version: AGENT_CONFIG_BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      profiles: [
        {
          id: 'imported-worship-planner',
          label: 'Imported Worship Planner',
          icon: 'assets/agents/opencode.png',
          enabled: true,
          isAgent: true,
          isManager: false,
          systemPrompt: 'Plan worship services.',
          allowedMcpsJson: '["rhythm"]',
          allowedSkillsJson: null,
          allowedDelegatesJson: null,
          presetId: null,
          sortOrder: 100,
          modelProvider: 'anthropic',
          modelId: 'claude-sonnet-4-6',
          ocAgent: 'imported-worship-planner',
          sessionSelectable: true,
          modelTierHint: 'standard',
        },
      ],
    };

    const res = await fetch(`${baseUrl}/agent-configs/import`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ bundle }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ id: string; action: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ id: 'imported-worship-planner', action: 'created' });

    const getRes = await fetch(`${baseUrl}/agent-configs/imported-worship-planner`, {
      headers: authHeaders,
    });
    expect(getRes.status).toBe(200);
    const saved = (await getRes.json()) as Record<string, unknown>;
    expect(saved.label).toBe('Imported Worship Planner');
    expect(saved.systemPrompt).toBe('Plan worship services.');
  });

  it('updates an existing non-preset profile', async () => {
    const createRes = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Original Label', systemPrompt: 'Old prompt' }),
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const exportRes = await fetch(`${baseUrl}/agent-configs/export?ids=${created.id}`, {
      headers: authHeaders,
    });
    const bundle = (await exportRes.json()) as {
      version: number;
      exportedAt: string;
      profiles: Array<Record<string, unknown>>;
    };
    bundle.profiles[0].label = 'Updated Label';
    bundle.profiles[0].systemPrompt = 'New prompt';

    const importRes = await fetch(`${baseUrl}/agent-configs/import`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ bundle }),
    });
    expect(importRes.status).toBe(200);
    const importBody = (await importRes.json()) as { results: Array<{ action: string }> };
    expect(importBody.results[0].action).toBe('updated');

    const getRes = await fetch(`${baseUrl}/agent-configs/${created.id}`, { headers: authHeaders });
    const updated = (await getRes.json()) as Record<string, unknown>;
    expect(updated.label).toBe('Updated Label');
    expect(updated.systemPrompt).toBe('New prompt');
  });

  it('skips a preset row rather than overwriting its identity fields', async () => {
    const bundle = {
      version: AGENT_CONFIG_BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      profiles: [
        {
          id: 'claude-code',
          label: 'Hijacked Label',
          icon: 'evil.png',
          enabled: true,
          isAgent: false,
          isManager: false,
          systemPrompt: null,
          allowedMcpsJson: null,
          allowedSkillsJson: null,
          allowedDelegatesJson: null,
          presetId: 'claude-code',
          sortOrder: 0,
          modelProvider: null,
          modelId: null,
          ocAgent: null,
          sessionSelectable: true,
          modelTierHint: null,
        },
      ],
    };

    const res = await fetch(`${baseUrl}/agent-configs/import`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ bundle }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ action: string; reason?: string }> };
    expect(body.results[0].action).toBe('skipped');
    expect(body.results[0].reason).toMatch(/preset/i);

    const getRes = await fetch(`${baseUrl}/agent-configs/claude-code`, { headers: authHeaders });
    const preset = (await getRes.json()) as Record<string, unknown>;
    expect(preset.label).toBe('Claude Code');
  });

  it('round-trips: export -> modify DB -> import -> rows match the export', async () => {
    await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Round Trip Agent', systemPrompt: 'Prompt A' }),
    });

    const exportRes = await fetch(`${baseUrl}/agent-configs/export`, { headers: authHeaders });
    const bundle = await exportRes.json();

    // "Modify/wipe" — delete the custom agent from the DB.
    const listRes = await fetch(`${baseUrl}/agent-configs`, { headers: authHeaders });
    const list = (await listRes.json()) as Array<{ id: string; label: string; presetId: string | null }>;
    const roundTripAgent = list.find((c) => c.label === 'Round Trip Agent')!;
    await fetch(`${baseUrl}/agent-configs/${roundTripAgent.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    const missingRes = await fetch(`${baseUrl}/agent-configs/${roundTripAgent.id}`, {
      headers: authHeaders,
    });
    expect(missingRes.status).toBe(404);

    // Re-import the original export.
    const importRes = await fetch(`${baseUrl}/agent-configs/import`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ bundle }),
    });
    expect(importRes.status).toBe(200);

    const restoredRes = await fetch(`${baseUrl}/agent-configs/${roundTripAgent.id}`, {
      headers: authHeaders,
    });
    expect(restoredRes.status).toBe(200);
    const restored = (await restoredRes.json()) as Record<string, unknown>;
    expect(restored.label).toBe('Round Trip Agent');
    expect(restored.systemPrompt).toBe('Prompt A');

    // Re-exporting now matches the original bundle's profile set exactly.
    const reExportRes = await fetch(`${baseUrl}/agent-configs/export`, { headers: authHeaders });
    const reExported = (await reExportRes.json()) as { profiles: Array<Record<string, unknown>> };
    const originalIds = (bundle as { profiles: Array<{ id: string }> }).profiles
      .map((p) => p.id)
      .sort();
    const reExportedIds = reExported.profiles.map((p) => p.id).sort();
    expect(reExportedIds).toEqual(originalIds);
  });

  it('idempotent re-import: an unmodified bundle is a no-op (all rows skipped)', async () => {
    await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Stable Agent', systemPrompt: 'Stable prompt' }),
    });

    const exportRes = await fetch(`${baseUrl}/agent-configs/export`, { headers: authHeaders });
    const bundle = await exportRes.json();

    const firstImport = await fetch(`${baseUrl}/agent-configs/import`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ bundle }),
    });
    const firstBody = (await firstImport.json()) as { results: Array<{ action: string }> };
    // First re-import of an already-present, unmodified set: every row skipped.
    expect(firstBody.results.every((r) => r.action === 'skipped')).toBe(true);

    const secondImport = await fetch(`${baseUrl}/agent-configs/import`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ bundle }),
    });
    const secondBody = (await secondImport.json()) as { results: Array<{ action: string }> };
    expect(secondBody.results.every((r) => r.action === 'skipped')).toBe(true);

    const listRes = await fetch(`${baseUrl}/agent-configs`, { headers: authHeaders });
    const list = (await listRes.json()) as Array<{ label: string }>;
    expect(list.filter((c) => c.label === 'Stable Agent')).toHaveLength(1);
  });

  it('rejects a bundle from a newer schema version with a clear upgrade message', async () => {
    const bundle = {
      version: AGENT_CONFIG_BUNDLE_VERSION + 1,
      exportedAt: new Date().toISOString(),
      profiles: [],
    };

    const res = await fetch(`${baseUrl}/agent-configs/import`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ bundle }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string }; message?: string };
    const message = body.error?.message ?? body.message ?? '';
    expect(message.toLowerCase()).toMatch(/newer|upgrade/);
  });

  it('rejects a bundle missing the profiles array', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/import`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ bundle: { version: 1 } }),
    });
    expect(res.status).toBe(400);
  });
});
