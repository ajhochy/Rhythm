/**
 * Agent Profile export/import (#880).
 *
 * Lets an operator move Agent Profiles (agent_configs rows) between machines
 * or share a "starter" profile set for onboarding — without ever carrying a
 * secret value. A profile row (see agent_configs_repository.ts) has no field
 * that holds a credential; it only carries *references* (MCP/skill/delegate
 * *names*, a model id string, a system prompt). Export asserts this at
 * runtime via `assertNoSecretLikeValues` so a future field addition can never
 * silently leak a secret through this path.
 *
 * Bundle format: plain JSON, versioned (`AGENT_CONFIG_BUNDLE_VERSION`), one
 * top-level `profiles` array. A bundle from a newer schema version than this
 * build understands is rejected with a clear upgrade message rather than
 * partially imported.
 *
 * Import upserts by `id`: an existing row is updated in place, a missing one
 * is inserted. After the DB write, each affected profile is re-projected to
 * its opencode agent file (`writeAgentProfileFile`, mirroring the create/patch
 * controller paths) and `syncOpencodeAgentProfiles()` is triggered once at the
 * end so the engine's agent registry picks up any newly-registered profile
 * files. Re-importing an unmodified bundle is a no-op: every field is
 * compared before writing and a row with no differences is reported
 * `"skipped"`.
 */

import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { AgentConfig, AgentConfigInput } from '../repositories/agent_configs_repository';
import { writeAgentProfileFile } from './opencode_agent_writer';
import { syncOpencodeAgentProfiles } from './agent_profile_sync';
import { logger } from '../utils/logger';

/** Current bundle schema version. Bump on any breaking shape change. */
export const AGENT_CONFIG_BUNDLE_VERSION = 1;

/** Fields carried in a bundle profile entry. Deliberately excludes nothing
 * secret-bearing exists on AgentConfig — see module doc — but the field list
 * is enumerated explicitly (rather than spread) so a future secret-bearing
 * column added to AgentConfig does NOT automatically leak into an export. */
export interface AgentConfigBundleProfile {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  isAgent: boolean;
  isManager: boolean;
  systemPrompt: string | null;
  allowedMcpsJson: string | null;
  allowedSkillsJson: string | null;
  corePermissionsJson: string | null;
  allowedDelegatesJson: string | null;
  presetId: string | null;
  sortOrder: number;
  modelProvider: string | null;
  modelId: string | null;
  ocAgent: string | null;
  sessionSelectable: boolean;
  modelTierHint: string | null;
}

export interface AgentConfigBundle {
  version: number;
  exportedAt: string;
  profiles: AgentConfigBundleProfile[];
}

export type ImportAction = 'created' | 'updated' | 'skipped' | 'error';

export interface ImportResult {
  id: string;
  label: string;
  action: ImportAction;
  reason?: string;
}

/**
 * Patterns that a secret VALUE (as opposed to a secret's env-var NAME) tends
 * to match. Agent profile fields never hold key material, but this is a
 * defense-in-depth static check run over every string field at export time —
 * per the issue's "Data-safety" requirement — so a future field addition that
 * accidentally carries a live credential fails loudly instead of shipping.
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/, // OpenAI/Anthropic-style API keys
  /ghp_[A-Za-z0-9]{20,}/, // GitHub personal access token
  /AIza[A-Za-z0-9_-]{20,}/, // Google API key
  /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack token
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key block
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
];

/**
 * Scan every string field of a bundle profile for a secret-shaped value.
 * Throws with the offending field name if found. Never mutates the input.
 */
function assertNoSecretLikeValues(profile: AgentConfigBundleProfile): void {
  for (const [key, value] of Object.entries(profile)) {
    if (typeof value !== 'string') continue;
    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        throw new Error(
          `[AgentConfigExport] refusing to export profile "${profile.id}": ` +
            `field "${key}" matches a known secret-value pattern`,
        );
      }
    }
  }
}

