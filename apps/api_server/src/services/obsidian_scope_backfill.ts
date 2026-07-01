/**
 * obsidian_scope_backfill.ts — grant obsidian READ/SEARCH advertise-scope to
 * existing selectable agent profiles.
 *
 * Companion to the two other layers that grant obsidian going forward:
 *   • Importer default (agent_profile_sync.ts) — FUTURE-synced profiles get
 *     `["rhythm","obsidian"]` advertise-scope by default.
 *   • Role files (.mcp-roles/<slug>.mcp.json) — ROLED selectable agents get the
 *     obsidian read/search TOOL subset at the #736 dispatch backstop.
 *
 * This backfill closes the gap for profiles that ALREADY EXIST in
 * `agent_configs` (synced before the importer default changed). Without it, a
 * selectable agent imported on an earlier boot keeps its old scope (e.g.
 * `["rhythm"]`) and never advertises obsidian — so the vault stays invisible to
 * it even though the role file / importer default now permit it.
 *
 * What it does, per SELECTABLE profile (`session_selectable = 1`):
 *   • allowed_mcps_json is a JSON ARRAY of server names (the common form) and
 *     does NOT already contain `obsidian` → append `"obsidian"` (server-level
 *     advertise-scope = inherit-all at the advertise layer; the ROLE file still
 *     restricts a roled agent's actual obsidian tools to read/search via the
 *     #736 backstop; a non-roled selectable agent — claude-code,
 *     workflow-orchestrator — gets full obsidian read+search at advertise scope,
 *     which is acceptable for knowledge access).
 *   • allowed_mcps_json is an OBJECT-MAP `{server:[tools]}` and has no `obsidian`
 *     key → add `"obsidian": [<read/search tools>]` (object-map already scopes
 *     per-tool, so we grant exactly the read/search subset — never write/delete).
 *   • allowed_mcps_json is null/unrestricted → LEAVE null (already has every
 *     server, obsidian included). Never narrow an unrestricted profile.
 *   • already contains obsidian (array member or object key) → LEAVE AS-IS
 *     (preserves any existing write-tool grants, e.g. librarian/theologian/
 *     research, and makes the pass idempotent).
 *
 * Existing entries are NEVER removed or rewritten — only obsidian is added.
 *
 * Operational guards (mirror skill_metadata_backfill / seedAgentStackSkills):
 *   • ONE-TIME: guarded by a `schema_meta` marker ({@link BACKFILL_MARKER}); a
 *     second run is a no-op (idempotent re-run also adds nothing because every
 *     selectable row already carries obsidian by then). Uses the same
 *     `schema_meta` run-once pattern as backfill_scheduled_date_v1 / the skill
 *     unify backfill.
 *   • Postgres (env.dbClient === 'postgres') is a NO-OP — agent_configs MCP
 *     scopes are local-SQLite-only, never synced to production.
 *   • NEVER throws — startup wiring is fire-and-forget; a failure must not block
 *     boot. A failure does NOT write the marker, so a later boot retries.
 */

import { logger } from '../utils/logger';
import { env } from '../config/env';
import { getDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

/** schema_meta key for the run-once idempotency gate. */
export const BACKFILL_MARKER = 'agent_configs_obsidian_read_scope_v1';

/** The obsidian server id (the live engine id; see GET /opencode/mcp). */
export const OBSIDIAN_SERVER = 'obsidian';

/**
 * The obsidian READ/SEARCH tool subset granted by this backfill (and by the
 * role files). Intentionally excludes every write/mutate tool
 * (obsidian_put_file, obsidian_patch_file, obsidian_post_file,
 * obsidian_delete_file, the *_active / *_periodic write variants,
 * obsidian_execute_command). Knowledge access only.
 */
export const OBSIDIAN_READ_TOOLS: readonly string[] = [
  'obsidian_get_file',
  'obsidian_get_active',
  'obsidian_get_periodic',
  'obsidian_open_file',
  'obsidian_simple_search',
  'obsidian_search_dataview',
  'obsidian_search_json_logic',
  'obsidian_list_vault_directory',
  'obsidian_list_vault_root',
  'obsidian_status',
] as const;

export interface ObsidianScopeBackfillDeps {
  /** Injectable repo (defaults to a fresh AgentConfigsRepository over the global DB). */
  repo?: AgentConfigsRepository;
  /**
   * Injectable run-once check — has the backfill already run? Defaults to a
   * `schema_meta` marker read. Returns true to short-circuit.
   */
  alreadyDone?: () => boolean;
  /** Injectable run-once record — marks the backfill complete. Defaults to a `schema_meta` upsert. */
  markDone?: () => void;
}

export interface ObsidianScopeBackfillResult {
  /** Selectable profiles examined. */
  examined: number;
  /** Profiles whose array scope gained an "obsidian" member. */
  arrayGranted: number;
  /** Profiles whose object-map scope gained an "obsidian" read/search key. */
  objectGranted: number;
  /** Profiles left untouched (null scope, already-has-obsidian, or malformed). */
  skipped: number;
  /** True when the run short-circuited because the marker already existed. */
  alreadyDone: boolean;
}

const EMPTY_RESULT: ObsidianScopeBackfillResult = {
  examined: 0,
  arrayGranted: 0,
  objectGranted: 0,
  skipped: 0,
  alreadyDone: false,
};

/** Default run-once check: a `schema_meta` marker row exists for {@link BACKFILL_MARKER}. */
function defaultAlreadyDone(): boolean {
  try {
    const db = getDb();
    const row = db
      .prepare(`SELECT key FROM schema_meta WHERE key = ?`)
      .get(BACKFILL_MARKER) as { key: string } | undefined;
    return row !== undefined;
  } catch {
    // No global DB / no schema_meta — treat as not done (tests inject this).
    return false;
  }
}

/** Default run-once record: upsert the {@link BACKFILL_MARKER} marker with an ISO timestamp. */
function defaultMarkDone(): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO schema_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(BACKFILL_MARKER, new Date().toISOString());
  } catch (err) {
    logger.warn(
      `[obsidian-scope-backfill] could not write run-once marker (non-fatal): ${String(err)}`,
    );
  }
}

