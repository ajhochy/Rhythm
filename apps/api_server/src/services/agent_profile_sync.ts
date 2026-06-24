/**
 * Agent Profile Sync — consolidation (#agent-profiles)
 *
 * Mirrors the opencode engine's agent registry into `agent_configs` so every
 * opencode agent (built-in + custom from ~/.config/opencode/agents/*.md) also
 * exists as an Agent Profile. This unifies the three historical "agent"
 * concepts (agentKind / Agent Profile / opencode agent) under one table.
 *
 * Mapping per opencode agent:
 *   id                 = agent.name            (stable; agent_configs.id is the kind string)
 *   label              = Title Case of name    (only on first insert; user edits preserved)
 *   ocAgent            = agent.name            (routing target for the opencode SDK)
 *   sessionSelectable  = mode==='primary' AND not an opencode-internal primary
 *
 * "session selectable" controls visibility in the composer AgentSelectorPill.
 * Subagents (coding-agent, verification-gate, …) and opencode internal
 * primaries (compaction/summary/title) are seeded with sessionSelectable=false
 * so they exist as profiles without cluttering the picker.
 *
 * Local SQLite only — production Postgres has no local opencode engine, so the
 * sync is a no-op there.
 */

import { opencodeClient } from './opencode_engine';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { logger } from '../utils/logger';
import { env } from '../config/env';

/**
 * opencode primaries that drive background machinery, not user-facing sessions.
 * They are valid agents but must never appear in the session agent picker.
 */
const INTERNAL_PRIMARY = new Set(['compaction', 'summary', 'title']);

/** Split an opencode 'provider/model-id' string into [provider, modelId]. */
function parseModel(model?: string | null): [string | null, string | null] {
  if (!model || typeof model !== 'string' || !model.includes('/')) {
    return [null, null];
  }
  const idx = model.indexOf('/');
  return [model.slice(0, idx), model.slice(idx + 1)];
}

/** 'workflow-orchestrator' → 'Workflow Orchestrator'. */
function titleCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Sync opencode agents into agent_configs. Idempotent: existing rows have their
 * ocAgent + sessionSelectable refreshed (so re-runs track engine changes) while
 * user-set label / model / systemPrompt are preserved. Never throws — failures
 * degrade to a logged warning and { synced: 0 }.
 */
export async function syncOpencodeAgentProfiles(
  prefetched?: import('@opencode-ai/sdk').SdkAgent[],
): Promise<{ synced: number }> {
  if (env.dbClient === 'postgres') return { synced: 0 };

  let agents: import('@opencode-ai/sdk').SdkAgent[];
  if (prefetched) {
    // Caller already fetched the registry (e.g. the listAgents controller) —
    // reuse it so we don't double-hit the engine.
    agents = prefetched;
  } else {
    if (!opencodeClient.isReady) return { synced: 0 };
    try {
      agents = await opencodeClient.listAgents();
    } catch (err) {
      logger.warn(`[AgentProfileSync] listAgents failed: ${String(err)}`);
      return { synced: 0 };
    }
  }

  const repo = new AgentConfigsRepository();
  let synced = 0;

  for (const agent of agents) {
    const name = agent.name;
    if (!name) continue;
    const selectable = agent.mode === 'primary' && !INTERNAL_PRIMARY.has(name);

    try {
      // opencode exposes the agent's prompt body + model on the registry entry.
      const a = agent as unknown as {
        prompt?: string | null;
        model?: string | null;
      };
      const prompt = typeof a.prompt === 'string' && a.prompt.trim() !== '' ? a.prompt : null;
      const [modelProvider, modelId] = parseModel(a.model);

      const existing = repo.getById(name);
      if (existing) {
        // Refresh routing + selectability. Backfill prompt/model ONLY when the
        // profile has none yet — never clobber values the user edited in the
        // designer (which is now the source of truth).
        const patch: Parameters<typeof repo.update>[1] = {
          ocAgent: name,
          sessionSelectable: selectable,
        };
        if (!existing.systemPrompt && prompt) patch.systemPrompt = prompt;
        if (!existing.modelProvider && !existing.modelId && modelProvider && modelId) {
          patch.modelProvider = modelProvider;
          patch.modelId = modelId;
        }
        repo.update(name, patch);
      } else {
        repo.insert({
          id: name,
          label: titleCase(name),
          icon: 'assets/agents/opencode.png',
          isAgent: true,
          enabled: true,
          ocAgent: name,
          sessionSelectable: selectable,
          systemPrompt: prompt,
          modelProvider,
          modelId,
          sortOrder: 100,
        });
      }
      synced++;
    } catch (err) {
      logger.warn(`[AgentProfileSync] upsert failed for "${name}": ${String(err)}`);
    }
  }

  logger.info(`[AgentProfileSync] synced ${synced} opencode agent profile(s)`);
  return { synced };
}
