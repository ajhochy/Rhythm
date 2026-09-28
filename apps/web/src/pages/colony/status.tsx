import { useEffect, useState } from 'react';

export type ColonyLoadPhase = 'idle' | 'progress' | 'stale' | 'cancelled';

/** Progress is visible as soon as a load starts; a bounded stale/cancel/retry state
 * replaces it once a single load has run for 60s without completing. */
export function useColonyLoadPhase(loading: boolean, startedAt: number | null): ColonyLoadPhase {
  const [phase, setPhase] = useState<ColonyLoadPhase>('idle');
  useEffect(() => {
    if (!loading || !startedAt) { setPhase('idle'); return; }
    setPhase('progress');
    const remaining = Math.max(0, 60_000 - (Date.now() - startedAt));
    const timer = window.setTimeout(() => setPhase('stale'), remaining);
    return () => window.clearTimeout(timer);
  }, [loading, startedAt]);
  return phase;
}

export function ColonyFreshnessBanner({ phase, onCancel, onRetry }: { phase: ColonyLoadPhase; onCancel(): void; onRetry(): void }) {
  if (phase === 'idle') return null;
  if (phase === 'cancelled') return <div className="colony-freshness colony-freshness-stale" role="status">
    <p>Bot Crossing inventory load was cancelled.</p>
    <div className="colony-state-actions"><button type="button" className="secondary-button compact" onClick={onRetry}>Retry</button></div>
  </div>;
  if (phase === 'stale') return <div className="colony-freshness colony-freshness-stale" role="status">
    <p>Bot Crossing inventory is taking longer than expected.</p>
    <div className="colony-state-actions">
      <button type="button" className="secondary-button compact" onClick={onCancel}>Cancel</button>
      <button type="button" className="secondary-button compact" onClick={onRetry}>Retry</button>
    </div>
  </div>;
  return <p className="colony-freshness colony-freshness-progress" role="status">Reading local Bot Crossing sources…</p>;
}

/** Failed sources are named by text, never by color alone; healthy rows are unaffected. */
export function ColonyPartialFailureBanner({ warnings, labelFor }: { warnings: string[]; labelFor(id: string): string }) {
  if (!warnings.length) return null;
  const names = warnings.map((warning) => labelFor(warning.split(':')[0]?.trim() ?? warning));
  return <p className="colony-state-warning" role="alert">Some sources could not be read: {names.join(', ')}. Showing their last known results.</p>;
}
