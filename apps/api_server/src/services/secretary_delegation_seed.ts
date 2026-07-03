/**
 * Secretary Delegation Seed — Issue #883
 *
 * Secretary is a configured Manager profile (`is_manager = true`) whose
 * `allowed_delegates_json` roster and `rhythm_delegate` tool grant have, until
 * now, only ever been set by hand via the Agent Profiles designer UI — there
 * was no canonical, reproducible source for either value. A fresh database
 * (a new install, a wiped local dev DB, or a future environment) would seed
 * `secretary` as a NON-manager with an empty roster and no way to delegate,
 * silently regressing the intended design documented in
 * `.mcp-roles/secretary.mcp.json`'s system prompt ("Delegate domain work to
 * the approved specialist instead of attempting it yourself...").
 *
 * This module closes that gap by reading the new `isManager` /
 * `allowedDelegates` fields on `.mcp-roles/secretary.mcp.json` (READ-ONLY —
 * mirrors `ministry_recipes_seed.ts`'s role-file reader) and reconciling them
 * into the `secretary` `agent_configs` row.
 *
 * Non-clobber discipline (same USER-OWNED overlay contract as
 * `agent_profile_sync.ts`'s allowed_mcps_json / allowed_skills_json /
 * allowed_delegates_json handling): a column is backfilled ONLY when it is
 * still at its unset default —
 *   - `is_manager`            → only flips false → true, never true → false.
 *   - `allowed_delegates_json` → only backfilled when still NULL; an existing
 *     (possibly hand-edited, possibly narrower or broader) roster is left
 *     completely untouched.
 * This makes the manager/roster configuration reproducible on a clean
 * database without manual SQL or UI edits, while never overwriting a value a
 * human already set in the designer.
 *
 * Invoked from `agent_profile_sync.syncOpencodeAgentProfiles()` (appended
 * after its main loop, alongside the #858 oc_agent repair pass) rather than
 * directly at server boot: `syncOpencodeAgentProfiles` is NOT called at boot
 * — it runs fire-and-forget on every `GET /agent-sessions/agents` call and
 * on-demand via `POST /agent-configs/sync-opencode` — so chaining this seed
 * there guarantees it runs as soon as the `secretary` row actually exists,
 * rather than only at server start (when the row is typically not yet synced
 * from the opencode agent registry).
 *
 * Never throws — a missing/malformed role file, a missing `secretary` row,
 * or a DB error is logged and this pass is retried on the next sync. No-op
 * under Postgres (agent_configs manager/delegate scoping is a local-SQLite
 * agent-execution surface, the same rule as every other seed in this family).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

const SECRETARY_ROLE_SLUG = 'secretary';

const MCP_ROLES_DIR = () =>
  process.env.MCP_ROLES_DIR ?? path.join(__dirname, '..', '..', '..', '..', '.mcp-roles');

interface SecretaryRoleFile {
  isManager?: boolean;
  allowedDelegates?: string[];
}

/**
 * Read `.mcp-roles/secretary.mcp.json`, returning only the two fields this
 * seed cares about. Returns null (never throws) when the file is absent or
 * malformed — a missing/broken role file must not block boot.
 */
function readSecretaryRoleFile(): SecretaryRoleFile | null {
  try {
    const p = path.join(MCP_ROLES_DIR(), `${SECRETARY_ROLE_SLUG}.mcp.json`);
    if (!existsSync(p)) return null;
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    const isManager = typeof parsed.isManager === 'boolean' ? parsed.isManager : undefined;
    const allowedDelegates =
      Array.isArray(parsed.allowedDelegates) &&
      parsed.allowedDelegates.every((v) => typeof v === 'string')
        ? (parsed.allowedDelegates as string[])
        : undefined;
    return { isManager, allowedDelegates };
  } catch (err) {
    logger.warn(
      `[secretary-delegation-seed] could not read role file "${SECRETARY_ROLE_SLUG}" (non-fatal): ${String(err)}`,
    );
    return null;
  }
}

export interface SecretaryDelegationSeedResult {
  /** True when is_manager was flipped false → true this pass. */
  managerBackfilled: boolean;
  /** True when allowed_delegates_json was backfilled from null this pass. */
  delegatesBackfilled: boolean;
  /** True when the secretary agent_configs row does not exist yet (skipped). */
  secretaryRowMissing: boolean;
  /** True when the role file was missing/malformed (skipped). */
  roleFileMissing: boolean;
}

/**
 * Idempotently reconcile `agent_configs`'s `secretary` row against
 * `.mcp-roles/secretary.mcp.json`'s `isManager` / `allowedDelegates` fields.
 *
 * Backfill-only: never overwrites a column that already holds a non-default
 * value. Safe to run on every boot — a fully-reconciled or hand-edited row
 * results in zero writes.
 */
export async function seedSecretaryDelegation(): Promise<SecretaryDelegationSeedResult> {
  const result: SecretaryDelegationSeedResult = {
    managerBackfilled: false,
    delegatesBackfilled: false,
    secretaryRowMissing: false,
    roleFileMissing: false,
  };

  // Local-only: production Postgres has no local opencode engine / delegation
  // surface to scope (same rule as ministry_recipes_seed / org_optimizer_seed).
  if (env.dbClient === 'postgres') {
    return result;
  }

  const roleFile = readSecretaryRoleFile();
  if (!roleFile) {
    result.roleFileMissing = true;
    logger.warn(
      '[secretary-delegation-seed] missing/malformed secretary role file — skipping this pass (retried on next sync)',
    );
    return result;
  }

  const repo = new AgentConfigsRepository();
  let existing;
  try {
    existing = repo.getById(SECRETARY_ROLE_SLUG);
  } catch (err) {
    logger.warn(`[secretary-delegation-seed] agent_configs lookup failed (non-fatal): ${String(err)}`);
    return result;
  }

  if (!existing) {
    // The secretary agent_configs row is created by the SAME sync pass that
    // calls this function (syncOpencodeAgentProfiles's main loop, keyed by
    // the opencode agent name) — if the "secretary" opencode agent hasn't
    // been registered/synced yet, there is nothing to reconcile. Retried on
    // the next sync.
    result.secretaryRowMissing = true;
    return result;
  }

  const patch: Parameters<typeof repo.update>[1] = {};

  if (!existing.isManager && roleFile.isManager === true) {
    patch.isManager = true;
  }

  if (existing.allowedDelegatesJson === null && roleFile.allowedDelegates) {
    patch.allowedDelegatesJson = JSON.stringify(roleFile.allowedDelegates);
  }

  if (Object.keys(patch).length === 0) {
    return result;
  }

  try {
    repo.update(SECRETARY_ROLE_SLUG, patch);
    result.managerBackfilled = patch.isManager === true;
    result.delegatesBackfilled = patch.allowedDelegatesJson !== undefined;
    logger.info(
      `[secretary-delegation-seed] backfilled secretary agent_configs: managerBackfilled=${result.managerBackfilled} delegatesBackfilled=${result.delegatesBackfilled}`,
    );
  } catch (err) {
    logger.warn(`[secretary-delegation-seed] failed to update secretary row (non-fatal): ${String(err)}`);
  }

  return result;
}
