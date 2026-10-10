import { getUsageBudget } from '../usage_budget_service';
import { accountsFromSnapshot } from './router_grid_select';
import { RouterGridExhaustionStore } from './router_grid_exhaustion';

/** Status-less plugin reports require positive fresh quota evidence, never just rate_limited. */
export async function markGridSpillover(body: Record<string, unknown>, provider: string, fromAccountId: string | null): Promise<void> {
  const status = body.status ?? body.statusCode ?? body.httpStatus;
  if ((status != null && Number(status) !== 429) || !fromAccountId || !['anthropic', 'openai'].includes(provider)) return;
  try {
    const now = Date.now();
    const retry = body.retryAfter ?? body.retry_after ?? body['retry-after'];
    const seconds = typeof retry === 'number' || typeof retry === 'string' && /^\d+(\.\d+)?$/.test(retry) ? Number(retry) : NaN;
    const retryAt = Number.isFinite(seconds) && seconds > 0 ? now + seconds * 1000 : typeof retry === 'string' ? Date.parse(retry) : NaN;
    const reset = body.resetAt ?? body.reset_at;
    const resetAt = typeof reset === 'number' ? (reset < 1e12 ? reset * 1000 : reset) : typeof reset === 'string' ? Date.parse(reset) : NaN;
    let until = retryAt > now ? retryAt : resetAt > now ? resetAt : NaN;
    if (status == null) {
      const snapshot = await getUsageBudget({ cachedOnly: true });
      const fetchedAt = Date.parse(snapshot.fetchedAt);
      if (!Number.isFinite(fetchedAt) || fetchedAt > now || now - fetchedAt > 15 * 60000) return;
      const exhausted = snapshot.providers.filter(p => p.provider === provider && p.accountId === fromAccountId && p.kind === 'window')
        .flatMap(p => p.items).filter(i => typeof i.remainingFraction === 'number' && Number.isFinite(i.remainingFraction) && i.remainingFraction <= 0);
      if (!exhausted.length) return;
      const resets = exhausted.map(i => Date.parse(i.resetAt ?? '')).filter(t => t > now);
      until = Number.isFinite(until) ? until : resets.length ? Math.max(...resets) : now + 3600000;
    }
    if (!Number.isFinite(until)) {
      const snapshot = await getUsageBudget({ cachedOnly: true });
      const account = accountsFromSnapshot(snapshot).find(a => a.provider === provider && a.id === fromAccountId);
      until = account?.resetsAt && account.resetsAt > now ? account.resetsAt : now + 3600000;
    }
    new RouterGridExhaustionStore().markExhausted(provider as 'anthropic' | 'openai', fromAccountId, until);
  } catch { /* Never turn a spillover receipt into a prompt failure. */ }
}
