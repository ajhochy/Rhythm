import Database from 'better-sqlite3';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { resolveRunModel } from './agent_runner';

export interface FrozenEvaluationModel {
  providerID: string;
  modelID: string;
  source: 'profile' | 'scheduled-task' | 'mru' | 'hardcoded-default';
}

const DEFAULT = { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' } as const;
const valid = (providerID: unknown, modelID: unknown): providerID is string =>
  typeof providerID === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(providerID)
  && typeof modelID === 'string' && /^[a-zA-Z0-9._/-]{1,120}$/.test(modelID);

/** Freeze only model identity. No transcript, account, or session identifier is copied. */
export function captureEffectiveEvaluationModel(input: {
  profileId: string | null;
  profileModelProvider: string | null;
  profileModelId: string | null;
  scheduledModelProvider?: string | null;
  scheduledModelId?: string | null;
}, db?: Database.Database): FrozenEvaluationModel {
  if (input.scheduledModelProvider && input.scheduledModelId) {
    if (!valid(input.scheduledModelProvider, input.scheduledModelId)) throw Error('Scheduled evaluation model is malformed');
    return { providerID: input.scheduledModelProvider, modelID: input.scheduledModelId, source: 'scheduled-task' };
  }
  if (input.profileId && input.profileModelProvider && input.profileModelId) {
    if (!valid(input.profileModelProvider, input.profileModelId)) throw Error('Profile evaluation model is malformed');
    if (!db) {
      const actual = resolveRunModel(input.profileId);
      if (actual.providerID !== input.profileModelProvider || actual.modelID !== input.profileModelId)
        throw Error('Profile model changed during evaluation capture');
    }
    return { providerID: input.profileModelProvider, modelID: input.profileModelId, source: 'profile' };
  }
  let mru: { providerID: string; modelID: string } | null = null;
  try {
    mru = db ? (db.prepare(`SELECT provider_id AS providerID, model_id AS modelID FROM agent_sessions
       WHERE provider_id IS NOT NULL AND model_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`)
      .get() as typeof mru) ?? null : new AgentSessionsRepository().findMostRecentlyUsedModel();
  } catch { /* Production resolveRunModel also falls back when the MRU read fails. */ }
  const resolved = mru ?? DEFAULT;
  if (!valid(resolved.providerID, resolved.modelID)) throw Error('Effective evaluation model is malformed');
  if (!db) {
    const actual = resolveRunModel(input.profileId);
    if (actual.providerID !== resolved.providerID || actual.modelID !== resolved.modelID)
      throw Error('Effective model changed during evaluation capture');
  }
  return { ...resolved, source: mru ? 'mru' : 'hardcoded-default' };
}
