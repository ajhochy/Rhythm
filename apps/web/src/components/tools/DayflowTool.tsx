import { useEffect, useRef, useState } from 'react';
import { navigate } from '../Shell';
import { getDayflowDesktopBridge, type DayflowDesktopStatus } from '../../gateway/dayflow-desktop';

const unavailable: DayflowDesktopStatus = { status: 'unavailable', code: 'BRIDGE_UNAVAILABLE' };

/** Hook target for the builder-owned ToolWorkspace; no timeline is recreated here. */
export function DayflowTool() {
  const [status, setStatus] = useState<DayflowDesktopStatus | null>(null);
  const [opening, setOpening] = useState(false);
  const alive = useRef(true);
  const check = async () => {
    const bridge = getDayflowDesktopBridge();
    try { const next = bridge ? await bridge.getDayflowDesktopStatus() : unavailable; if (alive.current) setStatus(next); }
    catch { if (alive.current) setStatus(unavailable); }
  };
  useEffect(() => { alive.current = true; void check(); return () => { alive.current = false; }; }, []);
  const open = async () => {
    const bridge = getDayflowDesktopBridge(); setOpening(true);
    try { const next = bridge ? await bridge.openDayflowDesktop() : unavailable; if (alive.current) setStatus(next); }
    catch { if (alive.current) setStatus(unavailable); }
    finally { if (alive.current) setOpening(false); }
  };
  return <section className="tool-workspace" data-testid="tool-page-dayflow"><header className="tool-workspace-header"><div className="tool-heading-copy"><span className="eyebrow">Companion app</span><h1>Dayflow</h1><p>Open the original Dayflow screens in their native signed window. Rhythm does not render a copy of the timeline.</p></div></header><div className="tool-workspace-body"><p role="status">{status?.status === 'ready' ? `Native app ready · version ${status.version} · build ${status.build}` : status?.status === 'unsupported' ? 'Native app is unsupported on this platform.' : status ? 'Native app unavailable.' : 'Checking native app…'}</p><div className="dialog-actions"><button className="primary-button" type="button" disabled={opening} onClick={() => void open()} data-testid="dayflow-tool-open">{opening ? 'Opening Dayflow…' : 'Open Dayflow'}</button><button className="secondary-button" type="button" onClick={() => navigate('/settings?settingsSection=dayflow')}>Dayflow Settings</button></div><p>Bridge import state is managed separately in Rhythm Settings. Capture, provider, setup, and privacy controls are managed in Dayflow native settings.</p></div></section>;
}
