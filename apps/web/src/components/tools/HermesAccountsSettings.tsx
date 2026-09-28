import { useEffect, useRef, useState } from 'react';
import type { AiAccountProvider, AiAccountsStatus } from '../../ai-accounts';
import { accountProviders, accountStatus, aiAccountsBridge } from './aiAccountsBridge';

const labels = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', openrouter: 'OpenRouter' };
// Plain-language copy: Hermes can borrow a plain API key Rhythm already has, never an OAuth sign-in.
const sourceLabels = {
  eligible: 'Rhythm has an API key Hermes can use.',
  'hermes-owned': 'Hermes uses its own sign-in for this provider.',
  'oauth-not-shareable': "Signed in with your account, which can't be shared. Sign in to this provider in Hermes.",
  'source-missing': "Rhythm doesn't have an API key for this provider.",
  'source-unavailable': "Rhythm can't tell whether it has a key, so sharing is off.",
};
const applicationLabels = { absent: 'Not shared', configured: 'Will be shared when Hermes restarts', applied: 'Shared with Hermes', 'pending-next-start': 'Waiting for Hermes to restart' };
const memoryLabels = {
  disabled: 'Memory search is disabled.',
  enabled: 'Memory search is enabled for the running Hermes default profile.',
  'pending-next-start': 'Memory search will be enabled on the next Hermes start.',
  unavailable: 'Memory search is unavailable until the desktop establishes the current vault identity.',
};

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
  const changeMemory = async (action: 'enable' | 'disable') => {
    const bridge = aiAccountsBridge();
    if (!bridge || submitting.current) return;
    const current = generation.current;
    submitting.current = true; setPending(true); setNotice(''); setError('');
    try {
      const result = await bridge.setMemorySearchConsent({ action, capability: 'memory.search' });
      if (current !== generation.current) return;
      setNotice(result?.accepted === true ? 'Memory sharing preference saved.' : 'Memory sharing was not changed.');
      await refresh();
    } catch {
      if (current === generation.current) { await refresh(); if (current + 1 === generation.current) setError('Memory sharing was not changed. Refresh status and try again.'); }
    } finally { submitting.current = false; setPending(false); }
  };
  return <section className="hermes-accounts-settings" aria-label="Hermes account sharing">
    <header><h3>Hermes account sharing</h3><p>Let Hermes use Rhythm's API keys, so you don't sign in twice. Changes apply the next time Hermes starts, after you confirm them in the desktop app.</p></header>
    {loading && <p role="status">Loading sharing status…</p>}
    {pending && <p role="status">Waiting for desktop confirmation…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && status?.availability !== 'available' && <p>Hermes account sharing is unavailable. Sign in to the desktop app and make sure the default Hermes profile is available.</p>}
    {status?.childMayRetainCredential && <p role="note">Hermes may keep using a key it already has until it restarts.</p>}
    {status?.availability === 'available' && accountProviders.map(provider => {
      const entry = status.providers![provider];
      return <div key={provider} role="group" aria-labelledby={`hermes-account-${provider}`} className="hermes-account-row">
        <strong id={`hermes-account-${provider}`}>{labels[provider]}</strong>
        <p><span className="hermes-account-state">{applicationLabels[entry.applicationState]}</span> · {sourceLabels[entry.sharingEligibility]}{entry.sharingEligibility === 'hermes-owned' && <small> Not checked by Rhythm.</small>}</p>
        {(entry.grantEnabled || entry.sharingEligibility === 'eligible') && <button type="button" className="secondary-button compact" disabled={loading || pending} onClick={() => void change(provider, entry.grantEnabled ? 'disable' : 'enable')}>{entry.grantEnabled ? 'Stop sharing' : 'Share with Hermes'}</button>}
      </div>;
    })}
    {status && <div role="group" aria-labelledby="hermes-account-memory" className="hermes-account-row hermes-accounts-memory"><strong id="hermes-account-memory">Rhythm memory search</strong>
      <p>{memoryLabels[status.memory.state]} Hermes can read the Rhythm vault but not change it; you can turn this off at any time.</p>
      {status.memory.state !== 'unavailable' && <button type="button" className="secondary-button compact" disabled={loading || pending}
        onClick={() => void changeMemory(status.memory.state === 'disabled' ? 'enable' : 'disable')}>
        {status.memory.state === 'disabled' ? 'Share memory search' : 'Stop sharing memory search'}
      </button>}
    </div>}
    <button type="button" className="secondary-button compact" disabled={loading || pending} onClick={() => void refresh()}>Refresh sharing status</button>
  </section>;
}
