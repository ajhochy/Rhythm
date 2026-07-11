import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { AgentConfigInput } from '../repositories/agent_configs_repository';
import { syncOpencodeAgentProfiles } from '../services/agent_profile_sync';
import {
  writeAgentProfileFile,
  deleteAgentProfileFile,
  isReservedAgentConfigId,
} from '../services/opencode_agent_writer';
import {
  buildAgentConfigExportBundle,
  importAgentConfigBundle,
  parseAgentConfigBundle,
} from '../services/agent_config_export_import';
import { opencodeClient } from '../services/opencode_engine';
import { detectAgentSkillWiringMismatches } from '../services/agent_skill_wiring';
import { logger } from '../utils/logger';

const repo = new AgentConfigsRepository();

/**
 * Agent-profile files are consumed through the engine's infinite-TTL global
 * config cache. Reload it after a successful projection without making the
 * already-persisted profile write depend on engine availability.
 */
async function reloadAgentProfilesBestEffort(): Promise<void> {
  try {
    if (!(await opencodeClient.reloadConfig())) {
      logger.warn('[AgentConfigsController] agent-profile config reload did not complete');
    }
  } catch (err) {
    logger.warn(`[AgentConfigsController] agent-profile config reload failed: ${String(err)}`);
  }
}

/**
 * Parse an `allowed_skills_json` column into the null|string[] shape the #958
 * wiring lint expects. `null`/malformed → null (unrestricted / fail-open).
 */
function parseAllowedSkills(json: string | null): string[] | null {
  if (json === null) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
  } catch {
    return null;
  }
}

// Fields that are forbidden to patch on preset rows. Reduced to identity
// fields now that the legacy CLI fields (canResume/resumeCommand/etc.) are
// no longer persisted or used (#575/#577/#581).
const PRESET_PROTECTED_FIELDS = ['label', 'icon', 'isAgent'];

// #844 — valid values for the per-profile tier hint consumed by
// agent_model_resolver.resolveModelTier() as the `explicitTierHint`.
const VALID_MODEL_TIER_HINTS = new Set(['cheap', 'standard', 'frontier']);
const VALID_CORE_PERMISSION_ACTIONS = new Set(['allow', 'ask', 'deny']);
const AGENT_CONFIG_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function validateCorePermissionsJson(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') {
    throw AppError.badRequest('corePermissionsJson must be a JSON object string or null');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw AppError.badRequest('corePermissionsJson must be valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw AppError.badRequest('corePermissionsJson must be a JSON object');
  }
  for (const [tool, permission] of Object.entries(parsed)) {
    if (!tool.trim()) throw AppError.badRequest('corePermissionsJson tool names must be non-empty');
    if (typeof permission === 'string') {
      if (!VALID_CORE_PERMISSION_ACTIONS.has(permission)) {
        throw AppError.badRequest('corePermissionsJson actions must be allow, ask, or deny');
      }
      continue;
    }
    if (typeof permission !== 'object' || permission === null || Array.isArray(permission)) {
      throw AppError.badRequest('corePermissionsJson values must be action strings or pattern objects');
    }
    for (const [pattern, action] of Object.entries(permission)) {
      if (!pattern.trim() || typeof action !== 'string' || !VALID_CORE_PERMISSION_ACTIONS.has(action)) {
        throw AppError.badRequest('corePermissionsJson pattern actions must be allow, ask, or deny');
      }
    }
  }
}

function validateBody(body: Record<string, unknown>, requireLabel = true): void {
  if (requireLabel) {
    if (!body.label || typeof body.label !== 'string' || body.label.trim() === '') {
      throw AppError.badRequest('label must be a non-empty string');
    }
  } else if (body.label !== undefined) {
    if (typeof body.label !== 'string' || body.label.trim() === '') {
      throw AppError.badRequest('label must be a non-empty string');
    }
  }

  if (
    body.modelTierHint !== undefined &&
    body.modelTierHint !== null &&
    !(typeof body.modelTierHint === 'string' && VALID_MODEL_TIER_HINTS.has(body.modelTierHint))
  ) {
    throw AppError.badRequest(
      `modelTierHint must be one of 'cheap', 'standard', 'frontier', or null`,
    );
  }

  // Task D — profile-level default Anthropic account id (nullable string).
  if (
    body.defaultAnthropicAccountId !== undefined &&
    body.defaultAnthropicAccountId !== null &&
    typeof body.defaultAnthropicAccountId !== 'string'
  ) {
    throw AppError.badRequest('defaultAnthropicAccountId must be a string or null');
  }

  validateCorePermissionsJson(body.corePermissionsJson);

  // Legacy CLI fields (command, canResume, resumeCommand, sessionIdPattern,
  // outputMarker) used to be required here. The Opencode SDK migration
  // dropped them from the data model (#575) and the Flutter client no
  // longer sends them. We accept-and-ignore for backward compatibility
  // with old payloads instead of rejecting outright. The repository layer
  // is the source of truth for what actually gets stored.
}

