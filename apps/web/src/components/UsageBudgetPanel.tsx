import { useEffect, useRef, useState } from 'react';
import { useGateway } from '../gateway/context';
import type { UsageBudgetSnapshot } from '../gateway/usage-budget';
import { formatResetIn } from '../timestamps';
import { Icon } from '../icons';

export function UsageBudgetPanel() {
  const gateway = useGateway();
  const api = gateway.domains.usageBudget;
  const [snapshot, setSnapshot] = useState<UsageBudgetSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const initializedApi = useRef<typeof api>();
  const load = async (force = false) => {
    if (!api) return;
    const current = ++sequence.current;
    setLoading(true); setError('');
    try {
      const next = await api.get(force ? { force: true } : undefined);
      if (current === sequence.current) setSnapshot(next);
    } catch {
      if (current === sequence.current) setError('Usage budget unavailable.');
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (gateway.mode !== 'live' || !api) return;
    if (initializedApi.current === api) return;
    initializedApi.current = api;
    void load();
    // The gateway identity owns this request; manual refresh supplies force=true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, gateway.mode]);
  if (gateway.mode !== 'live' || !api) return null;
  return <section className="usage-budget-panel" aria-labelledby="usage-budget-title" data-testid="usage-budget-panel">
    <header><h3 id="usage-budget-title">Usage budget</h3><button className="icon-button small" type="button" aria-label="Refresh usage budget" title="Refresh usage budget" disabled={loading} onClick={() => void load(true)}><Icon name="refresh" size={13} /></button></header>
    {loading && !snapshot && <p role="status">Loading usage budget…</p>}
    {error && <p role="alert">{error} <button className="text-button" type="button" onClick={() => void load(true)}>Retry</button></p>}
    {snapshot?.providers.map((provider) => <section className={`usage-provider${provider.kind === 'unavailable' ? ' usage-provider-unavailable' : ''}`} key={`${provider.provider}:${provider.accountId ?? provider.label}`}>
      <h4>{provider.label}</h4>
      {provider.kind === 'unavailable' ? <p>{provider.reason || 'Usage unavailable'}</p> : provider.items.map((item, index) => {
        const remaining = item.remainingFraction == null ? null : Math.max(0, Math.min(1, item.remainingFraction));
        const percent = remaining == null ? null : Math.round(remaining * 100);
        const reset = formatResetIn(item.resetAt);
        return <div className="usage-budget-item" key={`${item.label}:${index}`}>
          <div><strong>{item.label}</strong><span>{percent == null ? '—' : `${percent}%`}</span></div>
          {remaining != null && <progress max={100} value={percent!} aria-label={`${item.label} remaining`} />}
          {(item.detail || reset) && <small>{[item.detail, reset].filter(Boolean).join(' · ')}</small>}
        </div>;
      })}
    </section>)}
  </section>;
}
