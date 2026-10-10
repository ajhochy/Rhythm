import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { getUsageBudget, subscribeUsageBudgetRefresh, type UsageBudgetSnapshot } from '../usage_budget_service';
import { isAutoAccountSession, markAutoAccountSession, primeUsageCache, unmarkAutoAccountSession } from './capacity_router';
import { recordDecision } from './decision_log';
import { getRoutableModels } from './model_catalog';
import { classifyRouterGrid } from './router_grid_classifier';
import { RouterGridAttemptsRepository } from './router_grid_attempts_repository';
import { loadRouterGridConfig, type ClosedProvider } from './router_grid_config';
import { RouterGridExhaustionStore } from './router_grid_exhaustion';
import { accountsFromSnapshot, selectRoute } from './router_grid_select';
import type { OpenAIDecisionsClient } from './openai_decisions_client';
import type { RouteTurnForSessionInput, RouteTurnForSessionResult } from './turn_routing';
import { loadDecisionSettings } from './decision_settings';
import { assertFreeRuntimeReady, checkFreeMode, FREE_HOLD_MESSAGE, FREE_RELEASE_MESSAGE, holdForFreeMode, releaseFreeQueue } from './router_free_runtime';
import { drainHeldTurn, HELD_CLAIM_STALE_MS, HeldTurnsRepository, type DrainDeps } from './router_free_held_turns';

const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export function gridEffortVariant(requested: string | null, variants: readonly string[]): string | undefined {
  if (!requested) return undefined;
  const supported = efforts.filter(e => variants.includes(e));
  return supported.filter(e => efforts.indexOf(e) <= efforts.indexOf(requested)).at(-1) ?? supported[0];
}

export function gridRunnerEligible(profileId: string | null | undefined, modelOverride: unknown, taskKind: unknown): boolean {
  return !modelOverride && !taskKind && (!profileId || loadRouterGridConfig().agent_auto_profiles.includes(profileId));
}

/** Account writes use the existing setters and routing map; explicit account choices never move. */
export async function applyGridAccount(sessionId: string, provider: string, accountId: string | null): Promise<void> {
  if (!accountId || (provider !== 'anthropic' && provider !== 'openai')) return;
  const repo = new AgentSessionsRepository();
  const row = repo.findById(sessionId);
  if (!row) return;
  const current = provider === 'anthropic' ? row.anthropicAccountId : row.openaiAccountId;
  const source = provider === 'anthropic' ? row.anthropicAccountSource : row.openaiAccountSource;
  if (current && source !== 'router') unmarkAutoAccountSession(sessionId, provider); // clear stale process marker
  const automatic = !current || source === 'router';
  if (current && !automatic && current !== accountId) throw new Error('grid_account_pinned');
  const service = provider === 'anthropic'
    ? (await import('../anthropic_accounts_service')).anthropicAccountsService
    : (await import('../openai_accounts_service')).openaiAccountsService;
  if (!service.getAccount(accountId)) throw new Error('grid_account_unavailable');
  if (!current || automatic) {
    markAutoAccountSession(sessionId, provider);
    if (provider === 'anthropic') { repo.setAnthropicAccountId(sessionId, accountId); repo.setAnthropicAccountSource(sessionId, 'router'); }
    else { repo.setOpenaiAccountId(sessionId, accountId); repo.setOpenaiAccountSource(sessionId, 'router'); }
  }
  if (row.sdkSessionId) await service.setRouting(row.sdkSessionId, accountId, { pinned: !automatic });
}

