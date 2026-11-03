import { useCallback, useEffect, useState } from 'react';
import { useGateway } from '../../gateway/context';
import type { SessionRetentionMode, SessionRetentionState } from '../../gateway/runtime';

// Session-DB retention (docs/ai/decisions/2026-09-29-session-db-retention.md). The API reads the
// stored mode on every nightly run, so a change here applies at the next 02:15 run, no restart.
const OPTIONS: Array<{ mode: SessionRetentionMode; label: string; description: string }> = [
  { mode: 'off', label: 'Off', description: 'Skip the nightly check entirely. Nothing is read or changed.' },
  { mode: 'dry-run', label: 'Report only', description: 'Measure how much space old tool output uses each night, without changing anything.' },
  { mode: 'on', label: 'On', description: 'Each night, shorten old tool output in place to reclaim space.' },
];

const gb = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(bytes / 1e6, 0).toFixed(bytes >= 1e7 ? 0 : 1)} MB`;

export function reportLine(report: NonNullable<SessionRetentionState['lastReport']>): string {
  const parts = [
    report.reclaimableBytes.engine !== null ? `${gb(report.reclaimableBytes.engine)} (engine)` : null,
    report.reclaimableBytes.rhythm !== null ? `${gb(report.reclaimableBytes.rhythm)} (Rhythm)` : null,
  ].filter(Boolean).join(' + ') || 'nothing';
  const when = new Date(report.finishedAt).toLocaleString();
  return report.mode === 'on' ? `Last run: freed ${parts}, ${when}` : `Last check: would free ${parts}, ${when}`;
}

export function SessionRetentionSettings() {
  const runtime = useGateway().domains.runtime;
  const [state, setState] = useState<SessionRetentionState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    if (!runtime) { setError('Session cleanup is available only in the Rhythm desktop app.'); return; }
    try { setState(await runtime.sessionRetention()); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Session cleanup settings are unavailable.'); }
  }, [runtime]);
  useEffect(() => { void load(); }, [load]);

  const save = async (mode: SessionRetentionMode) => {
    if (!runtime) return;
    setBusy(true); setError(''); setConfirming(false);
    try { setState(await runtime.setSessionRetention(mode)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Session cleanup could not be saved.'); }
    finally { setBusy(false); }
  };

  const envOverride = state?.source === 'env';
  const choose = (mode: SessionRetentionMode) => {
    if (mode === state?.mode) return;
    if (mode === 'on') setConfirming(true);
    else void save(mode);
  };

  return <div className="session-retention-settings" data-testid="session-retention-panel">
    <p className="settings-section-intro">Agent sessions keep every tool result forever, which is most of the space the session databases use. Rhythm checks them each night at 2:15 AM.</p>
    {error && <p className="settings-feedback error" role="alert">{error}</p>}
    {envOverride && <p className="settings-readonly" role="status" data-testid="session-retention-env">
      Set by the RHYTHM_SESSION_RETENTION environment variable ({OPTIONS.find((o) => o.mode === state.mode)?.label}). Unset it to control this here.
    </p>}
    <fieldset className="session-retention-options" disabled={!state || busy || envOverride}>
      <legend>Cleanup mode</legend>
      {OPTIONS.map((option) => <label className="settings-check" key={option.mode}>
        <input type="radio" name="session-retention" value={option.mode} checked={state?.mode === option.mode} onChange={() => choose(option.mode)} />
        <span><strong>{option.label}</strong><small>{option.description}</small></span>
      </label>)}
    </fieldset>
    {confirming && <div className="session-retention-confirm" role="alertdialog" aria-labelledby="session-retention-confirm-title">
      <strong id="session-retention-confirm-title">Turn on session cleanup?</strong>
      <p>Each night Rhythm shortens tool output older than 30 days, in sessions idle for 30 days, to its first 2 KB. This edits the session history in place and cannot be undone.</p>
      <p>Kept in full: message text, token and cost totals, and skill history.</p>
      <div className="settings-actions">
        <button className="primary-button" type="button" onClick={() => void save('on')}>Turn on cleanup</button>
        <button className="secondary-button" type="button" onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    </div>}
    {state?.lastReport
      ? <p className="settings-scope" data-testid="session-retention-report">{reportLine(state.lastReport)}</p>
      : state && <p className="settings-scope">No nightly check has run yet.</p>}
  </div>;
}
