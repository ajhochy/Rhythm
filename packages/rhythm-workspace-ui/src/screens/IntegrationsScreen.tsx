// Ported from apps/web/src/pages/integrations/index.tsx (627 lines) — see SOURCE_MAP.md for
// what carried over vs. what was deliberately dropped. Planning Center task-filter preferences
// (team/position pickers) and the "AI Import" JSON-paste flow are cross-domain features (they
// bridge into Tasks/Rhythms/Projects and would need their own gateway surface) and are dropped
// per the issue: Planning Center becomes an explicit connect/reconnect/sync port plus a safe
// "locked" prerequisite panel when disconnected, never a deeper live call. Every provider
// authorization ("Connect"/"Reconnect") and the broader "assistant tools" consent go through
// `IntegrationsGateway.requestAuthorization` / `RhythmHostAdapter.onRequestFollowUp` — this
// screen never builds an OAuth URL, a bearer header, or navigates itself (see
// tests/forbidden-imports.test.ts). The local "handoff" dialog after requesting authorization is
// purely informational (mirrors production's fixture-mode confirmation) and never contacts a
// live service.
import { useEffect, useRef, useState } from 'react';
import { useRhythmDomainGateway, useRhythmHost } from '../context';
import { ScreenRoot } from './ScreenRoot';
import { FocusDialog } from '../components/FocusDialog';
import { RhythmGatewayError, type IntegrationProviderId, type RhythmCalendarSource, type RhythmGmailSignal, type RhythmIntegrationAccount } from '../domain/types';

type SurfaceState = 'loading' | 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'server_error';
type Section = IntegrationProviderId | 'assistant-tools';

const PROVIDER_IDS: IntegrationProviderId[] = ['google-calendar', 'gmail', 'planning-center'];
const PROVIDER_NAMES: Record<IntegrationProviderId, string> = { 'google-calendar': 'Google Calendar', gmail: 'Gmail', 'planning-center': 'Planning Center' };

function statusLabel(account: RhythmIntegrationAccount) {
  if (account.status === 'connected') return 'Connected';
  if (account.status === 'needs_reauth') return 'Permission required';
  if (account.status === 'error') return 'Needs attention';
  return 'Not connected';
}

function uniqueSignals(signals: RhythmGmailSignal[]) {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    if (seen.has(signal.threadId)) return false;
    seen.add(signal.threadId);
    return true;
  });
}

function StatePanel({ state, onRetry, onConnect }: { state: Exclude<SurfaceState, 'ready'>; onRetry(): void; onConnect(): void }) {
  if (state === 'loading') return <section className="integrations-state" role="status" aria-live="polite" data-testid="page-state-loading"><h2>Loading integrations</h2><p>Reading connected accounts and their provider settings.</p></section>;
  if (state === 'empty') return <section className="integrations-state" role="status" data-testid="page-state-empty"><h2>No integrations connected</h2><p>Connect Google to begin bringing calendar and inbox context into Rhythm.</p><button className="primary-button" type="button" onClick={onConnect} data-testid="integrations-empty-connect">Connect Google</button></section>;
  if (state === 'server_error') return <section className="integrations-state danger" role="alert" data-testid="page-state-server-error"><h2>Integrations could not be loaded</h2><p>The integration service returned a temporary error.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
  if (state === 'forbidden') return <section className="integrations-state warning" role="alert" data-testid="page-state-forbidden"><h2>Integration access is restricted</h2><p>An authenticated Rhythm workspace with integration access is required.</p></section>;
  return <section className="integrations-state warning" role="status" data-testid="page-state-unavailable"><h2>Integrations are unavailable</h2><p>Reconnect the integration service before managing connections.</p><button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button></section>;
}