function toBundleProfile(config: AgentConfig): AgentConfigBundleProfile {
  return {
    id: config.id,
    label: config.label,
    icon: config.icon,
    enabled: config.enabled,
    isAgent: config.isAgent,
    isManager: config.isManager,
    systemPrompt: config.systemPrompt,
    allowedMcpsJson: config.allowedMcpsJson,
    allowedSkillsJson: config.allowedSkillsJson,
    corePermissionsJson: config.corePermissionsJson,
    allowedDelegatesJson: config.allowedDelegatesJson,
    presetId: config.presetId,
    sortOrder: config.sortOrder,
    modelProvider: config.modelProvider,
    modelId: config.modelId,
    ocAgent: config.ocAgent,
    sessionSelectable: config.sessionSelectable,
    modelTierHint: config.modelTierHint,
  };
}

/**
 * Build an export bundle. `ids` optionally restricts the export to a subset
 * of profiles (by `agent_configs.id`); omitted/undefined exports every row.
 * Throws if any profile fails the secret-pattern scan (see module doc).
 */
export function buildAgentConfigExportBundle(ids?: string[]): AgentConfigBundle {
  const repo = new AgentConfigsRepository();
  const all = repo.list();
  const selected = ids && ids.length > 0 ? all.filter((c) => ids.includes(c.id)) : all;

  const profiles = selected.map(toBundleProfile);
  for (const profile of profiles) assertNoSecretLikeValues(profile);

  return {
    version: AGENT_CONFIG_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    profiles,
  };
}

/** Narrow + validate the shape of an unknown value as an AgentConfigBundle. */
export function parseAgentConfigBundle(input: unknown): AgentConfigBundle {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Bundle must be a JSON object');
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.version !== 'number') {
    throw new Error('Bundle is missing a numeric "version" field');
  }
  if (obj.version > AGENT_CONFIG_BUNDLE_VERSION) {
    throw new Error(
      `Bundle version ${obj.version} is newer than this Rhythm build supports ` +
        `(max ${AGENT_CONFIG_BUNDLE_VERSION}). Upgrade Rhythm before importing this bundle.`,
    );
  }
  if (obj.version < 1) {
    throw new Error(`Bundle version ${String(obj.version)} is not a supported schema version`);
  }
  if (!Array.isArray(obj.profiles)) {
    throw new Error('Bundle is missing a "profiles" array');
  }

  const profiles: AgentConfigBundleProfile[] = obj.profiles.map((raw, idx) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`profiles[${idx}] must be an object`);
    }
    const p = raw as Record<string, unknown>;
    if (typeof p.id !== 'string' || p.id.trim() === '') {
      throw new Error(`profiles[${idx}] is missing a non-empty "id"`);
    }
    if (typeof p.label !== 'string' || p.label.trim() === '') {
      throw new Error(`profiles[${idx}] ("${p.id}") is missing a non-empty "label"`);
    }
    return {
      id: p.id,
      label: p.label,
      icon: typeof p.icon === 'string' ? p.icon : '',
      enabled: p.enabled !== false,
      isAgent: p.isAgent !== false,
      isManager: Boolean(p.isManager),
      systemPrompt: typeof p.systemPrompt === 'string' ? p.systemPrompt : null,
      allowedMcpsJson: typeof p.allowedMcpsJson === 'string' ? p.allowedMcpsJson : null,
      allowedSkillsJson: typeof p.allowedSkillsJson === 'string' ? p.allowedSkillsJson : null,
      corePermissionsJson: typeof p.corePermissionsJson === 'string' ? p.corePermissionsJson : null,
      allowedDelegatesJson:
        typeof p.allowedDelegatesJson === 'string' ? p.allowedDelegatesJson : null,
      presetId: typeof p.presetId === 'string' ? p.presetId : null,
      sortOrder: typeof p.sortOrder === 'number' ? p.sortOrder : 0,
      modelProvider: typeof p.modelProvider === 'string' ? p.modelProvider : null,
      modelId: typeof p.modelId === 'string' ? p.modelId : null,
      ocAgent: typeof p.ocAgent === 'string' ? p.ocAgent : null,
      sessionSelectable: p.sessionSelectable !== false,
      modelTierHint: typeof p.modelTierHint === 'string' ? p.modelTierHint : null,
    };
  });

  return { version: obj.version, exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '', profiles };
}

