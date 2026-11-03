import { useEffect, useRef, useState } from 'react';
import { getDayflowDesktopBridge, type DayflowDesktopStatus } from '../../gateway/dayflow-desktop';

const unavailable: DayflowDesktopStatus = { status: 'unavailable', code: 'BRIDGE_UNAVAILABLE' };

function label(status: DayflowDesktopStatus) {
  if (status.status === 'ready') return 'Native app ready';
  if (status.status === 'unsupported') return 'Native app is unsupported on this platform';
  return 'Native app unavailable';
}

/** Native Dayflow belongs to its own signed window; this panel never embeds it. */
export function DayflowDesktopSettings() {
  const [status, setStatus] = useState<DayflowDesktopStatus | null>(null);
  const [opening, setOpening] = useState(false);
  const epoch = useRef(0);
  const refresh = async () => {
    const request = ++epoch.current;
    const bridge = getDayflowDesktopBridge();
    if (!bridge) { if (request === epoch.current) setStatus(unavailable); return; }
    try { const next = await bridge.getDayflowDesktopStatus(); if (request === epoch.current) setStatus(next); }
    catch { if (request === epoch.current) setStatus(unavailable); }
  };
  useEffect(() => { void refresh(); return () => { epoch.current += 1; }; }, []);
  const open = async () => {
    const bridge = getDayflowDesktopBridge();
    if (!bridge || opening) { setStatus(unavailable); return; }
    setOpening(true);
    const request = ++epoch.current;
    try { const next = await bridge.openDayflowDesktop(); if (request === epoch.current) setStatus(next); }
    catch { if (request === epoch.current) setStatus(unavailable); }
    finally { if (request === epoch.current) setOpening(false); }
  };
  return <section className="settings-row" data-testid="dayflow-native-settings" aria-labelledby="dayflow-native-title">
    <div><h3 id="dayflow-native-title">Dayflow native app</h3><p>Timeline, capture, providers, and privacy stay in Dayflow’s original signed macOS window. Rhythm does not embed or control those screens.</p>
      <dl className="settings-properties"><div><dt>Readiness</dt><dd data-testid="dayflow-native-readiness">{status ? label(status) : 'Checking native app…'}</dd></div>{status?.status === 'ready' && <><div><dt>Version</dt><dd>{status.version}</dd></div><div><dt>Build</dt><dd>{status.build}</dd></div></>}</dl>
    </div>
    <button className="primary-button" type="button" disabled={opening} onClick={() => void open()} data-testid="dayflow-open-native">{opening ? 'Opening Dayflow…' : 'Open Dayflow'}</button>
  </section>;
}