export function IntegrationsScreen() {
  const { integrations: gateway } = useRhythmDomainGateway();
  const host = useRhythmHost();
  const [surfaceState, setSurfaceState] = useState<SurfaceState>('loading');
  const [accounts, setAccounts] = useState<RhythmIntegrationAccount[]>([]);
  const [calendarSources, setCalendarSources] = useState<RhythmCalendarSource[]>([]);
  const [gmailSignals, setGmailSignals] = useState<RhythmGmailSignal[]>([]);
  const [selectedSection, setSelectedSection] = useState<Section>('google-calendar');
  const [calendarSelection, setCalendarSelection] = useState<string[]>([]);
  const [calendarSaveStatus, setCalendarSaveStatus] = useState('');
  const [providerBusy, setProviderBusy] = useState<IntegrationProviderId | null>(null);
  const [providerStatus, setProviderStatus] = useState<Partial<Record<IntegrationProviderId, string>>>({});
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncAllStatus, setSyncAllStatus] = useState('');
  const [handoff, setHandoff] = useState<{ provider: IntegrationProviderId | 'google'; label: string } | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<IntegrationProviderId | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  const canMutate = host.currentUser.capabilities?.includes('integrations.write') ?? false;
  const mountedRef = useRef(true);

  const account = (id: IntegrationProviderId) => accounts.find((item) => item.id === id) ?? { id, name: PROVIDER_NAMES[id], monogram: '', status: 'disconnected' as const };
  const connectedCount = accounts.filter((item) => item.status === 'connected').length;

  const handleError = (error: unknown) => {
    const kind = error instanceof RhythmGatewayError ? error.kind : 'server_error';
    setSurfaceState(kind === 'forbidden' ? 'forbidden' : kind === 'not_found' ? 'unavailable' : kind === 'unavailable' ? 'unavailable' : 'server_error');
  };

  const load = async () => {
    setSurfaceState('loading');
    try {
      const [loadedAccounts, loadedCalendarSources] = await Promise.all([gateway.accounts(), gateway.calendarSources()]);
      if (!mountedRef.current) return;
      setAccounts(loadedAccounts);
      setCalendarSources(loadedCalendarSources);
      setCalendarSelection(loadedCalendarSources.filter((source) => source.selected).map((source) => source.id));
      setSurfaceState(loadedAccounts.every((item) => item.status === 'disconnected') ? 'empty' : 'ready');
    } catch (error) {
      if (!mountedRef.current) return;
      handleError(error);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { mountedRef.current = true; void load(); return () => { mountedRef.current = false; }; }, [gateway]);

  useEffect(() => {
    if (selectedSection === 'gmail' && account('gmail').status === 'connected' && !gmailSignals.length) {
      void gateway.gmailSignals().then((signals) => { if (mountedRef.current) setGmailSignals(signals); }).catch(() => { if (mountedRef.current) setProviderStatus((current) => ({ ...current, gmail: 'Gmail signals could not load. Retry syncing Gmail.' })); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSection, accounts]);

  const showsWorkspace = surfaceState === 'ready';

  const requestConnect = (id: IntegrationProviderId, section: Section = id) => {
    if (!canMutate) return;
    setSelectedSection(section);
    gateway.requestAuthorization(id);
    setHandoff({ provider: id, label: `Reconnecting ${PROVIDER_NAMES[id]}` });
  };

  const syncProvider = async (id: IntegrationProviderId) => {
    if (!canMutate) return;
    setProviderBusy(id);
    setProviderStatus((current) => ({ ...current, [id]: `Syncing ${PROVIDER_NAMES[id]}…` }));
    try {
      const updated = await gateway.sync(id);
      if (!mountedRef.current) return;
      setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setProviderStatus((current) => ({ ...current, [id]: `${PROVIDER_NAMES[id]} synced.` }));
    } catch (error) {
      if (!mountedRef.current) return;
      setProviderStatus((current) => ({ ...current, [id]: `${PROVIDER_NAMES[id]} could not sync. Existing data was kept.` }));
      // Keep the current inspector and show a provider-local recovery message.
    } finally {
      if (mountedRef.current) setProviderBusy(null);
    }
  };

  const syncAll = async () => {
    if (!canMutate) return;
    setSyncingAll(true);
    setSyncAllStatus('Syncing connected services…');
    const connected = accounts.filter((item) => item.status === 'connected');
    const results = await Promise.all(connected.map((item) => gateway.sync(item.id).then((updated) => ({ ok: true as const, updated })).catch(() => ({ ok: false as const, id: item.id }))));
    if (!mountedRef.current) return;
    setAccounts((current) => current.map((item) => {
      const match = results.find((result) => (result.ok ? result.updated.id === item.id : result.id === item.id));
      return match?.ok ? match.updated : item;
    }));
    const failed = results.filter((result) => !result.ok).length;
    setSyncAllStatus(failed ? `${connected.length - failed} of ${connected.length} services synced.` : 'All connected services are up to date.');
    setSyncingAll(false);
  };

  const confirmDisconnect = async () => {
    if (!disconnectTarget) return;
    if (!canMutate) return;
    setMutationPending(true);
    try {
      const updated = await gateway.disconnect(disconnectTarget);
      if (!mountedRef.current) return;
      setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setDisconnectTarget(null);
    } catch (error) {
      handleError(error);
    } finally {
      if (mountedRef.current) setMutationPending(false);
    }
  };

  const saveCalendarSelection = async () => {
    if (!canMutate) return;
    setMutationPending(true);
    setCalendarSaveStatus('Saving calendar sources…');
    try {
      const saved = await gateway.saveCalendarSelection(calendarSelection);
      if (!mountedRef.current) return;
      setCalendarSources(saved);
      setCalendarSaveStatus('Calendar sources saved.');
    } catch (error) {
      if (!mountedRef.current) return;
      setCalendarSaveStatus('Calendar sources could not be saved. Your selection is still here; retry when the service is available.');
    } finally {
      if (mountedRef.current) setMutationPending(false);
    }
  };

  const requestFollowUp = (label: string, action: string) => {
    host.onRequestFollowUp?.({ screen: 'integrations', label, action });
  };

  const calendar = account('google-calendar');
  const gmail = account('gmail');
  const planningCenter = account('planning-center');

  return (
    <ScreenRoot screenName="Integrations" testId="rhythm-integrations-screen">
      <section className="page-shell pg-integrations" aria-busy={surfaceState === 'loading'}>
        <header className="integrations-header">
          <div><h1>Integrations</h1><p>Bring trusted schedule and inbox context into Rhythm, then keep each provider in sync.</p></div>
          <div className="integrations-header-meta"><span data-testid="integrations-connected-count"><strong>{connectedCount}</strong> / 3 connected</span></div>
          {showsWorkspace && <button className="primary-button" type="button" onClick={() => void syncAll()} disabled={syncingAll || connectedCount === 0 || mutationPending || !canMutate} data-testid="integrations-sync-all">{syncingAll ? 'Syncing…' : 'Sync all'}</button>}
        </header>
        {!canMutate && <p role="status" data-testid="integrations-read-only">You can inspect connections, but this account cannot change integration settings.</p>}

        {!showsWorkspace && <StatePanel state={surfaceState} onRetry={() => void load()} onConnect={() => requestConnect('google-calendar')} />}

        {showsWorkspace && (
          <div className="integrations-workspace">
            <div className="integrations-provider-list" aria-label="Providers">
              {PROVIDER_IDS.map((id) => {
                const item = account(id);
                return (
                  <section className="integrations-provider-row" key={id} aria-current={selectedSection === id ? 'true' : undefined} data-testid={`integration-${id}`}>
                    <button className="integrations-provider-select" type="button" onClick={() => setSelectedSection(id)} data-testid={`integration-select-${id}`}>
                      <span><strong>{item.name}</strong><small>{item.identity ?? 'No account identity available'}</small>{item.errorMessage && <em>{item.errorMessage}</em>}</span>
                      <span className="integrations-status" data-testid={`integration-status-${id}`}>{statusLabel(item)}</span>
                    </button>
                    <div className="integrations-provider-actions">
                      {item.status === 'connected' && <button className="secondary-button" type="button" disabled={providerBusy !== null || !canMutate} onClick={() => void syncProvider(id)} data-testid={`integration-sync-${id}`}>{providerBusy === id ? 'Syncing…' : 'Sync'}</button>}
                      {item.status === 'disconnected'
                        ? <button className="secondary-button" type="button" disabled={!canMutate} onClick={() => requestConnect(id)} data-testid={`integration-connect-${id}`}>Connect</button>
                        : <button className="secondary-button" type="button" disabled={!canMutate} onClick={() => requestConnect(id)} data-testid={`integration-reconnect-${id}`}>Reconnect</button>}
                      {item.status !== 'disconnected' && <button className="text-danger-button" type="button" disabled={!canMutate} onClick={() => setDisconnectTarget(id)} data-testid={`integration-disconnect-${id}`}>Disconnect</button>}
                    </div>
                    <p role="status" aria-live="polite" className="integrations-provider-live" data-testid={`integration-sync-status-${id}`}>{providerStatus[id]}</p>
                  </section>
                );
              })}
              <div className="integrations-utility-list">
                <section data-testid="integration-assistant-tools">
                  <button type="button" onClick={() => setSelectedSection('assistant-tools')} data-testid="integration-select-assistant-tools">
                    <span>Assistant access</span><small>Full Google Calendar and Gmail access for agent actions, including read + send.</small>
                  </button>
                </section>
              </div>
            </div>

            <aside className="integrations-provider-inspector" aria-label="Provider inspector" data-testid="integration-inspector">
              {selectedSection === 'google-calendar' && (
                <section aria-labelledby="google-calendar-title">
                  <header><h2 id="google-calendar-title">Google Calendar</h2><p>{calendar.identity ?? 'No account identity available'} · {statusLabel(calendar)}</p></header>
                  {calendar.status === 'connected' ? (
                    <div className="integrations-detail">
                      <div className="integrations-section-heading">
                        <div><h3>Calendar sources</h3><p>Choose subscribed calendars that can create shadow-event context.</p></div>
                        <div className="integrations-inline-actions">
                          <button className="text-button" type="button" disabled={!canMutate} onClick={() => setCalendarSelection(calendarSources.map((source) => source.id))} data-testid="integration-calendar-select-all">All</button>
                          <button className="text-button" type="button" disabled={!canMutate} onClick={() => setCalendarSelection([])} data-testid="integration-calendar-select-none">None</button>
                        </div>
                      </div>
                      <p data-testid="integration-calendar-summary">{calendarSelection.length} of {calendarSources.length} selected</p>
                      <div className="integrations-calendar-list">
                        {calendarSources.map((source) => (
                          <label key={source.id}>
                            <input type="checkbox" disabled={!canMutate} checked={calendarSelection.includes(source.id)} onChange={() => setCalendarSelection((current) => current.includes(source.id) ? current.filter((id) => id !== source.id) : [...current, source.id])} data-testid={`integration-calendar-option-${source.id}`} />
                            <span><strong>{source.name}</strong><small>{source.description}</small></span>
                            {source.primary && <em>Primary</em>}
                          </label>
                        ))}
                      </div>
                      <div className="integrations-save-row">
                        <span role="status" aria-live="polite" data-testid="integration-calendar-save-status">{calendarSaveStatus}</span>
                        <button className="primary-button" type="button" disabled={mutationPending || !canMutate} onClick={() => void saveCalendarSelection()} data-testid="integration-calendar-save">Save sources</button>
                      </div>
                    </div>
                  ) : (
                    <div className="integrations-prerequisite" data-testid="integration-calendar-prerequisite"><strong>Calendar settings unavailable</strong><span>Connect Google with Calendar permission to choose sources.</span></div>
                  )}
                </section>
              )}

              {selectedSection === 'gmail' && (
                <section aria-labelledby="gmail-title">
                  <header><h2 id="gmail-title">Gmail</h2><p>{gmail.identity ?? 'No account identity available'} · {statusLabel(gmail)}</p></header>
                  <div className="integrations-detail">
                    <div className="integrations-section-heading">
                      <div><h3>Recent inbox signals</h3><p>Up to five unique threads. This metadata connection does not grant assistant mailbox authority.</p></div>
                      {gmail.status === 'connected' && <strong data-testid="integration-gmail-unread-count">{uniqueSignals(gmailSignals).filter((signal) => signal.unread).length} unread</strong>}
                    </div>
                    {gmail.status === 'connected' ? (
                      <ol className="integrations-signal-list" data-testid="integration-gmail-signals-list">
                        {uniqueSignals(gmailSignals).slice(0, 5).map((signal) => (
                          <li key={signal.id} data-testid={`integration-gmail-signal-${signal.threadId}`} className={signal.unread ? 'is-unread' : ''}>
                            <div><strong>{signal.subject || '(No subject)'}</strong><small>{signal.sender || 'Unknown sender'}</small>{signal.snippet && <p>{signal.snippet}</p>}</div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div className="integrations-prerequisite" data-testid="integration-gmail-prerequisite"><strong>No inbox signals yet</strong><span>Connect Gmail and sync once to read recent signal metadata.</span></div>
                    )}
                  </div>
                </section>
              )}

              {selectedSection === 'planning-center' && (
                <section aria-labelledby="planning-center-title">
                  <header><h2 id="planning-center-title">Planning Center</h2><p>{planningCenter.identity ?? 'No account identity available'} · {statusLabel(planningCenter)}</p></header>
                  {planningCenter.status === 'connected' ? (
                    <div className="integrations-detail"><p>Connected. Task-filter preferences are managed in Planning Center.</p></div>
                  ) : (
                    <div className="integrations-prerequisite" data-testid="integration-planning-center-prerequisite"><strong>Planning Center is locked</strong><span>Connect Planning Center to bring plan and volunteer signals into Rhythm.</span></div>
                  )}
                </section>
              )}

              {selectedSection === 'assistant-tools' && (
                <section aria-labelledby="assistant-tools-title">
                  <header><h2 id="assistant-tools-title">Google tools for the assistant</h2><p>Grant the assistant full Google Calendar and Gmail access for agent actions, including read + send. This is broader than the Gmail metadata connection.</p></header>
                  <button className="secondary-button" type="button" onClick={() => requestFollowUp('Enable assistant Google tools', 'assistant-google-enable')} data-testid="integration-assistant-enable">Enable</button>
                </section>
              )}
            </aside>
          </div>
        )}

        <p className="integrations-sync-all-status" role="status" aria-live="polite" data-testid="integrations-sync-all-status">{syncAllStatus}</p>
      </section>

      <FocusDialog open={Boolean(handoff)} onClose={() => setHandoff(null)} title={handoff?.label ?? 'Authorization handoff'} description="Rhythm hands this request to the host application; it never builds or follows an authorization URL itself." testId="integration-handoff-dialog">
        <p>The host application will continue the {handoff ? PROVIDER_NAMES[handoff.provider as IntegrationProviderId] ?? 'provider' : ''} connection from here.</p>
        <div className="dialog-actions"><button className="primary-button" type="button" onClick={() => setHandoff(null)} data-testid="integration-handoff-close">Return to integrations</button></div>
      </FocusDialog>

      <FocusDialog open={Boolean(disconnectTarget)} onClose={() => setDisconnectTarget(null)} title={disconnectTarget ? `Disconnect ${PROVIDER_NAMES[disconnectTarget]}?` : 'Disconnect provider?'} description="This removes the connection. You can reconnect at any time." testId="integration-disconnect-dialog">
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={() => setDisconnectTarget(null)} data-testid="integration-disconnect-cancel">Cancel</button>
          <button className="danger-button" type="button" disabled={mutationPending || !canMutate} onClick={() => void confirmDisconnect()} data-testid="integration-disconnect-confirm">Disconnect</button>
        </div>
      </FocusDialog>
    </ScreenRoot>
  );
}
