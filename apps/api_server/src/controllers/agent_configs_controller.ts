import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AppError } from '../errors/app_error';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { AgentConfigInput } from '../repositories/agent_configs_repository';
import { syncOpencodeAgentProfiles } from '../services/agent_profile_sync';
import {
  writeAgentProfileFile,
  deleteAgentProfileFile,
  syncAgentProfileFileForState,
  isReservedAgentConfigId,
} from '../services/opencode_agent_writer';
import {
  buildAgentConfigExportBundle,
  importAgentConfigBundle,
  parseAgentConfigBundle,
} from '../services/agent_config_export_import';
import { opencodeClient } from '../services/opencode_engine';
import { detectAgentSkillWiringMismatches } from '../services/agent_skill_wiring';
import { broadcastAgentConfigsChanged } from '../services/ws_gateway';
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
const SECURITY_STATE_FIELDS = new Set([
  'locked',
  'disabledReason',
  'lockedAt',
  'lockedBy',
]);

function requiredTrimmedText(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw AppError.badRequest(`${field} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw AppError.badRequest(`${field} must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

function assertSecurityTransitionAuthorized(req: Request): void {
  // The local agent server is loopback-only and intentionally has no user
  // auth. Any networked/non-local deployment must use a real admin/system
  // identity for these exceptional transitions.
  if (env.agentLocal) return;
  const actor = req.auth?.user;
  if (!actor) throw AppError.unauthorized('Authentication required');
  if (actor.role !== 'admin' && actor.role !== 'system') {
    throw AppError.forbidden('Only admins can change an agent security lock');
  }
}

function auditedActor(
  req: Request,
  body: Record<string, unknown>,
  localField: string,
): string {
  return env.agentLocal
    ? requiredTrimmedText(body, localField, 320)
    : req.auth!.user.email;
}

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

  // #1118 — per-profile reasoning-effort value. Free-form (provider-specific
  // effort tiers differ, e.g. Anthropic's low/medium/high/xhigh/max vs
  // OpenAI's minimal/low/medium/high) — validated as a non-empty string or
  // null rather than a fixed enum, matching modelProvider/modelId/ocAgent.
  if (
    body.reasoningEffort !== undefined &&
    body.reasoningEffort !== null &&
    !(typeof body.reasoningEffort === 'string' && body.reasoningEffort.trim() !== '')
  ) {
    throw AppError.badRequest('reasoningEffort must be a non-empty string or null');
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
      const result = writeAgentProfileFile(config);
      // A blocked or failed write leaves the file stale. Reporting 200 here made
      // that indistinguishable from a successful resync — the exact confusion
      // this endpoint exists to resolve. The scanned content is never echoed
      // back; only the fact that it was rejected.
      if (result === 'blocked') {
        throw AppError.badRequest(
          `Agent file for "${config.id}" was not written: its system prompt was rejected by the ` +
            `content scanner. Edit the system prompt and resync again.`,
        );
      }
      if (result === 'failed') {
        throw AppError.internal(`Agent file for "${config.id}" could not be written. See server logs.`);
      }
      broadcastAgentConfigsChanged();
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
        // #1088 — explicit schedulability override, independent of picker
        // visibility. Omitted/undefined → repository stores NULL (inherit
        // sessionSelectable); explicit boolean → stored override.
        schedulable: typeof body.schedulable === 'boolean' ? body.schedulable : null,
        // #1094 — OpenAI native image_generation capability grant.
        imageGenerationEnabled: Boolean(body.imageGenerationEnabled),
        modelTierHint: typeof body.modelTierHint === 'string' ? body.modelTierHint : null,
        defaultAnthropicAccountId:
          typeof body.defaultAnthropicAccountId === 'string' ? body.defaultAnthropicAccountId : null,
        // #1118 — per-profile reasoning effort. Null = provider default.
        reasoningEffort: typeof body.reasoningEffort === 'string' ? body.reasoningEffort : null,
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
      broadcastAgentConfigsChanged();
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
      const suppliedSecurityFields = Object.keys(body).filter((field) =>
        SECURITY_STATE_FIELDS.has(field),
      );
      if (suppliedSecurityFields.length > 0) {
        throw AppError.badRequest(
          `Security lock fields can only be changed through the dedicated reviewed transition: ${suppliedSecurityFields.join(', ')}`,
        );
      }
      if (existing.locked === true && body.enabled !== undefined && Boolean(body.enabled)) {
        throw AppError.conflict(
          'This agent is security-locked and cannot be re-enabled with the generic PATCH; use the reviewed-reenable transition',
        );
      }

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
      // #1088 — `schedulable: null` explicitly clears the override back to
      // "inherit sessionSelectable"; a boolean sets an explicit override.
      if (body.schedulable !== undefined) {
        patch.schedulable = body.schedulable === null ? null : Boolean(body.schedulable);
      }
      if (body.imageGenerationEnabled !== undefined) patch.imageGenerationEnabled = Boolean(body.imageGenerationEnabled);
      if (body.modelTierHint !== undefined) patch.modelTierHint = typeof body.modelTierHint === 'string' ? body.modelTierHint : null;
      if (body.defaultAnthropicAccountId !== undefined) patch.defaultAnthropicAccountId = typeof body.defaultAnthropicAccountId === 'string' ? body.defaultAnthropicAccountId : null;
      // #1118 — `reasoningEffort: null` explicitly clears back to provider default.
      if (body.reasoningEffort !== undefined) patch.reasoningEffort = typeof body.reasoningEffort === 'string' ? body.reasoningEffort : null;
      // Legacy CLI fields (#581) — accept on the wire for back-compat
      // with old payloads but never propagate to the repository layer.

      const updated = repo.update(req.params.id, patch);
      if (!updated) throw AppError.notFound('AgentConfig');
      // Re-project the updated profile to its opencode agent file — or delete
      // it when the profile just became disabled (#1135: a disabled profile's
      // stale .md must not remain live/loadable by the engine). Non-fatal.
      syncAgentProfileFileForState(updated);
      // The engine caches agent profiles (including task permission rules) for
      // its lifetime (#1015, #1014). Best-effort reload covers every edit —
      // system prompt, scope, model, AND the delegate roster — so the next
      // task call in an existing session sees the newly persisted allowlist.
      await reloadAgentProfilesBestEffort();
      broadcastAgentConfigsChanged();
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }

  /**
   * #1135 — exceptional, auditable security disable. This is intentionally
   * separate from the ordinary PATCH enabled toggle.
   */
  async securityLock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      assertSecurityTransitionAuthorized(req);
      const existing = repo.getById(req.params.id);
      if (!existing) throw AppError.notFound('AgentConfig');
      if (existing.locked === true) {
        throw AppError.conflict('AgentConfig is already security-locked');
      }
      const body = req.body as Record<string, unknown>;
      const reason = requiredTrimmedText(body, 'reason', 2_000);
      const updated = repo.lockForSecurity(
        req.params.id,
        reason,
        auditedActor(req, body, 'actor'),
      );
      if (!updated) {
        throw AppError.conflict('AgentConfig lock state changed; reload and retry');
      }
      syncAgentProfileFileForState(updated);
      await reloadAgentProfilesBestEffort();
      broadcastAgentConfigsChanged();
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }

  /**
   * #1135 — reviewed re-enable with optimistic concurrency. A reviewer must
   * acknowledge the exact reason + lock timestamp currently persisted; stale
   * review payloads cannot unlock a newer security finding.
   */
  async reviewedReenable(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      assertSecurityTransitionAuthorized(req);
      const existing = repo.getById(req.params.id);
      if (!existing) throw AppError.notFound('AgentConfig');
      if (existing.locked !== true) {
        throw AppError.conflict('AgentConfig is not security-locked');
      }
      const body = req.body as Record<string, unknown>;
      const expectedLockedAt = requiredTrimmedText(body, 'expectedLockedAt', 100);
      const expectedDisabledReason = requiredTrimmedText(
        body,
        'expectedDisabledReason',
        2_000,
      );
      const reviewNote = requiredTrimmedText(body, 'reviewNote', 4_000);
      const updated = repo.reviewedReenable(req.params.id, {
        expectedLockedAt,
        expectedDisabledReason,
        reviewedBy: auditedActor(req, body, 'reviewedBy'),
        reviewNote,
      });
      if (!updated) {
        throw AppError.conflict(
          'AgentConfig lock state does not match the reviewed reason/version; reload and review the current lock',
        );
      }
      syncAgentProfileFileForState(updated);
      await reloadAgentProfilesBestEffort();
      broadcastAgentConfigsChanged();
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }

  securityEvents(req: Request, res: Response, next: NextFunction): void {
    try {
      assertSecurityTransitionAuthorized(req);
      const existing = repo.getById(req.params.id);
      if (!existing) throw AppError.notFound('AgentConfig');
      res.json({ events: repo.listSecurityEvents(req.params.id) });
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
      broadcastAgentConfigsChanged();
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
}