let freeRelease: Promise<unknown> | null = null;
async function notifyFreeSession(sessionId: string, message: string): Promise<void> {
  new AgentSessionsRepository().updatePreview(sessionId, message, new Date().toISOString());
  const { broadcast } = await import('../ws_gateway');
  broadcast({ v: 1, type: 'session.free_mode_released', sessionId });
}
const drainDeps: DrainDeps = {
  holdMessage: FREE_HOLD_MESSAGE,
  remoteConsent: () => loadDecisionSettings().remoteDataConsent,
  notify: notifyFreeSession,
  /** Same server-side entrypoint as POST /agent-sessions/:id/prompt: handleInputFrame + error-frame shim. */
  async dispatch(turn) {
    const { handleInputFrame } = await import('../ws_gateway');
    const session = new AgentSessionsRepository().findById(turn.sessionId);
    const errors: string[] = [];
    const shim = { send(raw: string) {
      try { const f = JSON.parse(raw) as { type?: string; message?: unknown }; if (f.type === 'error' && typeof f.message === 'string') errors.push(f.message); }
      catch { errors.push('unparseable_gateway_frame'); }
    } };
    const o = turn.options;
    const parts = turn.origin !== 'mobile' && Array.isArray(o.parts) && o.parts.length > 0 ? o.parts : undefined;
    await handleInputFrame(shim as unknown as Parameters<typeof handleInputFrame>[0], { type: 'session.input', id: turn.sessionId,
      ...(parts ? { parts } : { data: turn.inputText }),
      ...(o.modelOverride ? { modelOverride: o.modelOverride } : {}), ...(o.thinking ? { thinking: o.thinking } : {}),
      ...(typeof o.fastMode === 'boolean' ? { fastMode: o.fastMode } : {}), ...(typeof o.agent === 'string' ? { agent: o.agent } : {}) },
    { agent: session?.profileId ?? undefined, origin: 'prompt_api' });
    return errors;
  },
};
/** F2 release, single flight: stale claims surfaced, sessions drained exactly once, scheduled tasks re-run fresh. */
function startFreeRelease(config: ReturnType<typeof loadRouterGridConfig>): void {
  if (freeRelease) return;
  freeRelease = (async () => {
    const held = new HeldTurnsRepository();
    for (const t of await held.surfaceStaleClaims(new Date(Date.now() - HELD_CLAIM_STALE_MS).toISOString()))
      await notifyFreeSession(t.sessionId, 'A held request could not be confirmed as sent. Check the conversation and resend it if needed.').catch(() => undefined);
    const result = await releaseFreeQueue(config, {
      async currentOwner(reference) {
        const [kind, id] = [reference.slice(0, reference.indexOf(':')), reference.slice(reference.indexOf(':') + 1)];
        if (kind === 'session') {
          const s = new AgentSessionsRepository().findById(id);
          return !s || s.archivedAt || s.status === 'closed' ? undefined : s.ownerUserId ?? null;
        }
        if (kind !== 'scheduled') return undefined;
        const { AgentScheduledTasksRepository } = await import('../../repositories/agent_scheduled_tasks_repository');
        const task = await new AgentScheduledTasksRepository().findByIdAsync(id);
        return !task || !task.enabled ? undefined : task.createdByUserId ?? null;
      },
      async release(reference) {
        const id = reference.slice(reference.indexOf(':') + 1);
        if (reference.startsWith('scheduled:')) {
          const { AgentScheduledTasksRepository } = await import('../../repositories/agent_scheduled_tasks_repository');
          await new AgentScheduledTasksRepository().advanceDeferredRunAsync(id, new Date().toISOString());
          return;
        }
        if (!reference.startsWith('session:')) return;
        // No held-turn record (held before D2 existed): notify-and-resend fallback.
        if ((await drainHeldTurn(id, drainDeps)).kind === 'none') await notifyFreeSession(id, FREE_RELEASE_MESSAGE);
      },
    });
    // Dropped entries (target gone or owner changed): resolve their held turn as not sent, never dispatch.
    for (const taskId of result.dropped) if (taskId.startsWith('session:'))
      await drainHeldTurn(taskId.slice('session:'.length), drainDeps, held, 'descriptor_dropped').catch(() => undefined);
    return result;
  })().catch(() => undefined).finally(() => { freeRelease = null; });
}
export async function waitForFreeReleaseForTests(): Promise<void> { await freeRelease; }
/** A genuinely fresh paid-capacity snapshot releases an idle queue; no new routing turn or daemon. */
export async function onFreshUsageBudgetForFreeRelease(snapshot: UsageBudgetSnapshot): Promise<void> {
  const config = loadRouterGridConfig(); if (config.free_mode.enabled !== true) return;
  const fetched = Date.parse(snapshot.fetchedAt); if (!snapshot.providers.length || !Number.isFinite(fetched) || Date.now() - fetched > 15 * 60_000) return;
  const exhaustion = new RouterGridExhaustionStore().list();
  const state = checkFreeMode({ config, accounts: accountsFromSnapshot(snapshot, exhaustion), usageFresh: true,
    openrouterUsable: false, tier: 1, now: Date.now() });
  if (state.recovered) { startFreeRelease(config); await freeRelease; }
}
let freeRecoveryInitialized = false;
export function initializeRouterFreeRecovery(): void {
  if (freeRecoveryInitialized) return;
  freeRecoveryInitialized = true;
  subscribeUsageBudgetRefresh(snapshot => onFreshUsageBudgetForFreeRelease(snapshot));
}