/**
 * Compute the obsidian-granted allowed_mcps_json for one profile.
 *
 * Returns the NEW json string when obsidian should be added, or `null` when the
 * profile must be left exactly as-is (null scope, already-has-obsidian, or a
 * shape we will not rewrite). Pure — no DB. Exported for direct unit testing.
 *
 *  - input `null`                       → null (leave unrestricted — already has all)
 *  - array WITHOUT "obsidian"            → append "obsidian" (server-level)
 *  - array WITH "obsidian"               → null (idempotent: already granted)
 *  - object-map WITHOUT "obsidian" key   → add "obsidian": [read/search tools]
 *  - object-map WITH "obsidian" key      → null (idempotent: preserve existing tools)
 *  - unparseable / neither array nor obj → null (never rewrite a malformed value)
 */
export function grantObsidianScope(allowedMcpsJson: string | null): string | null {
  if (allowedMcpsJson === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(allowedMcpsJson);
  } catch {
    return null; // never rewrite a value we cannot parse
  }

  // ── Array of server names (the common advertise-scope form). ──
  if (Array.isArray(parsed)) {
    const hasObsidian = parsed.some(
      (e) => typeof e === 'string' && e === OBSIDIAN_SERVER,
    );
    if (hasObsidian) return null; // idempotent
    // Append obsidian, preserving every existing entry verbatim and in order.
    return JSON.stringify([...parsed, OBSIDIAN_SERVER]);
  }

  // ── Object-map { server: tools[] }. ──
  if (parsed !== null && typeof parsed === 'object') {
    const map = parsed as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(map, OBSIDIAN_SERVER)) {
      return null; // idempotent — preserve the existing obsidian tool list
    }
    // Add an obsidian key scoped to read/search only; preserve all other keys.
    const next: Record<string, unknown> = { ...map, [OBSIDIAN_SERVER]: [...OBSIDIAN_READ_TOOLS] };
    return JSON.stringify(next);
  }

  // Neither array nor object — leave untouched (fail-safe).
  return null;
}

/**
 * Grant obsidian read/search advertise-scope to existing SELECTABLE profiles.
 * One-time + idempotent. Returns a result describing what was done. NEVER throws
 * — on any error it logs and returns the partial result WITHOUT writing the
 * run-once marker, so a later boot retries.
 */
export function backfillObsidianReadScope(
  deps: ObsidianScopeBackfillDeps = {},
): ObsidianScopeBackfillResult {
  // Postgres no-op — agent_configs MCP scopes are local-SQLite-only.
  if (env.dbClient === 'postgres') {
    return { ...EMPTY_RESULT, alreadyDone: true };
  }

  const repo = deps.repo ?? new AgentConfigsRepository();
  const alreadyDone = deps.alreadyDone ?? defaultAlreadyDone;
  const markDone = deps.markDone ?? defaultMarkDone;

  try {
    if (alreadyDone()) {
      return { ...EMPTY_RESULT, alreadyDone: true };
    }

    const result: ObsidianScopeBackfillResult = { ...EMPTY_RESULT };

    for (const profile of repo.list()) {
      // Only selectable profiles — the ones a user can open a session against.
      if (!profile.sessionSelectable) continue;
      result.examined += 1;

      const next = grantObsidianScope(profile.allowedMcpsJson);
      if (next === null) {
        result.skipped += 1;
        continue;
      }

      // Classify for reporting (array vs object-map) by re-inspecting the input.
      let wasArray = false;
      try {
        wasArray = Array.isArray(JSON.parse(profile.allowedMcpsJson ?? 'null'));
      } catch {
        wasArray = false;
      }

      repo.update(profile.id, { allowedMcpsJson: next });
      if (wasArray) result.arrayGranted += 1;
      else result.objectGranted += 1;
    }

    // Only mark done AFTER the full pass succeeded — a thrown error skips this
    // so a later boot retries from a clean slate (re-run is a no-op).
    markDone();

    logger.info(
      `[obsidian-scope-backfill] granted obsidian read/search advertise-scope: ` +
        `examined=${result.examined} arrayGranted=${result.arrayGranted} ` +
        `objectGranted=${result.objectGranted} skipped=${result.skipped}`,
    );
    return result;
  } catch (err) {
    logger.warn(`[obsidian-scope-backfill] backfill failed (non-fatal): ${String(err)}`);
    return { ...EMPTY_RESULT };
  }
}
