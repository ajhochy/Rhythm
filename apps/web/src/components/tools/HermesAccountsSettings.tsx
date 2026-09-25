import { useEffect, useRef, useState } from 'react';
import type { AiAccountProvider, AiAccountsStatus } from '../../ai-accounts';
import { accountProviders, accountStatus, aiAccountsBridge } from './aiAccountsBridge';

const labels = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', openrouter: 'OpenRouter' };
const sourceLabels = {
  eligible: 'A Rhythm API key is available to share.',
  'hermes-owned': 'Hermes has its own credential source. It takes precedence; sign-in validity has not been checked.',
  'oauth-not-shareable': 'OAuth credentials are not shareable. Configure this provider in Hermes.',
  'source-missing': 'No shareable Rhythm API key is present.',
  'source-unavailable': 'Credential source status is unknown. Sharing cannot be enabled.',
};
const applicationLabels = { absent: 'Not shared', configured: 'Configured for next start', applied: 'Applied to running Hermes', 'pending-next-start': 'Pending next start' };

export function HermesAccountsSettings() {
  const [status, setStatus] = useState<AiAccountsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const submitting = useRef(false);
  const refresh = async () => {
    const current = ++generation.current;
    setLoading(true); setError('');
    try {
      const bridge = aiAccountsBridge();
      const next = accountStatus(bridge ? await bridge.getStatus() : null);
      if (current === generation.current) setStatus(next);
    } catch {
      if (current === generation.current) { setStatus(accountStatus(null)); setError('Sharing status could not be loaded. Refresh to try again.'); }
    } finally { if (current === generation.current) setLoading(false); }
  };
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const change = async (provider: AiAccountProvider, action: 'enable' | 'disable') => {
    const bridge = aiAccountsBridge();
    if (!bridge || submitting.current) return;
    const current = generation.current;
    submitting.current = true; setPending(true); setNotice(''); setError('');
    try {
      const result = await bridge.setGrant({ action, provider, source: 'opencode-auth-json' });
      if (current !== generation.current) return;
      setNotice(result?.accepted === true ? 'Sharing preference saved.' : 'Sharing was not changed.');
      await refresh();
    } catch {
      if (current === generation.current) { await refresh(); if (current + 1 === generation.current) setError('Sharing was not changed. Refresh status and try again.'); }
    } finally { submitting.current = false; setPending(false); }
  };
  return <section className="hermes-accounts-settings" aria-label="Hermes account sharing">
    <header><h3>Hermes account sharing</h3><p>Choose which Rhythm API keys Hermes may use on its next start. Confirmation happens in the desktop app.</p></header>
    {loading && <p role="status">Loading sharing status…</p>}
    {pending && <p role="status">Waiting for desktop confirmation…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && status?.availability !== 'available' && <p>Hermes account sharing is unavailable. Sign in to the desktop app and make sure the default Hermes profile is available.</p>}
    {status?.childMayRetainCredential && <p role="note">Running Hermes may retain a previously shared key until it stops.</p>}
    {status?.availability === 'available' && accountProviders.map(provider => {
      const entry = status.providers![provider];
      return <fieldset key={provider} className="hermes-account-row"><legend>{labels[provider]}</legend>
        <div><p>{sourceLabels[entry.sharingEligibility]}</p><p><strong>{applicationLabels[entry.applicationState]}</strong></p></div>
        {(entry.grantEnabled || entry.sharingEligibility === 'eligible') && <button type="button" className="secondary-button compact" disabled={loading || pending} onClick={() => void change(provider, entry.grantEnabled ? 'disable' : 'enable')}>{entry.grantEnabled ? 'Stop sharing' : 'Share with Hermes'}</button>}
      </fieldset>;
    })}
    <p className="hermes-accounts-memory">Memory sharing is disabled.</p>
    <button type="button" className="secondary-button compact" disabled={loading || pending} onClick={() => void refresh()}>Refresh sharing status</button>
  </section>;
}
