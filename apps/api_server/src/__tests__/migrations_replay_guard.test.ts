/**
 * BOOT-REPLAY STOMP GUARD — the class-closing regression test for the
 * "I re-spec an agent, it's gone on the next boot" bug family.
 *
 * runMigrations() executes on EVERY server boot (db.ts initDb), so any
 * statement in it that writes CONTENT (vs structure) without a one-time
 * schema_meta marker re-stomps live user edits on every restart. Historical
 * offenders silently reverted: Config Doctor's system prompt & core
 * permissions, Org Optimizer's MCP allowlist, Theological-Researcher's core
 * permissions, deny-all ('[]') scopes (widened back to NULL = unrestricted!),
 * non-manager delegate rosters, CLI preset fields, and model choices on
 * worship-production / title / compaction / summary.
 *
 * These tests make the whole class structurally hard to reintroduce: they
 * customize every user-editable field on every agent_configs row (including
 * rows shaped like every historical stomp target), re-run runMigrations, and
 * assert the ENTIRE database is unchanged. Any future unguarded content
 * write — to ANY table — fails here. New content repairs must use the
 * runOnce() helper in migrations.ts (see its write-discipline contract).
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

/** Stable dump of every row of every table, keyed by table name. */
function snapshotAll(db: Database.Database): Record<string, string[]> {
  const tables = (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as { name: string }[]
  ).map((t) => t.name);
  const snap: Record<string, string[]> = {};
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
    snap[table] = rows.map((r) => JSON.stringify(r, Object.keys(r).sort())).sort();
  }
  return snap;
}

function makeMigratedDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/**
 * Profile ids that historical migration repairs targeted but that do NOT
 * exist on a fresh DB (they normally arrive via the opencode profile sync).
 * Inserted so the replay exercises every historical stomp site.
 */
const SYNC_SEEDED_IDS = [
  'Theological-Researcher',
  'AI-Trend-Researcher',
  'org-optimizer',
  'worship-production',
  'worship-planning',
  'theologian',
  'research',
  'title',
  'compaction',
  'summary',
  'coding-agent',
  'fantasy-gm',
  'money',
  'secretary',
];

/**
 * Simulate a user/agent (e.g. Config Doctor) re-speccing EVERY user-editable
 * field on EVERY profile, including values that armed each historical
 * every-boot stomp:
 *  - model_id containing 'opus' + NULL tier hint (worship-production pin,
 *    title/compaction/summary haiku pin)
 *  - non-null delegates on non-manager rows (delegates wipe)
 *  - non-null MCP scope on org-optimizer (hardcoded allowlist re-stamp)
 *  - '[]' deny-all scopes (the []→NULL unrestricted-widening repair)
 *  - 'searxng-search' re-granted to research (the eternal skill prune)
 *  - CLI preset fields on gemini-cli / opencode (preset re-stamps)
 */
function applyUserEdits(db: Database.Database): void {
  db.exec(`
    UPDATE agent_configs SET
      label = 'USER LABEL ' || id,
      command = 'user-cmd',
      can_resume = 1 - COALESCE(can_resume, 0),
      resume_command = 'user-resume {{sessionId}}',
      session_id_pattern = 'user-pattern',
      output_marker = 'U',
      system_prompt = 'USER PROMPT (must survive reboot) for ' || id,
      core_permissions_json = '{"bash":"allow","user-tool":"ask"}',
      allowed_mcps_json = '["user-custom-mcp"]',
      allowed_skills_json = '["searxng-search","domain-intel","user-skill"]',
      allowed_delegates_json = '["user-delegate"]',
      model_provider = 'user-provider',
      model_id = 'user/claude-opus-custom',
      model_tier_hint = NULL,
      session_selectable = 1 - session_selectable;

    UPDATE agent_configs SET allowed_mcps_json = '[]' WHERE id IN ('config-doctor', 'secretary');
    UPDATE agent_configs SET allowed_skills_json = '[]' WHERE id = 'money';
  `);
}

describe('runMigrations boot-replay stomp guard', () => {
  it('a second run on an already-migrated DB is a total data no-op', () => {
    const db = makeMigratedDb();
    const before = snapshotAll(db);
    runMigrations(db);
    expect(snapshotAll(db)).toEqual(before);
  });

  it('user edits to every user-editable agent_configs field survive a boot replay', () => {
    const db = makeMigratedDb();
    setDb(db);
    const repo = new AgentConfigsRepository();
    for (const id of SYNC_SEEDED_IDS) {
      repo.insert({
        id,
        label: id === 'org-optimizer' ? 'Org Optimizer' : id,
        icon: 'assets/agents/opencode.png',
        isAgent: true,
      });
    }

    applyUserEdits(db);
    const before = snapshotAll(db);

    // Boot replay: the next server restart re-runs every migration.
    runMigrations(db);
    expect(snapshotAll(db)).toEqual(before);

    // And the one after that, for good measure.
    runMigrations(db);
    expect(snapshotAll(db)).toEqual(before);
  });

  it('one-time content repairs are recorded as durable schema_meta markers', () => {
    const db = makeMigratedDb();
    const keys = (db.prepare(`SELECT key FROM schema_meta`).all() as { key: string }[]).map(
      (r) => r.key,
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        'gemini_cli_preset_v1',
        'opencode_preset_v1',
        'nonmanager_delegates_wipe_v1',
        'config_doctor_prompt_v1',
        'config_doctor_mcps_v1',
        'org_optimizer_mcps_v1',
        'empty_scope_to_null_v1',
        'memory_tool_rename_scope_v1',
        'copy_scope_from_duplicates_v1',
        'theological_researcher_perms_v1',
        'research_skills_prune_v1',
        'coding_agent_model_v1',
        'rhythm_setup_model_v1',
        'worship_production_model_v1',
        'utility_modes_haiku_v1',
      ]),
    );
  });
});