export class AgentConfigsController {
  list(_req: Request, res: Response, next: NextFunction): void {
    try {
      const configs = repo.list();
      res.json(configs);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /agent-configs/skill-wiring — issue #958 lint surface.
   *
   * Reports every agent whose system-prompt body references a workflow skill
   * that is NOT resolvable for it: absent from its `allowed_skills_json`
   * allowlist, or not an enabled/discovered skill of that exact name. This is
   * the "audit across all agents" the issue's Scope asks for and the read-only
   * verification of its Acceptance ("every skill its body references is present
   * in allowed_skills_json and resolves to an enabled skill of that exact
   * name"). Read-only — never mutates config; remediation is #961.
   */
  async skillWiringLint(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const configs = repo.list();
      let liveSkillNames = new Set<string>();
      const engineAvailable = opencodeClient.isReady;
      if (engineAvailable) {
        try {
          const skills = await opencodeClient.listSkills();
          liveSkillNames = new Set(skills.map((s) => s.name));
        } catch {
          // Engine reported ready but the call failed — treat as unavailable
          // (liveSkillNames stays empty → the not-enabled check is skipped).
        }
      }
      const mismatches = detectAgentSkillWiringMismatches(
        configs.map((c) => ({
          id: c.id,
          label: c.label,
          systemPrompt: c.systemPrompt,
          allowedSkills: parseAllowedSkills(c.allowedSkillsJson),
        })),
        liveSkillNames,
      );
      res.json({
        engineAvailable,
        liveSkillCount: liveSkillNames.size,
        checkedAgents: configs.length,
        mismatchCount: mismatches.length,
        mismatches,
      });
    } catch (err) {
      next(err);
    }
  }

  getOne(req: Request, res: Response, next: NextFunction): void {
    try {
      const config = repo.getById(req.params.id);
      if (!config) throw AppError.notFound('AgentConfig');
      res.json(config);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Regenerates ~/.config/opencode/agents/<ocAgent>.md for an existing
   * profile using the same internal writer normal profile creation/sync
   * uses. Fixes the #900 class of bug (a profile row with no matching agent
   * file) without ever hand-writing frontmatter — used by the Config Doctor
   * agent profile as its non-freehand fix path.
   */
  resyncAgentFile(req: Request, res: Response, next: NextFunction): void {
    try {
      const config = repo.getById(req.params.id);
      if (!config) throw AppError.notFound('AgentConfig');
      writeAgentProfileFile(config);
      res.json(config);
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown>;
      validateBody(body, true);
      let id: string | undefined;
      if (body.id !== undefined) {
        if (typeof body.id !== 'string' || !AGENT_CONFIG_ID_RE.test(body.id)) {
          throw AppError.badRequest('id must be a slug matching ^[a-z0-9]+(-[a-z0-9]+)*$');
        }
        if (repo.getById(body.id)) {
          throw AppError.conflict(`AgentConfig id "${body.id}" already exists`);
        }
        if (isReservedAgentConfigId(body.id)) {
          throw AppError.badRequest(`id "${body.id}" is reserved`);
        }
        id = body.id;
      }

      const input: AgentConfigInput = {
        id,
        label: (body.label as string).trim(),
        icon: typeof body.icon === 'string' ? body.icon : '',
        // Legacy CLI fields (#581) — accept-and-ignore. The repository
        // writes empty/null values for the underlying columns regardless.
        command: typeof body.command === 'string' ? body.command.trim() : '',
        enabled: body.enabled !== false,
        isAgent: body.isAgent !== false,
        isManager: Boolean(body.isManager),
        systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : null,
        allowedMcpsJson: typeof body.allowedMcpsJson === 'string' ? body.allowedMcpsJson : null,
        allowedSkillsJson: typeof body.allowedSkillsJson === 'string' ? body.allowedSkillsJson : null,
        corePermissionsJson: typeof body.corePermissionsJson === 'string' ? body.corePermissionsJson : null,
        allowedDelegatesJson: typeof body.allowedDelegatesJson === 'string' ? body.allowedDelegatesJson : null,
        modelProvider: typeof body.modelProvider === 'string' ? body.modelProvider : null,
        modelId: typeof body.modelId === 'string' ? body.modelId : null,
        ocAgent: typeof body.ocAgent === 'string' ? body.ocAgent : null,
        sessionSelectable: body.sessionSelectable !== false,
        modelTierHint: typeof body.modelTierHint === 'string' ? body.modelTierHint : null,
        defaultAnthropicAccountId:
          typeof body.defaultAnthropicAccountId === 'string' ? body.defaultAnthropicAccountId : null,
        canResume: false,
        resumeCommand: null,
        sessionIdPattern: null,
        outputMarker: null,
        presetId: null,
      };

      const config = repo.insert(input);
      // Project the profile out to an opencode agent file (profile = source of
      // truth). No-op for CLI presets / opencode built-ins. Non-fatal.
      writeAgentProfileFile(config);
      await reloadAgentProfilesBestEffort();
      res.status(201).json(config);
    } catch (err) {
      next(err);
    }
  }

  async patch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const existing = repo.getById(req.params.id);
      if (!existing) throw AppError.notFound('AgentConfig');

      const body = req.body as Record<string, unknown>;

      // Preset rows: only allow patching enabled and command
      if (existing.presetId !== null) {
        const suppliedFields = Object.keys(body);
        const forbidden = suppliedFields.filter((f) => PRESET_PROTECTED_FIELDS.includes(f));
        if (forbidden.length > 0) {
          throw AppError.badRequest(
            `Preset configs may only update "enabled" and "command". Forbidden fields: ${forbidden.join(', ')}`,
          );
        }
      }

      // Validate the patch body (don't require label/command presence, but validate if provided)
      validateBody(body, false);

      const patch: Partial<AgentConfigInput> = {};
      if (body.label !== undefined) patch.label = (body.label as string).trim();
      if (body.icon !== undefined) patch.icon = body.icon as string;
      if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
      if (body.isAgent !== undefined) patch.isAgent = Boolean(body.isAgent);
      if (body.isManager !== undefined) patch.isManager = Boolean(body.isManager);
      if (body.systemPrompt !== undefined) patch.systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt : null;
      if (body.allowedMcpsJson !== undefined) patch.allowedMcpsJson = typeof body.allowedMcpsJson === 'string' ? body.allowedMcpsJson : null;
      if (body.allowedSkillsJson !== undefined) patch.allowedSkillsJson = typeof body.allowedSkillsJson === 'string' ? body.allowedSkillsJson : null;
      if (body.corePermissionsJson !== undefined) patch.corePermissionsJson = typeof body.corePermissionsJson === 'string' ? body.corePermissionsJson : null;
      if (body.allowedDelegatesJson !== undefined) patch.allowedDelegatesJson = typeof body.allowedDelegatesJson === 'string' ? body.allowedDelegatesJson : null;
      if (body.modelProvider !== undefined) patch.modelProvider = typeof body.modelProvider === 'string' ? body.modelProvider : null;
      if (body.modelId !== undefined) patch.modelId = typeof body.modelId === 'string' ? body.modelId : null;
      if (body.ocAgent !== undefined) patch.ocAgent = typeof body.ocAgent === 'string' ? body.ocAgent : null;
      if (body.sessionSelectable !== undefined) patch.sessionSelectable = Boolean(body.sessionSelectable);
      if (body.modelTierHint !== undefined) patch.modelTierHint = typeof body.modelTierHint === 'string' ? body.modelTierHint : null;
      if (body.defaultAnthropicAccountId !== undefined) patch.defaultAnthropicAccountId = typeof body.defaultAnthropicAccountId === 'string' ? body.defaultAnthropicAccountId : null;
      // Legacy CLI fields (#581) — accept on the wire for back-compat
      // with old payloads but never propagate to the repository layer.

      const updated = repo.update(req.params.id, patch);
      if (!updated) throw AppError.notFound('AgentConfig');
      // Re-project the updated profile to its opencode agent file. Non-fatal.
      writeAgentProfileFile(updated);
      // The engine caches agent profiles (including task permission rules) for
      // its lifetime (#1015, #1014). Best-effort reload covers every edit —
      // system prompt, scope, model, AND the delegate roster — so the next
      // task call in an existing session sees the newly persisted allowlist.
      await reloadAgentProfilesBestEffort();
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /agent-configs/sync-opencode — mirror the opencode engine's agent
   * registry into agent_configs (idempotent). Returns the count synced.
   */
  async syncOpencode(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await syncOpencodeAgentProfiles();
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /agent-configs/export[?ids=a,b,c] — a versioned, portable bundle of
   * agent profiles. Omitting `ids` exports every profile. Never includes
   * secret values (see agent_config_export_import.ts module doc); a bundle
   * that somehow would is rejected with a 500 rather than shipped.
   */
  export(req: Request, res: Response, next: NextFunction): void {
    try {
      const idsParam = req.query.ids;
      const ids =
        typeof idsParam === 'string' && idsParam.trim() !== ''
          ? idsParam.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined;
      const bundle = buildAgentConfigExportBundle(ids);
      res.json(bundle);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /agent-configs/import — validates the bundle version/shape, upserts
   * each profile by id (preset rows are skipped, never overwritten), triggers
   * `syncOpencodeAgentProfiles()` once so imported profiles register with the
   * engine, and returns a per-profile created/updated/skipped/error result.
   */
  async import(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown>;
      const bundle = parseAgentConfigBundle(body.bundle ?? body);
      const results = await importAgentConfigBundle(bundle);
      res.json({ results });
    } catch (err) {
      if (err instanceof Error) {
        next(AppError.badRequest(err.message));
        return;
      }
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const existing = repo.getById(req.params.id);
      if (!existing) throw AppError.notFound('AgentConfig');

      if (existing.presetId !== null) {
        throw AppError.badRequest('Preset configs cannot be deleted');
      }

      const deleted = repo.remove(req.params.id);
      if (!deleted) throw AppError.notFound('AgentConfig');
      // Remove the projected opencode agent file. Non-fatal.
      deleteAgentProfileFile(req.params.id);
      await reloadAgentProfilesBestEffort();
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
}
