import { useCallback, useEffect, useState } from 'react';
import { colonyShell, type ColonySourceChoice, type ColonyStatus } from './bridge';

const sourceLabels: Record<string, string> = {
  hermes: 'Hermes', codex: 'Codex', rhythm: 'Rhythm', opencode: 'OpenCode', kilocode: 'Kilo Code',
  'claude-code': 'Claude Code', cursor: 'Cursor', antigravity: 'Antigravity',
};

type Counts = { archived: number; viewed: number; groups: number; version?: number };

export function ColonySettings() {
  const bridge = colonyShell()?.colonyView;
  const [status, setStatus] = useState<ColonyStatus | null>(null);
  const [sources, setSources] = useState<ColonySourceChoice[]>([]);
  const [preview, setPreview] = useState<Counts | null>(null);
  const [message, setMessage] = useState<{ error?: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!bridge) { setMessage({ error: true, text: 'Bot Crossing is available only in the Rhythm desktop app.' }); return; }
    try {
      const [next, choices] = await Promise.all([bridge.getStatus(), bridge.discoverSources()]);
      setStatus(next); setSources(choices); setPreview(null);
    } catch { setMessage({ error: true, text: 'Bot Crossing settings are unavailable.' }); }
  }, [bridge]);

  useEffect(() => { void refresh(); return bridge?.onReset?.(() => { setStatus({ v: 1, available: true, enabled: false, sources: [] }); setSources([]); setPreview(null); setMessage(null); }); }, [bridge, refresh]);

  const setSource = async (id: string, enabled: boolean) => {
    if (!bridge) return;
    setBusy(true); setMessage(null);
    try {
      await bridge.setSource(id, enabled);
      setSources((current) => current.map((source) => source.id === id ? { ...source, enabled } : source));
    } catch { setMessage({ error: true, text: 'Rhythm could not save that local source choice.' }); }
    finally { setBusy(false); }
  };
  const setEnabled = async (enabled: boolean) => {
    if (!bridge) return;
    setBusy(true); setMessage(null); setPreview(null);
    try { setStatus(await bridge.setEnabled(enabled)); }
    catch { setMessage({ error: true, text: `Rhythm could not ${enabled ? 'enable' : 'disable'} Bot Crossing.` }); }
    finally { setBusy(false); }
  };
  const chooseImport = async () => {
    if (!bridge?.previewImport) return;
    setBusy(true); setMessage(null); setPreview(null);
    try {
      const result = await bridge.previewImport();
      if (result.ok && result.counts) setPreview(result.counts);
      else if (!result.cancelled) setMessage({ error: true, text: result.reason || 'The state file could not be previewed.' });
    } catch { setMessage({ error: true, text: 'The state file could not be previewed.' }); }
    finally { setBusy(false); }
  };
  const commitImport = async () => {
    if (!bridge?.commitImport || !preview || committing) return;
    setCommitting(true); setMessage(null);
    try {
      const result = await bridge.commitImport();
      if (!result.ok) setMessage({ error: true, text: result.reason || 'The state file could not be imported.' });
      else {
        const counts = result.receipt?.counts ?? preview;
        setMessage({ text: `Imported ${counts.archived.toLocaleString()} archived, ${counts.viewed.toLocaleString()} viewed, and ${counts.groups.toLocaleString()} group entries.` });
        setPreview(null);
      }
    } catch { setMessage({ error: true, text: 'The state file could not be imported.' }); }
    finally { setCommitting(false); }
  };

  return <div className="colony-settings">
    <p className="settings-section-intro">Bot Crossing reads only the local task stores you choose. Paths, task history, and Colony preferences stay on this Mac and are not uploaded to the hosted Rhythm API.</p>
    {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'settings-action-error' : 'settings-readonly'}>{message.text}</p>}
    <fieldset disabled={busy || committing || !status?.available}>
      <legend>Local sources</legend>
      <div className="settings-access-list">
        {sources.map((source) => <label className="settings-check" key={source.id}>
          <input type="checkbox" aria-label={`Scan ${sourceLabels[source.id] ?? source.id}`} checked={source.enabled} disabled={busy || source.state === 'missing'} onChange={(event) => void setSource(source.id, event.currentTarget.checked)} />
          <span><strong>{sourceLabels[source.id] ?? source.id}</strong><small>{source.state === 'missing' ? 'Not found on this Mac' : 'Available on this Mac'}</small></span>
        </label>)}
      </div>
    </fieldset>
    <div className="settings-actions">
      <button type="button" className={status?.enabled ? 'secondary-button' : 'primary-button'} disabled={busy || committing || !status?.available} onClick={() => void setEnabled(!status?.enabled)}>{status?.enabled ? 'Disable Bot Crossing' : 'Enable Bot Crossing'}</button>
      <button type="button" className="secondary-button" disabled={busy || committing || !status?.enabled} onClick={() => void chooseImport()}>Choose state file</button>
    </div>
    <p className="settings-scope">Disable stops local scanning but preserves this profile’s Colony-owned state.</p>
    {preview && <div className="settings-card" aria-label="Import preview">
      <h3>Import preview</h3>
      <p>{preview.archived.toLocaleString()} archived · {preview.viewed.toLocaleString()} viewed · {preview.groups.toLocaleString()} groups</p>
      <p className="settings-readonly">The original file and harness stores remain unchanged. Import merges once into this profile after confirmation.</p>
      <button type="button" className="primary-button" disabled={committing} onClick={() => void commitImport()}>Import this state</button>
    </div>}
  </div>;
}