const shadowStarted = new Set<string>();
const shadowJobs = new Set<Promise<unknown>>();
export async function waitForGridShadowForTests(): Promise<void> { await Promise.all([...shadowJobs]); }

/** Grid owns its whole turn; never lets the legacy router/capacity layer replace its pick. */
export async function routeGridTurn(input: RouteTurnForSessionInput, mode: 'on' | 'shadow'): Promise<RouteTurnForSessionResult> {
  const baseline: RouteTurnForSessionResult = { route: input.baseRoute, source: 'baseline', applied: false,
    requestedSource: input.requestedSource, requestedTier: input.requestedTier ?? null };
  const row = input.sessionRow;
  if (!input.sessionAuto || row?.modelMode === 'fixed' || !['auto', 'agent_default'].includes(input.requestedSource)) return baseline;
  const evaluate = async (): Promise<RouteTurnForSessionResult> => {
    try {
      const attempts = new RouterGridAttemptsRepository();
      const saved = row?.routerDecidedAt ? await attempts.readState(input.sessionId) : null;
      const matching = !!row?.routerDecidedAt && (!saved || saved.model === `${row.providerId}/${row.modelId}`) &&
        `${row.providerId}/${row.modelId}` === `${input.baseRoute?.providerID}/${input.baseRoute?.modelID}`;
      // A stored model changed after the applied receipt: durable evidence is stale, preserve the explicit baseline.
      if (row?.routerDecidedAt && saved && saved.model !== `${row.providerId}/${row.modelId}`) return baseline;
      const sessionSource = (provider: ClosedProvider) => provider === 'anthropic' ? row?.anthropicAccountSource : row?.openaiAccountSource;
      // Authoritative session provenance: NULL is unknown and never upgraded from legacy attempts.
      const automatic = (provider: ClosedProvider): boolean => sessionSource(provider) === 'router';
      for (const provider of ['anthropic', 'openai'] as const) if (automatic(provider)) markAutoAccountSession(input.sessionId, provider);
      const exhaustion = new RouterGridExhaustionStore().list();
      const account = row?.providerId === 'anthropic' ? row.anthropicAccountId : row?.providerId === 'openai' ? row.openaiAccountId : null;
      const reroute = matching && (row?.providerId === 'anthropic' || row?.providerId === 'openai') &&
        automatic(row.providerId) && exhaustion.some(e => e.provider === row.providerId && e.accountId === account);
      // If durable classification is unavailable, preserve
      // carryover but never invent a fresh classification for an exhausted session.
      if (matching && (!reroute || !saved)) return { ...baseline, ...(row?.routerVariant ? { variant: row.routerVariant } : {}) };
      const config = loadRouterGridConfig();
      const free = mode === 'on' && config.free_mode.enabled === true;
      if (free) assertFreeRuntimeReady(config);
      // Free-held turn resent after release: reuse its stored classification (never re-sent while consent is revoked).
      const held = free && !saved && !row?.routerDecidedAt ? await attempts.readFreeQueued(input.sessionId) : null;
      const reuseHeld = held && (held.source === 'rules' || loadDecisionSettings().remoteDataConsent) ? held : null;
      const now = Date.now();
      const snapshot = await getUsageBudget({ cachedOnly: true });
      const fresh = !!snapshot?.providers.length && Number.isFinite(Date.parse(snapshot.fetchedAt)) && now - Date.parse(snapshot.fetchedAt) <= 15 * 60_000;
      if (!fresh) primeUsageCache();
      const accounts = snapshot ? accountsFromSnapshot(snapshot, exhaustion) : [];
      if (!fresh) accounts.forEach(a => { a.quotaRemainingPct = null; });
      {
        // Supplement unavailable/missing usage from healthy local inventory; never probe inline.
        const { anthropicAccountsService } = await import('../anthropic_accounts_service');
        const { openaiAccountsService } = await import('../openai_accounts_service');
        for (const [provider, service] of [['anthropic', anthropicAccountsService], ['openai', openaiAccountsService]] as const) {
          for (const a of service.listRedacted().accounts) {
            if (a.status !== 'ok' || accounts.some(existing => existing.provider === provider && existing.id === a.id)) continue;
            accounts.push({ provider, id: a.id, quotaRemainingPct: null, resetsAt: null,
              exhaustedUntil: exhaustion.find(e => e.provider === provider && e.accountId === a.id)?.exhaustedUntil ?? null });
          }
        }
      }
      // Local inventory/freshness is a trust boundary: fail before any classifier/provider HTTP.
      const classification = saved && reroute ? saved.classification : reuseHeld ?? await classifyRouterGrid(input.prompt, config, input.gridClient);
      const pinned = (provider: ClosedProvider) => {
        const id = provider === 'anthropic' ? row?.anthropicAccountId : row?.openaiAccountId;
        return id && !automatic(provider) ? id : null;
      };
      const catalog = await getRoutableModels({ agentId: input.agentId, baseRoute: input.baseRoute });
      const availableModels = new Set(catalog.source === 'live' ? catalog.models.map(m => `${m.providerID}/${m.modelID}`) : []);
      const { opencodeClient } = await import('../opencode_engine');
      const authed = new Set(await opencodeClient.listAuthedProviders());
      const knownEmpty = snapshot?.providers.some(p => p.provider === 'openrouter' && p.kind === 'credits' &&
        p.items.some(i => i.remainingFraction !== null && i.remainingFraction <= 0));
      // Free Mode budget 0 = no paid OpenRouter fallback spending at all.
      const openrouterUsable = !classification.securitySensitive && authed.has('openrouter') && !knownEmpty &&
        !(free && config.free_mode.paid_openrouter_budget_usd <= 0);
      const result = selectRoute({ config, classification, accounts: accounts.filter(a => !pinned(a.provider) || a.id === pinned(a.provider)),
        availableModels, openrouterUsable, now,
        // No configured pricing timezone in v1: conservatively move peak-priced models last on weekdays.
        weekdayPeak: new Date(now).getUTCDay() > 0 && new Date(now).getUTCDay() < 6 });
      const model = result.kind === 'route' ? catalog.models.find(m => `${m.providerID}/${m.modelID}` === result.model) : undefined;
      const variant = result.kind === 'route' ? gridEffortVariant(result.effort, model?.variants ?? []) : undefined;
      const accountSource = result.kind === 'route' && result.provider !== 'openrouter' && pinned(result.provider) ? 'pinned' : 'router';
      if (free) {
        const state = checkFreeMode({ config, accounts, usageFresh: fresh, openrouterUsable, tier: classification.tier, now });
        if (state.recovered) startFreeRelease(config);
        if (state.active && result.kind === 'none') {
          const reference = row?.scheduledTaskId ? `scheduled:${row.scheduledTaskId}` : `session:${input.sessionId}`;
          const hold = holdForFreeMode({ config, taskId: reference, ownerUserId: row?.ownerUserId ?? null, reference, classification, now });
          await attempts.append(input.sessionId, classification, { kind: 'free_queued', model: null, provider: null,
            effortRequested: null, effortApplied: null, accountId: null, accountSource: 'router', tierUsed: null,
            reason: 'free_mode_queued', degraded: false, applied: false, trace: result.trace });
          recordDecision({ feature: 'model_routing', mode, sessionId: input.sessionId, status: 'ok', applied: false, chosen: null,
            query: input.prompt, detail: { engine: 'grid', kind: 'free_queued', reason: 'free_mode_queued', tier: classification.tier,
              classifierSource: classification.source, freeTrace: state.trace, durable: hold.durable } });
          return { ...baseline, held: hold };
        }
      }
      const attemptResult = {
        kind: mode === 'shadow' ? 'shadow' : result.kind,
        model: result.kind === 'route' ? result.model : null,
        provider: result.kind === 'route' ? result.provider : null,
        effortRequested: result.kind === 'route' ? result.effort : null, effortApplied: variant ?? null,
        accountId: result.kind === 'route' ? result.accountId : null, accountSource,
        tierUsed: result.kind === 'route' ? result.tierUsed : null,
        reason: reroute ? 'account_exhausted' : result.kind === 'none' ? result.reason : classification.reason,
        degraded: result.kind === 'route' && result.degraded, applied: false, trace: result.trace,
      } as const;
      // Journal the intended route before side effects, but never authorize restart reconstruction yet.
      await attempts.append(input.sessionId, classification, attemptResult);
      if (mode === 'on' && result.kind === 'route') {
        await applyGridAccount(input.sessionId, result.provider, result.accountId);
        if (row) new AgentSessionsRepository().setRouterDecision(input.sessionId, {
          providerId: result.provider, modelId: result.model.slice(result.provider.length + 1), variant: variant ?? null, decidedAt: new Date(now).toISOString(),
        });
        // Only actual account + session success creates an applied authorization receipt.
        await attempts.append(input.sessionId, classification, { ...attemptResult, applied: true });
      }
      recordDecision({ feature: 'model_routing', mode, sessionId: input.sessionId, status: 'ok',
        applied: mode === 'on' && result.kind === 'route', chosen: result.kind === 'route' ? result.model : null,
        query: input.prompt, detail: { engine: 'grid', ...classification, classifierSource: classification.source,
          classifierReason: classification.reason, reason: attemptResult.reason, kind: result.kind,
          tierUsed: result.kind === 'route' ? result.tierUsed : null, model: result.kind === 'route' ? result.model : null,
          effortRequested: result.kind === 'route' ? result.effort : null, effortApplied: variant ?? null,
          provider: result.kind === 'route' ? result.provider : null, accountId: result.kind === 'route' ? result.accountId : null,
          accountSource, degraded: result.kind === 'route' && result.degraded, trace: result.trace } });
      if (mode === 'shadow' || result.kind === 'none') return baseline;
      if (result.degraded) {
        const { broadcast } = await import('../ws_gateway');
        broadcast({ v: 1, type: 'session.spillover', sessionId: input.sessionId, fromAccountId: account ?? null,
          toAccountId: result.accountId, toProvider: result.provider, toModel: model?.modelID, reason: 'degraded_fallback' });
      }
      return { ...baseline, route: { providerID: result.provider, modelID: result.model.slice(result.provider.length + 1) },
        applied: true, source: 'router', ...(variant ? { variant } : {}), gridAccountId: result.accountId };
    } catch (error) {
      if (mode !== 'on') return baseline; // shadow remains deliberately non-blocking
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      try { recordDecision({ feature: 'model_routing', mode, sessionId: input.sessionId, status: 'error', applied: false,
        chosen: null, query: '', detail: { engine: 'grid', kind: 'router_state_unavailable', errorName } }); } catch { /* fail closed even when diagnostics storage failed */ }
      return { ...baseline, held: { reason: 'router_state_unavailable',
        message: 'Routing state is unavailable. This request was not sent.', durable: false } };
    }
  };
  if (mode === 'on') return evaluate();
  if (!shadowStarted.has(input.sessionId)) {
    shadowStarted.add(input.sessionId);
    const job = evaluate(); shadowJobs.add(job); void job.finally(() => shadowJobs.delete(job));
  }
  return baseline;
}