/** True when every field the importer writes is identical to the existing row. */
function isNoopImport(existing: AgentConfig, incoming: AgentConfigBundleProfile): boolean {
  return (
    existing.label === incoming.label &&
    existing.icon === incoming.icon &&
    existing.enabled === incoming.enabled &&
    existing.isAgent === incoming.isAgent &&
    existing.isManager === incoming.isManager &&
    existing.systemPrompt === incoming.systemPrompt &&
    existing.allowedMcpsJson === incoming.allowedMcpsJson &&
    existing.allowedSkillsJson === incoming.allowedSkillsJson &&
    existing.corePermissionsJson === incoming.corePermissionsJson &&
    existing.allowedDelegatesJson === incoming.allowedDelegatesJson &&
    existing.sortOrder === incoming.sortOrder &&
    existing.modelProvider === incoming.modelProvider &&
    existing.modelId === incoming.modelId &&
    existing.ocAgent === incoming.ocAgent &&
    existing.sessionSelectable === incoming.sessionSelectable &&
    existing.modelTierHint === incoming.modelTierHint
  );
}

function toInput(incoming: AgentConfigBundleProfile): AgentConfigInput {
  return {
    id: incoming.id,
    label: incoming.label,
    icon: incoming.icon,
    enabled: incoming.enabled,
    isAgent: incoming.isAgent,
    isManager: incoming.isManager,
    systemPrompt: incoming.systemPrompt,
    allowedMcpsJson: incoming.allowedMcpsJson,
    allowedSkillsJson: incoming.allowedSkillsJson,
    corePermissionsJson: incoming.corePermissionsJson,
    allowedDelegatesJson: incoming.allowedDelegatesJson,
    sortOrder: incoming.sortOrder,
    modelProvider: incoming.modelProvider,
    modelId: incoming.modelId,
    ocAgent: incoming.ocAgent,
    sessionSelectable: incoming.sessionSelectable,
    modelTierHint: incoming.modelTierHint,
  };
}

/**
 * Import a validated bundle: upsert every profile by id, then trigger
 * `syncOpencodeAgentProfiles()` once so imported profiles register with the
 * engine. Never throws for a single-row failure — a bad row is reported with
 * action "error" and the rest of the bundle still imports. Idempotent:
 * re-importing an unmodified bundle reports every row "skipped" and performs
 * no writes.
 */
export async function importAgentConfigBundle(bundle: AgentConfigBundle): Promise<ImportResult[]> {
  const repo = new AgentConfigsRepository();
  const results: ImportResult[] = [];

  for (const incoming of bundle.profiles) {
    try {
      const existing = repo.getById(incoming.id);

      if (existing && existing.presetId !== null) {
        // Preset rows (claude-code/codex/gemini-cli/opencode) are protected
        // the same way the PATCH route protects them — identity fields are
        // never overwritten by an import.
        results.push({
          id: incoming.id,
          label: incoming.label,
          action: 'skipped',
          reason: 'preset profile — identity fields are not importable',
        });
        continue;
      }

      if (existing && isNoopImport(existing, incoming)) {
        results.push({ id: incoming.id, label: incoming.label, action: 'skipped', reason: 'no changes' });
        continue;
      }

      let saved: AgentConfig;
      let action: ImportAction;
      if (existing) {
        saved = repo.update(incoming.id, toInput(incoming))!;
        action = 'updated';
      } else {
        saved = repo.insert(toInput(incoming));
        action = 'created';
      }

      writeAgentProfileFile(saved);
      results.push({ id: saved.id, label: saved.label, action });
    } catch (err) {
      logger.warn(`[AgentConfigImport] failed to import profile "${incoming.id}": ${String(err)}`);
      results.push({
        id: incoming.id,
        label: incoming.label,
        action: 'error',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Trigger once, after every row is written, so the engine picks up any
  // newly-projected agent files in a single pass. Non-fatal on failure —
  // syncOpencodeAgentProfiles never throws (see agent_profile_sync.ts).
  await syncOpencodeAgentProfiles();

  return results;
}
