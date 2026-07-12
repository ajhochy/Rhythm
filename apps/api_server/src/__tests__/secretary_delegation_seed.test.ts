/**
 * CONTRACT TESTS — Issue #883: secretary delegation seed.
 *
 * Secretary is a configured Manager profile whose `is_manager` /
 * `allowed_delegates_json` roster had, until now, only ever been set by hand
 * via the Agent Profiles designer — there was no canonical, reproducible
 * source. `secretary_delegation_seed.ts` closes that gap by reading
 * `.mcp-roles/secretary.mcp.json`'s new `isManager` / `allowedDelegates`
 * fields and backfilling the `secretary` `agent_configs` row.
 *
 * Acceptance proven here:
 *   - AC (profile-scope/sync layer): a fresh `secretary` row (is_manager=false,
 *     allowed_delegates_json=null) is backfilled to is_manager=true and the
 *     role file's roster after running the seed against the REAL
 *     `.mcp-roles/secretary.mcp.json` (no fixture substitution — proves the
 *     actual shipped role file, not a stand-in, drives the backfill).
 *   - Non-clobber: a row where a human already set `is_manager` / a narrower
 *     or different `allowed_delegates_json` via the designer is left
 *     completely untouched (USER-OWNED overlay contract, same as
 *     agent_profile_sync.ts's other overlay columns).
 *   - Missing role file / missing secretary row / Postgres are all non-fatal
 *     no-ops.
 *   - `rhythm_delegate` is present in secretary's real `.mcp-roles/secretary.
 *     mcp.json` rhythm allowedTools (the resolved tool-scope fix) — this is
 *     a plain role-file assertion mirroring how `resolveMcpRole()` reads it
 *     live at session-create time (no separate "sync" needed for tool scope).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { seedSecretaryDelegation } from '../services/secretary_delegation_seed';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const REAL_SECRETARY_ROLE_FILE = path.join(REPO_ROOT, '.mcp-roles', 'secretary.mcp.json');

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function insertSecretaryRow(
  repo: AgentConfigsRepository,
  overrides: Partial<Parameters<AgentConfigsRepository['insert']>[0]> = {},
) {
  return repo.insert({
    id: 'secretary',
    label: 'Secretary',
    icon: 'assets/agents/opencode.png',
    isAgent: true,
    sessionSelectable: true,
    ...overrides,
  });
}

describe('.mcp-roles/secretary.mcp.json — tool scope (#883)', () => {
  it('grants rhythm_delegate in the rhythm server allowedTools', () => {
    const raw = JSON.parse(readFileSync(REAL_SECRETARY_ROLE_FILE, 'utf8'));
    expect(raw.mcpServers.rhythm.allowedTools).toContain('rhythm_delegate');
  });

  it('declares isManager + a non-empty allowedDelegates roster', () => {
    const raw = JSON.parse(readFileSync(REAL_SECRETARY_ROLE_FILE, 'utf8'));
    expect(raw.isManager).toBe(true);
    expect(Array.isArray(raw.allowedDelegates)).toBe(true);
    expect(raw.allowedDelegates.length).toBeGreaterThan(0);
    // The roster the issue asks for: church-staff specialists that exist as
    // profiles, plus the pre-existing researchers + fantasy-gm.
    expect(raw.allowedDelegates).toEqual(
      expect.arrayContaining(['theologian', 'librarian', 'worship-planning', 'fantasy-gm']),
    );
  });
});

describe('seedSecretaryDelegation — backfill against the REAL role file', () => {
  beforeEach(() => {
    setDb(makeDb());
  });

  it('backfills is_manager + allowed_delegates_json on a fresh secretary row', async () => {
    const repo = new AgentConfigsRepository();
    insertSecretaryRow(repo);

    const result = await seedSecretaryDelegation();

    expect(result.managerBackfilled).toBe(true);
    expect(result.delegatesBackfilled).toBe(true);

    const after = repo.getById('secretary')!;
    expect(after.isManager).toBe(true);
    const roster = JSON.parse(after.allowedDelegatesJson!);
    expect(roster).toEqual(
      expect.arrayContaining(['theologian', 'librarian', 'worship-planning', 'fantasy-gm']),
    );
  });

  it('is idempotent — a second run performs no further writes', async () => {
    const repo = new AgentConfigsRepository();
    insertSecretaryRow(repo);
    await seedSecretaryDelegation();
    const afterFirst = repo.getById('secretary')!;

    const secondResult = await seedSecretaryDelegation();
    expect(secondResult.managerBackfilled).toBe(false);
    expect(secondResult.delegatesBackfilled).toBe(false);

    const afterSecond = repo.getById('secretary')!;
    expect(afterSecond.allowedDelegatesJson).toBe(afterFirst.allowedDelegatesJson);
    expect(afterSecond.isManager).toBe(afterFirst.isManager);
  });

  it('reconciles a drifted allowed_delegates_json to the role-file roster (#889 — was a non-clobber overlay, now a secretary-only reconcile)', async () => {
    const repo = new AgentConfigsRepository();
    // A dirty roster shaped like the live #889 regression: raw UUIDs and
    // spaced display names instead of the hyphenated slugs the role file and
    // agent_delegation_service expect.
    const dirtyRoster = [
      '3f9a1c2e-8b4d-4a1e-9c3f-1a2b3c4d5e6f',
      'AI Trend Researcher',
      'Theological Researcher',
      'workflow-orchestrator',
      'graphic-designer',
    ];
    insertSecretaryRow(repo, {
      isManager: true,
      allowedDelegatesJson: JSON.stringify(dirtyRoster),
    });

    const result = await seedSecretaryDelegation();
    expect(result.delegatesBackfilled).toBe(true);

    const after = repo.getById('secretary')!;
    const roster = JSON.parse(after.allowedDelegatesJson!);
    // Exactly the role-file's 7 slugs — the dirty entries are gone.
    expect(roster).toEqual(
      expect.arrayContaining(['theologian', 'librarian', 'worship-planning', 'fantasy-gm']),
    );
    expect(roster).not.toEqual(expect.arrayContaining(['workflow-orchestrator', 'graphic-designer']));
    for (const dirty of dirtyRoster) {
      expect(roster).not.toContain(dirty);
    }
  });

  it('is a no-op when the existing roster already matches the role file (order-independent)', async () => {
    const repo = new AgentConfigsRepository();
    const raw = JSON.parse(readFileSync(REAL_SECRETARY_ROLE_FILE, 'utf8'));
    const reordered = [...raw.allowedDelegates].reverse();
    insertSecretaryRow(repo, {
      isManager: true,
      allowedDelegatesJson: JSON.stringify(reordered),
    });

    const result = await seedSecretaryDelegation();
    expect(result.delegatesBackfilled).toBe(false);

    const after = repo.getById('secretary')!;
    expect(after.allowedDelegatesJson).toBe(JSON.stringify(reordered));
  });

  it('a user-edited roster survives later syncs — the drift reconcile is ONE-TIME (boot-stomp class fix)', async () => {
    const repo = new AgentConfigsRepository();
    insertSecretaryRow(repo);

    // First sync: backfills the roster from the role file and consumes the
    // one-time drift-repair marker — the roster is user-owned from here on.
    await seedSecretaryDelegation();

    // User re-specs the roster in the designer.
    repo.update('secretary', { allowedDelegatesJson: JSON.stringify(['user-choice-agent']) });

    // Every later sync (this seed runs on EVERY picker refresh) must leave it
    // alone — reconciling on every pass was the #1039-family revert bug.
    const result = await seedSecretaryDelegation();
    expect(result.delegatesBackfilled).toBe(false);
    const after = repo.getById('secretary')!;
    expect(JSON.parse(after.allowedDelegatesJson!)).toEqual(['user-choice-agent']);
  });

  it('never flips is_manager from true back to false, and never touches an already-true row', async () => {
    const repo = new AgentConfigsRepository();
    insertSecretaryRow(repo, {
      isManager: true,
    });

    const result = await seedSecretaryDelegation();
    expect(result.managerBackfilled).toBe(false);

    const after = repo.getById('secretary')!;
    expect(after.isManager).toBe(true);
  });

  it('is a no-op when the secretary agent_configs row does not exist yet', async () => {
    const result = await seedSecretaryDelegation();
    expect(result.secretaryRowMissing).toBe(true);
    expect(result.managerBackfilled).toBe(false);
    expect(result.delegatesBackfilled).toBe(false);
  });
});

describe('seedSecretaryDelegation — isolated fixture scenarios (MCP_ROLES_DIR override)', () => {
  let tmpRolesDir: string;
  const originalEnv = process.env.MCP_ROLES_DIR;

  beforeEach(() => {
    setDb(makeDb());
    tmpRolesDir = mkdtempSync(path.join(tmpdir(), 'secretary-delegation-seed-test-'));
    process.env.MCP_ROLES_DIR = tmpRolesDir;
  });

  afterEach(() => {
    rmSync(tmpRolesDir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.MCP_ROLES_DIR;
    else process.env.MCP_ROLES_DIR = originalEnv;
  });

  it('is a non-fatal no-op when the role file is missing', async () => {
    const repo = new AgentConfigsRepository();
    insertSecretaryRow(repo);

    const result = await seedSecretaryDelegation();
    expect(result.roleFileMissing).toBe(true);
    expect(result.managerBackfilled).toBe(false);
    expect(result.delegatesBackfilled).toBe(false);

    const after = repo.getById('secretary')!;
    expect(after.isManager).toBe(false);
    expect(after.allowedDelegatesJson).toBeNull();
  });

  it('is a non-fatal no-op when the role file is malformed JSON', async () => {
    writeFileSync(path.join(tmpRolesDir, 'secretary.mcp.json'), '{ not valid json', 'utf8');
    const repo = new AgentConfigsRepository();
    insertSecretaryRow(repo);

    const result = await seedSecretaryDelegation();
    expect(result.roleFileMissing).toBe(true);

    const after = repo.getById('secretary')!;
    expect(after.isManager).toBe(false);
  });

  it('backfills exactly the roster declared in a custom role file', async () => {
    writeFileSync(
      path.join(tmpRolesDir, 'secretary.mcp.json'),
      JSON.stringify({
        role: 'secretary',
        mcpServers: {},
        isManager: true,
        allowedDelegates: ['foo-specialist', 'bar-specialist'],
      }),
      'utf8',
    );
    const repo = new AgentConfigsRepository();
    insertSecretaryRow(repo);

    const result = await seedSecretaryDelegation();
    expect(result.managerBackfilled).toBe(true);
    expect(result.delegatesBackfilled).toBe(true);

    const after = repo.getById('secretary')!;
    expect(JSON.parse(after.allowedDelegatesJson!)).toEqual(['foo-specialist', 'bar-specialist']);
  });

  it('does not set is_manager when the role file omits isManager', async () => {
    writeFileSync(
      path.join(tmpRolesDir, 'secretary.mcp.json'),
      JSON.stringify({ role: 'secretary', mcpServers: {}, allowedDelegates: ['foo-specialist'] }),
      'utf8',
    );
    const repo = new AgentConfigsRepository();
    insertSecretaryRow(repo);

    const result = await seedSecretaryDelegation();
    expect(result.managerBackfilled).toBe(false);
    expect(result.delegatesBackfilled).toBe(true);

    const after = repo.getById('secretary')!;
    expect(after.isManager).toBe(false);
  });
});
