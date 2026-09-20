import { useCallback, useEffect, useRef, useState } from 'react';
import { hermesShell } from './bridge';
import './styles.css';

function HermesHost({ onError }: { onError(message: string): void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    let attached = false;
    let frame = 0;
    const reportBounds = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = host.current?.getBoundingClientRect();
        if (!alive || !attached || !rect) return;
        void hermesShell()?.hermesView?.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }).catch(() => {
          if (alive) onError('Hermes Desktop could not resize. Return to the Hermes tab to retry.');
        });
      });
    };
    const observer = new ResizeObserver(reportBounds);
    if (host.current) observer.observe(host.current);
    window.addEventListener('scroll', reportBounds, true);
    window.addEventListener('resize', reportBounds);
    const attach = async () => {
      if (!hermesShell()?.hermesView) {
        onError('This version of Rhythm does not include the Hermes Desktop host. Rebuild the Rhythm package.');
        return;
      }
      try {
        const result = await hermesShell()?.hermesView?.attach();
        if (!alive) return;
        if (result?.ok === false) { onError(result.reason || 'Hermes Desktop could not open. Rebuild the pinned artifact and retry.'); return; }
        attached = true;
        reportBounds();
      } catch { if (alive) onError('Hermes Desktop could not open. Rebuild the pinned artifact and retry.'); }
    };
    void attach();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', reportBounds, true);
      window.removeEventListener('resize', reportBounds);
      // The child remains mounted across hash-only tab changes so desktop
      // drafts and streams survive until the document is revoked or Rhythm exits.
      if (attached) void hermesShell()?.hermesView?.setBounds({ x: 0, y: 0, width: 0, height: 0 }).catch(() => undefined);
    };
  }, [onError]);
  return <div ref={host} className="hermes-host" data-hermes-host role="region" aria-label="Hermes Desktop workspace" tabIndex={0} />;
}

export function HermesPage() {
  const [viewError, setViewError] = useState('');
  const handleError = useCallback((message: string) => setViewError(message), []);
  return <section className="hermes-page" aria-label="Hermes" data-testid="page-hermes">
    <div className="hermes-content">
      {viewError
        ? <div className="hermes-state" tabIndex={0}><h2>Hermes Desktop could not open</h2><p role="alert">{viewError}</p><button type="button" className="primary-button" onClick={() => setViewError('')}>Retry</button></div>
        : <HermesHost onError={handleError} />}
    </div>
  </section>;
}
