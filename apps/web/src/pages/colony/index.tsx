import { useCallback, useEffect, useRef, useState } from 'react';
import { colonyShell, type ColonySourceChoice, type ColonyStatus } from './bridge';
import './styles.css';

const labels: Record<string, string> = {
  hermes: 'Hermes', codex: 'Codex', rhythm: 'Rhythm', opencode: 'OpenCode',
  'claude-code': 'Claude Code', cursor: 'Cursor', antigravity: 'Antigravity', kilocode: 'Kilo Code',
};

function overlayOpen() {
  return Boolean(document.querySelector('.menu-popover, [role="dialog"], .toast[data-visible="true"]'));
}

function ColonyHost({ onError }: { onError(message: string): void }) {
  const host = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const attached = useRef(false);
  const attachment = useRef<Promise<void> | null>(null);
  const detachTimer = useRef<number>();
  const reportCurrentBounds = useRef<() => void>(() => {});
  useEffect(() => {
    const bridge = colonyShell()?.colonyView;
    active.current = true;
    if (detachTimer.current !== undefined) window.clearTimeout(detachTimer.current);
    let frame = 0;
    const reportBounds = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!active.current || !attached.current) return;
        const rect = host.current?.getBoundingClientRect();
        const bounds = overlayOpen() || !rect
          ? { x: 0, y: 0, width: 0, height: 0 }
          : { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        void bridge?.setBounds(bounds).catch(() => { if (active.current) onError('Bot Crossing could not resize. Retry the local view.'); });
      });
    };
    reportCurrentBounds.current = reportBounds;
    const resize = new ResizeObserver(reportBounds);
    if (host.current) resize.observe(host.current);
    const overlays = new MutationObserver(reportBounds);
    overlays.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['data-visible', 'open', 'aria-expanded'] });
    window.addEventListener('scroll', reportBounds, true);
    window.addEventListener('resize', reportBounds);
    if (!bridge) onError('This version of Rhythm does not include the Bot Crossing host. Rebuild the Rhythm package.');
    else if (!attachment.current) {
      attachment.current = bridge.attach().then((result) => {
        if (result?.ok !== true) {
          if (active.current) onError(result?.reason || 'Bot Crossing could not open. Rebuild the pinned artifact and retry.');
          return;
        }
        attached.current = true;
        reportCurrentBounds.current();
      }).catch(() => {
        if (active.current) onError('Bot Crossing could not open. Rebuild the pinned artifact and retry.');
      });
    }
    return () => {
      active.current = false;
      cancelAnimationFrame(frame);
      resize.disconnect();
      overlays.disconnect();
      window.removeEventListener('scroll', reportBounds, true);
      window.removeEventListener('resize', reportBounds);
      // StrictMode immediately replays mount effects. Deferring disposal one task
      // lets that replay reuse the in-flight attachment while real route departure
      // still tears down exactly once.
      detachTimer.current = window.setTimeout(() => {
        if (active.current) return;
        void attachment.current?.then(async () => {
          if (active.current || !attached.current) return;
          attached.current = false;
          attachment.current = null;
          await bridge?.detach().catch(() => undefined);
        });
      }, 0);
    };
  }, [onError]);
  return <div ref={host} className="colony-host" data-colony-host role="region" aria-label="Bot Crossing scene" tabIndex={0} />;
}

function Enablement({ sources, busy, onToggle, onEnable }: { sources: ColonySourceChoice[]; busy: boolean; onToggle(id: string, enabled: boolean): void; onEnable(): void }) {
  return <div className="colony-state colony-onboarding">
    <p className="eyebrow">Local workspace map</p>
    <h1>See your local agent work in one place</h1>
    <p>Bot Crossing reads the local task stores you choose and draws them as a shared scene. Discovery is read-only: Rhythm does not edit harness records or upload their paths and history to the hosted API.</p>
    <fieldset>
      <legend>Choose local sources</legend>
      <div className="colony-source-list">
        {sources.map((source) => <label key={source.id} className="colony-source">
          <input type="checkbox" checked={source.enabled} disabled={busy || source.state === 'missing'} onChange={(event) => onToggle(source.id, event.currentTarget.checked)} />
          <span><strong>{labels[source.id] ?? source.id}</strong><small>{source.state === 'present' ? 'Found on this Mac' : 'Not found on this Mac'}</small></span>
        </label>)}
      </div>
    </fieldset>
    <div className="colony-state-actions"><button type="button" className="primary-button" disabled={busy} onClick={onEnable}>Enable Bot Crossing</button></div>
    <p className="colony-footnote">You can disable scanning later without deleting this profile’s local Colony state.</p>
  </div>;
}

export function ColonyPage() {
  const bridge = colonyShell()?.colonyView;
  const [status, setStatus] = useState<ColonyStatus | null>(null);
  const [sources, setSources] = useState<ColonySourceChoice[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const handleError = useCallback((message: string) => setError(message), []);

  useEffect(() => {
    let alive = true;
    if (!bridge) { setError('This version of Rhythm does not include the Bot Crossing host. Rebuild the Rhythm package.'); return; }
    void bridge.getStatus().then(async (next) => {
      if (!alive) return;
      setStatus(next);
      if (!next.available) { setError(next.reason || 'Bot Crossing is unavailable. Rebuild the Rhythm package.'); return; }
      if (!next.enabled) {
        const choices = await bridge.discoverSources();
        if (alive) setSources(choices);
      }
    }).catch(() => { if (alive) setError('Bot Crossing settings are unavailable. Rebuild the Rhythm package.'); });
    return () => { alive = false; };
  }, [attempt, bridge]);

  const toggle = async (id: string, enabled: boolean) => {
    if (!bridge) return;
    setBusy(true);
    try {
      await bridge.setSource(id, enabled);
      setSources((current) => current.map((source) => source.id === id ? { ...source, enabled } : source));
    } catch { setError('Rhythm could not save that local source choice.'); }
    finally { setBusy(false); }
  };
  const enable = async () => {
    if (!bridge) return;
    setBusy(true);
    try { const next = await bridge.setEnabled(true); setStatus(next); setError(''); }
    catch { setError('Rhythm could not enable Bot Crossing for this profile.'); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      const next = await bridge.setEnabled(false);
      setStatus(next);
      setSources(await bridge.discoverSources());
    } catch { setError('Rhythm could not stop Bot Crossing.'); }
    finally { setBusy(false); }
  };

  return <section className="colony-page" aria-label="Bot Crossing" data-testid="page-colony">
    {error ? <div className="colony-state colony-error"><p className="eyebrow">Local view unavailable</p><h1>Bot Crossing could not open</h1><p role="alert">{error}</p><div className="colony-state-actions"><button type="button" className="primary-button" onClick={() => { setError(''); setAttempt((value) => value + 1); }}>Retry</button></div></div>
      : !status ? <div className="colony-state" role="status"><p>Loading Bot Crossing settings…</p></div>
        : !status.enabled ? <Enablement sources={sources} busy={busy} onToggle={(id, enabled) => void toggle(id, enabled)} onEnable={() => void enable()} />
          : <div className="colony-enabled"><header className="colony-toolbar"><div><strong>Bot Crossing</strong><span>Local read-only sources</span></div><button type="button" className="secondary-button compact" disabled={busy} onClick={() => void disable()}>Disable</button></header><ColonyHost key={attempt} onError={handleError} /></div>}
  </section>;
}
