import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FocusDialog } from '../../components/FocusDialog';
import { navigate } from '../../components/Shell';
import { useFixtures } from '../../store';
import { useGateway } from '../../gateway/context';
import {
  IntegrationsGatewayError,
  type GoogleCalendarSettings,
  type GmailSignal as ServerGmailSignal,
  type IntegrationAccount as ServerIntegrationAccount,
  type IntegrationAuthorization,
  type IntegrationProvider as CanonicalProvider,
  type IntegrationsGateway,
  type PlanningCenterTaskOptions,
} from '../../gateway/integrations';
import {
  accountStateAccounts,
  calendarSources,
  disconnectedAccounts,
  gmailSignals,
  importPrompt,
  initialReadyReceipts,
  planningTeams,
  readyAccounts,
  selectedCalendarIds as seededCalendarIds,
  type IntegrationAccount,
  type ProviderId,
} from './fixtures';
import './styles.css';

// Canonical IntegrationProvider values — apps/api_server/src/models/integration_account.ts:1-4.
// This page's ProviderId (fixtures.ts:1) is a display/route identifier and stays hyphenated
// deliberately (contract post-m1-p3-c1i); only the boundary below translates between the two.
const DISPLAY_TO_CANONICAL: Record<ProviderId, CanonicalProvider> = {
  'google-calendar': 'google_calendar', gmail: 'gmail', 'planning-center': 'planning_center',
};
const providerNames: Record<ProviderId, string> = { 'google-calendar': 'Google Calendar', gmail: 'Gmail', 'planning-center': 'Planning Center' };
const providerMonograms: Record<ProviderId, string> = { 'google-calendar': 'GC', gmail: 'GM', 'planning-center': 'PC' };
const displayProviderIds: ProviderId[] = ['google-calendar', 'gmail', 'planning-center'];

function mapLiveAccounts(serverAccounts: ServerIntegrationAccount[]): IntegrationAccount[] {
  return displayProviderIds.map((id) => {
    const canonical = DISPLAY_TO_CANONICAL[id];
    const match = serverAccounts.find((account) => account.provider === canonical);
    if (!match) return { id, name: providerNames[id], monogram: providerMonograms[id], status: 'disconnected' };
    return {
      id, name: providerNames[id], monogram: providerMonograms[id],
      status: match.needsReauth ? 'needs_reauth' : match.status,
      identity: match.email ?? match.displayName ?? undefined,
      lastSyncedAt: match.lastSyncedAt ?? undefined,
      errorMessage: match.errorMessage ?? undefined,
    };
  });
}

function InspectorPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Element | null>(null);
  useEffect(() => { const next = document.querySelector("[data-testid='integration-inspector']"); setTarget((current) => current === next ? current : next); });
  return target ? createPortal(children, target) : null;
}

type PageState = 'ready' | 'loading' | 'empty' | 'server-error' | 'forbidden' | 'unavailable' | 'readonly';
type FixtureName = 'ready' | 'account-states' | 'disconnected' | 'calendar-save-error' | 'gmail-sync-error' | 'sync-partial' | 'import-partial';
type Handoff = { title: string; service: string; receipt: string };
type ImportRecord = Record<string, unknown>;
type ImportPlan = { tasks: ImportRecord[]; rhythms: ImportRecord[]; projects: ImportRecord[] };

const supportedStates: PageState[] = ['ready', 'loading', 'empty', 'server-error', 'forbidden', 'unavailable', 'readonly'];
const supportedSections = new Set(['google-calendar', 'gmail', 'planning-center', 'assistant-tools', 'import']);

function queryParams() {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

function seededState(): PageState {
  const requested = queryParams().get('state');
  return supportedStates.includes(requested as PageState) ? requested as PageState : 'ready';
}

function seededFixture(): FixtureName {
  const requested = queryParams().get('fixture') as FixtureName | null;
  return requested && ['account-states', 'disconnected', 'calendar-save-error', 'gmail-sync-error', 'sync-partial', 'import-partial'].includes(requested) ? requested : 'ready';
}

function writeState(next: PageState) {
  const hashPath = window.location.hash.split('?')[0] || '#/integrations';
  const params = queryParams();
  params.set('state', next);
  history.replaceState(null, '', `${hashPath}?${params.toString()}`);
}

function uniqueSignals() {
  const seen = new Set<string>();
  return gmailSignals.filter((signal) => {
    if (seen.has(signal.threadId)) return false;
    seen.add(signal.threadId);
    return true;
  }).slice(0, 5);
}

function statusLabel(account: IntegrationAccount) {
  if (account.status === 'connected') return 'Connected';
  if (account.status === 'needs_reauth') return 'Permission required';
  if (account.status === 'error') return 'Needs attention';
  return 'Not connected';
}

function loadReceipts(accounts: IntegrationAccount[]) {
  const receipts = [initialReadyReceipts[0]];
  if (accounts.some((item) => item.id === 'google-calendar' && item.status === 'connected')) receipts.push(initialReadyReceipts[1]);
  if (accounts.some((item) => item.id === 'gmail' && item.status === 'connected')) receipts.push(initialReadyReceipts[2]);
  if (accounts.some((item) => item.id === 'planning-center' && item.status === 'connected')) receipts.push(initialReadyReceipts[3]);
  return receipts;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function StatePanel({ state, onRetry, onConnect }: { state: Exclude<PageState, 'ready' | 'readonly'>; onRetry(): void; onConnect(): void }) {
  const copy = {
    loading: ['Loading integrations', 'Reading connected accounts and their provider settings.'],
    empty: ['No integrations connected', 'Connect Google to begin bringing calendar and inbox context into Rhythm.'],
    'server-error': ['Integrations could not be loaded', 'The local integration service returned a temporary error. Your fixture data is unchanged.'],
    forbidden: ['Integration access is restricted', 'An authenticated Rhythm workspace session with integration access is required.'],
    unavailable: ['Local integration service unavailable', 'Start the local Rhythm integration service or local Rhythm API before managing connections.'],
  }[state];
  return <div className={`tool-state-panel pg-integrations-state ${state === 'server-error' ? 'error' : state === 'forbidden' || state === 'unavailable' ? 'warning' : ''}`} role={state === 'loading' ? 'status' : state === 'server-error' || state === 'forbidden' ? 'alert' : undefined} aria-live={state === 'loading' ? 'polite' : undefined} data-testid={`page-state-${state}`}>
    <span className="pg-integrations-state-mark" aria-hidden="true">{state === 'loading' ? '···' : state === 'server-error' ? '503' : state === 'forbidden' ? '403' : state === 'unavailable' ? 'OFF' : '0'}</span>
    <span className="eyebrow">{state === 'empty' ? 'First connection' : state.replace('-', ' ')}</span>
    <h2>{copy[0]}</h2><p>{copy[1]}</p>
    {state === 'server-error' && <button className="primary-button" type="button" onClick={onRetry} data-testid="page-retry">Retry</button>}
    {state === 'empty' && <button className="primary-button" type="button" onClick={onConnect} data-testid="integrations-empty-connect-google">Connect Google</button>}
  </div>;
}

function TraceLedger({ receipts }: { receipts: string[] }) {
  return <aside className="pg-integrations-ledger" aria-labelledby="integrations-trace-title">
    <header><div><span className="eyebrow">Fixture receipts</span><h2 id="integrations-trace-title">Endpoint trace</h2></div><strong>{receipts.length}</strong></header>
    <ol aria-live="polite" data-testid="page-trace">{receipts.map((receipt, index) => <li key={`${index}-${receipt}`}><code>{receipt}</code></li>)}</ol>
  </aside>;
}

export function IntegrationsPage({ route }: { route: string }) {
  const { notify } = useFixtures();
  const rendererGateway = useGateway();
  const isLive = rendererGateway.mode === 'live';
  const fixture = seededFixture();
  const section = route.replace(/^\/integrations\/?/, '').split('/')[0];
  const [pageState, setPageState] = useState<PageState>(() => isLive ? 'loading' : seededState());
  const [selectedSection, setSelectedSection] = useState(() => section && supportedSections.has(section) && section !== 'import' ? section : 'google-calendar');
  const fixtureAccounts = fixture === 'account-states' ? accountStateAccounts : fixture === 'disconnected' ? disconnectedAccounts : readyAccounts;
  // No fixture fallback in live mode: starts empty (every provider reads as disconnected via the
  // account() lookup fallback below) until a real GET /integrations/accounts response arrives.
  const [liveAccounts, setLiveAccounts] = useState<IntegrationAccount[]>([]);
  const accounts = isLive ? liveAccounts : (pageState === 'empty' ? disconnectedAccounts : fixtureAccounts);
  const account = (id: ProviderId) => accounts.find((item) => item.id === id) ?? disconnectedAccounts.find((item) => item.id === id)!;
  const connectedCount = accounts.filter((item) => item.status === 'connected').length;
  const [receipts, setReceipts] = useState<string[]>(() => isLive ? [] : (pageState === 'ready' || pageState === 'readonly' ? loadReceipts(fixtureAccounts) : []));
  const [calendarSelection, setCalendarSelection] = useState<string[]>(seededCalendarIds);
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [calendarSaveError, setCalendarSaveError] = useState('');
  const [calendarSaveStatus, setCalendarSaveStatus] = useState('');
  const [calendarSaveFailedOnce, setCalendarSaveFailedOnce] = useState(false);
  const [providerSyncing, setProviderSyncing] = useState<ProviderId | null>(null);
  const [providerStatus, setProviderStatus] = useState<Partial<Record<ProviderId, string>>>({});
  const [gmailFailedOnce, setGmailFailedOnce] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncAllPartial, setSyncAllPartial] = useState(false);
  const [syncAllStatus, setSyncAllStatus] = useState('');
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [pcoOptionsLoaded, setPcoOptionsLoaded] = useState(false);
  const [savedTeams, setSavedTeams] = useState<string[]>([]);
  const [savedPositions, setSavedPositions] = useState<string[]>([]);
  const [draftTeams, setDraftTeams] = useState<string[]>([]);
  const [draftPositions, setDraftPositions] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(route === '/integrations/import');
  const [importStep, setImportStep] = useState<'prompt' | 'paste'>('prompt');
  const [copyStatus, setCopyStatus] = useState('');
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState('');
  const [importPartial, setImportPartial] = useState('');
  const [pendingImport, setPendingImport] = useState<ImportPlan | null>(null);
  const [importedCounts, setImportedCounts] = useState({ tasks: 0, rhythms: 0, projects: 0 });
  const unknownSection = Boolean(section && !supportedSections.has(section));
  // The renderer gateway (useGateway()) is composed once in main.tsx and shares one bearer across
  // every domain (apps/web/src/gateway/index.ts:87-106) — this page only ever reads
  // rendererGateway.domains.integrations, never constructs its own instance or token.
  const liveGateway = rendererGateway.domains.integrations ?? null;
  const [liveCalendarSettings, setLiveCalendarSettings] = useState<GoogleCalendarSettings | null>(null);
  const [liveGmailSignals, setLiveGmailSignals] = useState<ServerGmailSignal[]>([]);
  const [livePcoOptions, setLivePcoOptions] = useState<PlanningCenterTaskOptions | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  const calendarOptions = isLive
    ? (liveCalendarSettings?.calendars.map((source) => ({ id: source.id, name: source.name, description: source.isPrimary ? 'Primary calendar' : '', primary: source.isPrimary })) ?? [])
    : calendarSources;
  const pcoTeams = isLive
    ? (livePcoOptions?.teams.map((team) => ({ id: team.id, name: team.name, positions: livePcoOptions.positionsByTeamId[team.id] ?? [] })) ?? [])
    : planningTeams;
  const displaySignals = isLive ? liveGmailSignals.slice(0, 5).map((signal) => ({ id: signal.id, threadId: signal.threadId, subject: signal.subject ?? undefined, sender: signal.fromName ?? signal.fromEmail ?? undefined, snippet: signal.snippet ?? undefined, unread: signal.isUnread })) : undefined;
  const visibleSignals = useMemo(() => displaySignals ?? uniqueSignals(), [displaySignals]);
  const availablePositions = useMemo(() => {
    const teams = draftTeams.length ? pcoTeams.filter((team) => draftTeams.includes(team.id)) : pcoTeams;
    return [...new Set(teams.flatMap((team) => team.positions))].sort();
  }, [draftTeams, pcoTeams]);

  const appendReceipt = (receipt: string) => setReceipts((current) => [...current, receipt]);
  const replaceState = (next: PageState) => { setPageState(next); writeState(next); };

  const recordIntegrationsError = (method: string, path: string, error: unknown) => {
    const status = error instanceof IntegrationsGatewayError ? error.status : 0;
    appendReceipt(`${method} ${path} → ${status || 'network error'}`);
    setPageState(status === 401 || status === 403 ? 'forbidden' : status === 404 ? 'unavailable' : 'server-error');
  };

  const loadLiveAccounts = async (gateway: IntegrationsGateway) => {
    setPageState('loading');
    try {
      const serverAccounts = await gateway.accounts();
      setLiveAccounts(mapLiveAccounts(serverAccounts));
      appendReceipt('GET /integrations/accounts → 200');
      setPageState('ready');
    } catch (error) { recordIntegrationsError('GET', '/integrations/accounts', error); }
  };

  useEffect(() => {
    if (!isLive) return;
    if (!liveGateway) { setPageState('unavailable'); return; }
    void loadLiveAccounts(liveGateway);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, liveGateway]);

  const retryLiveLoad = () => { if (liveGateway) void loadLiveAccounts(liveGateway); };

  useEffect(() => {
    if (!section || section === 'import' || unknownSection) return;
    setSelectedSection(section);
  }, [section, unknownSection]);

  useEffect(() => {
    if (route === '/integrations/import') setImportOpen(true);
  }, [route]);

  useEffect(() => {
    if (selectedSection !== 'planning-center' || account('planning-center').status !== 'connected') return;
    if (isLive) {
      if (!liveGateway || pcoOptionsLoaded) return;
      setPcoOptionsLoaded(true);
      void Promise.all([liveGateway.planningCenterTaskPreferences(), liveGateway.planningCenterTaskOptions()]).then(([preferences, options]) => {
        appendReceipt('GET /integrations/planning-center/task-preferences → 200');
        appendReceipt('GET /integrations/planning-center/task-options → 200');
        setSavedTeams(preferences.teamIds); setSavedPositions(preferences.positionNames);
        setDraftTeams(preferences.teamIds); setDraftPositions(preferences.positionNames);
        setLivePcoOptions(options);
      }).catch((error) => recordIntegrationsError('GET', '/integrations/planning-center/task-preferences', error));
      return;
    }
    if (!pcoOptionsLoaded) { appendReceipt('GET /integrations/planning-center/task-options → 200'); setPcoOptionsLoaded(true); }
    setDraftTeams((current) => current.length ? current : [...savedTeams]);
    setDraftPositions((current) => current.length ? current : [...savedPositions]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, liveGateway, pcoOptionsLoaded, savedPositions, savedTeams, selectedSection]);

  useEffect(() => {
    if (!isLive || selectedSection !== 'google-calendar' || account('google-calendar').status !== 'connected' || liveCalendarSettings || !liveGateway) return;
    void liveGateway.googleCalendarSettings().then((settings) => {
      appendReceipt('GET /integrations/google-calendar/settings → 200');
      setLiveCalendarSettings(settings);
      setCalendarSelection(settings.selectedCalendarIds);
    }).catch((error) => recordIntegrationsError('GET', '/integrations/google-calendar/settings', error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, liveGateway, liveCalendarSettings, selectedSection]);

  useEffect(() => {
    if (!isLive || selectedSection !== 'gmail' || account('gmail').status !== 'connected' || liveGmailSignals.length || !liveGateway) return;
    void liveGateway.gmailSignals().then((signals) => {
      appendReceipt('GET /integrations/gmail/signals → 200');
      setLiveGmailSignals(signals);
    }).catch((error) => recordIntegrationsError('GET', '/integrations/gmail/signals', error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, liveGateway, liveGmailSignals.length, selectedSection]);

  const openHandoff = (kind: 'google' | 'planning-center' | 'assistant') => {
    if (isLive) {
      if (!liveGateway) return;
      const authKind: IntegrationAuthorization = kind === 'planning-center' ? 'planning_center' : kind === 'assistant' ? 'google_agent' : 'google';
      window.location.href = liveGateway.authorizationUrl(authKind);
      return;
    }
    const next = kind === 'planning-center'
      ? { title: 'Planning Center authorization', service: 'Planning Center', receipt: 'GET /auth/planning-center/begin?sessionToken=fixture-session → 302 FIXTURE HANDOFF' }
      : kind === 'assistant'
        ? { title: 'Assistant Google tools authorization', service: 'Assistant Google tools', receipt: 'GET /auth/google/begin?intent=agent&sessionToken=fixture-session → 302 FIXTURE HANDOFF' }
        : { title: 'Google authorization', service: 'Google', receipt: 'GET /auth/google/begin?sessionToken=fixture-session → 302 FIXTURE HANDOFF' };
    appendReceipt(next.receipt);
    setHandoff(next);
  };

  const syncProvider = (id: ProviderId, retry = false) => {
    setProviderSyncing(id);
    setProviderStatus((current) => ({ ...current, [id]: `Syncing ${account(id).name}…` }));
    if (isLive) {
      if (!liveGateway) { setProviderSyncing(null); return; }
      const call = id === 'google-calendar' ? liveGateway.syncGoogleCalendar : id === 'gmail' ? liveGateway.syncGmail : liveGateway.syncPlanningCenter;
      void call.call(liveGateway).then(async () => {
        appendReceipt(`POST /integrations/${id}/sync → 200`);
        const serverAccounts = await liveGateway.accounts();
        setLiveAccounts(mapLiveAccounts(serverAccounts));
        appendReceipt('GET /integrations/accounts → 200');
        setProviderStatus((current) => ({ ...current, [id]: `${providerNames[id]} Synced.` }));
      }).catch((error) => {
        const status = error instanceof IntegrationsGatewayError ? error.status : 0;
        appendReceipt(`POST /integrations/${id}/sync → ${status || 'network error'}`);
        setProviderStatus((current) => ({ ...current, [id]: `${providerNames[id]} could not sync. Existing data was kept.` }));
      }).finally(() => setProviderSyncing(null));
      return;
    }
    const shouldFail = id === 'gmail' && fixture === 'gmail-sync-error' && !gmailFailedOnce && !retry;
    appendReceipt(`POST /integrations/${id}/sync → ${shouldFail ? '503' : '200'}`);
    window.setTimeout(() => {
      setProviderSyncing(null);
      if (shouldFail) {
        setGmailFailedOnce(true);
        setProviderStatus((current) => ({ ...current, [id]: 'Gmail could not sync. Existing inbox signals were kept.' }));
      } else {
        loadReceipts(accounts).forEach(appendReceipt);
        setProviderStatus((current) => ({ ...current, [id]: `${account(id).name} Synced.` }));
      }
    }, 140);
  };

  const saveCalendar = (retry = false) => {
    setCalendarSaving(true); setCalendarSaveError(''); setCalendarSaveStatus('Saving calendar sources…');
    const sorted = [...calendarSelection].sort();
    if (isLive) {
      if (!liveGateway) return;
      void liveGateway.saveGoogleCalendarPreferences({ selectedCalendarIds: sorted }).then(async (saved) => {
        appendReceipt(`PUT /integrations/google-calendar/preferences {selectedCalendarIds:${JSON.stringify(sorted)}} → 200`);
        setCalendarSelection(saved.selectedCalendarIds);
        await liveGateway.syncGoogleCalendar();
        appendReceipt('POST /integrations/google-calendar/sync → 200');
        const serverAccounts = await liveGateway.accounts();
        setLiveAccounts(mapLiveAccounts(serverAccounts));
        appendReceipt('GET /integrations/accounts → 200');
        setCalendarSaving(false);
        setCalendarSaveStatus('Calendar sources saved and synced.');
        notify('Calendar sources saved and synced');
      }).catch((error) => {
        setCalendarSaving(false);
        const status = error instanceof IntegrationsGatewayError ? error.status : 0;
        appendReceipt(`PUT /integrations/google-calendar/preferences {selectedCalendarIds:${JSON.stringify(sorted)}} → ${status || 'network error'}`);
        setCalendarSaveError('Calendar sources could not be saved. Your selection is still here.');
      });
      return;
    }
    const shouldFail = fixture === 'calendar-save-error' && !calendarSaveFailedOnce && !retry;
    appendReceipt(`PUT /integrations/google-calendar/preferences {selectedCalendarIds:${JSON.stringify(sorted.filter((id) => calendarSources.some((source) => source.id === id)))}} → ${shouldFail ? '503' : '200'}`);
    window.setTimeout(() => {
      setCalendarSaving(false);
      if (shouldFail) {
        setCalendarSaveFailedOnce(true); setCalendarSaveError('Calendar sources could not be saved. Your selection is still here.'); setCalendarSaveStatus('');
        return;
      }
      appendReceipt('GET /integrations/google-calendar/settings → 200');
      appendReceipt('POST /integrations/google-calendar/sync → 200');
      appendReceipt('GET /integrations/accounts → 200');
      setCalendarSaveStatus('Calendar sources saved and synced.');
      notify('Calendar sources saved and synced');
    }, 150);
  };

  const syncAll = () => {
    setSyncingAll(true); setSyncAllPartial(false); setSyncAllStatus('Syncing connected services…');
    if (isLive) {
      if (!liveGateway) return;
      void liveGateway.syncAll().then(async () => {
        appendReceipt('POST /integrations/sync-all → 200');
        const serverAccounts = await liveGateway.accounts();
        setLiveAccounts(mapLiveAccounts(serverAccounts));
        appendReceipt('GET /integrations/accounts → 200');
        setSyncingAll(false);
        setSyncAllStatus('All connected services are up to date');
        notify('All integrations synced');
      }).catch((error) => {
        setSyncingAll(false);
        const status = error instanceof IntegrationsGatewayError ? error.status : 0;
        appendReceipt(`POST /integrations/sync-all → ${status || 'network error'}`);
        setSyncAllStatus('Some services could not be synced.');
      });
      return;
    }
    appendReceipt('POST /integrations/sync-all → 200');
    window.setTimeout(() => {
      setSyncingAll(false);
      loadReceipts(accounts).forEach(appendReceipt);
      if (fixture === 'sync-partial') { setSyncAllPartial(true); setSyncAllStatus('2 of 3 services synced.'); }
      else { setSyncAllStatus('All connected services are up to date'); notify('All integrations synced'); }
    }, 150);
  };

  const retryFailedSync = () => {
    setSyncingAll(true); setSyncAllStatus('Retrying Planning Center…');
    appendReceipt('POST /integrations/planning-center/sync → 200');
    window.setTimeout(() => { loadReceipts(accounts).forEach(appendReceipt); setSyncingAll(false); setSyncAllPartial(false); setSyncAllStatus('All connected services are up to date'); }, 140);
  };


  const toggleTeam = (id: string) => {
    setDraftTeams((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      const positions = next.length ? new Set(pcoTeams.filter((team) => next.includes(team.id)).flatMap((team) => team.positions)) : new Set(pcoTeams.flatMap((team) => team.positions));
      setDraftPositions((currentPositions) => currentPositions.filter((position) => positions.has(position)));
      return next;
    });
  };

  const savePcoPreferences = () => {
    const teams = [...draftTeams].sort(); const positions = [...draftPositions].sort();
    if (isLive) {
      if (!liveGateway) return;
      setMutationPending(true);
      void liveGateway.savePlanningCenterTaskPreferences({ teamIds: teams, positionNames: positions }).then((saved) => {
        setSavedTeams(saved.teamIds); setSavedPositions(saved.positionNames);
        appendReceipt(`PUT /integrations/planning-center/task-preferences {teamIds:${JSON.stringify(teams)},positionNames:${JSON.stringify(positions)}} → 200`);
        notify('Planning Center task filters saved');
      }).catch((error) => recordIntegrationsError('PUT', '/integrations/planning-center/task-preferences', error))
        .finally(() => setMutationPending(false));
      return;
    }
    setSavedTeams(teams); setSavedPositions(positions);
    appendReceipt(`PUT /integrations/planning-center/task-preferences {teamIds:${JSON.stringify(teams)},positionNames:${JSON.stringify(positions)}} → 200`);
    notify('Planning Center task filters saved');
  };

  const parseImport = (): ImportPlan | null => {
    if (!importJson.trim()) { setImportError('Paste the JSON first.'); return null; }
    let source = importJson.trim();
    if (source.startsWith('```')) source = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let parsed: unknown;
    try { parsed = JSON.parse(source); } catch { setImportError('Invalid JSON. Check the pasted response and try again.'); return null; }
    if (Array.isArray(parsed)) {
      return {
        tasks: parsed.filter((item): item is ImportRecord => Boolean(item && typeof item === 'object' && (item as ImportRecord).type === 'task')),
        rhythms: parsed.filter((item): item is ImportRecord => Boolean(item && typeof item === 'object' && (item as ImportRecord).type === 'recurring_rule')),
        projects: parsed.filter((item): item is ImportRecord => Boolean(item && typeof item === 'object' && (item as ImportRecord).type === 'project')),
      };
    }
    if (!parsed || typeof parsed !== 'object') { setImportError('Invalid JSON. Expected an object or typed array.'); return null; }
    const value = parsed as ImportRecord;
    for (const key of ['tasks', 'rhythms', 'projects'] as const) {
      if (key in value && !Array.isArray(value[key])) { setImportError(`"${key}" must be an array.`); return null; }
    }
    return { tasks: (value.tasks as ImportRecord[] | undefined) ?? [], rhythms: (value.rhythms as ImportRecord[] | undefined) ?? [], projects: (value.projects as ImportRecord[] | undefined) ?? [] };
  };

  const countMessage = (counts: { tasks: number; rhythms: number; projects: number }) => {
    const pieces: string[] = [];
    if (counts.tasks) pieces.push(`${counts.tasks} task${counts.tasks === 1 ? '' : 's'}`);
    if (counts.rhythms) pieces.push(`${counts.rhythms} rhythm${counts.rhythms === 1 ? '' : 's'}`);
    if (counts.projects) pieces.push(`${counts.projects} template${counts.projects === 1 ? '' : 's'}`);
    return pieces.length ? `Imported: ${pieces.join(', ')}` : 'Nothing to import';
  };

  // Canonical import literal: RecurringTaskRule.frequency is 'weekly' | 'monthly' | 'annual'
  // (apps/api_server/src/models/recurring_task_rule.ts:32); the import prompt above requests
  // exactly that set, and any stray "yearly" from an older pasted response is normalized here
  // rather than sent through unchanged.
  const normalizeFrequency = (value: unknown): 'weekly' | 'monthly' | 'annual' => {
    const text = String(value ?? '').toLowerCase();
    if (text === 'weekly' || text === 'monthly' || text === 'annual') return text;
    if (text === 'yearly') return 'annual';
    return 'weekly';
  };

  const runLiveImport = async (plan: ImportPlan, gateway: IntegrationsGateway) => {
    setMutationPending(true);
    const nextCounts = { ...importedCounts };
    const remaining: ImportPlan = { tasks: [], rhythms: [], projects: [] };
    for (const item of plan.tasks) {
      try {
        await gateway.importTask({ title: String(item.title ?? 'Imported task'), notes: item.notes != null ? String(item.notes) : undefined, dueDate: item.dueDate != null ? String(item.dueDate) : undefined });
        appendReceipt('POST /tasks {title,notes,scheduledDate,preferredAgent} → 201'); nextCounts.tasks += 1;
      } catch (error) {
        appendReceipt(`POST /tasks {title,notes,scheduledDate,preferredAgent} → ${error instanceof IntegrationsGatewayError ? error.status : 0 || 'network error'}`);
        remaining.tasks.push(item);
      }
    }
    for (const item of plan.rhythms) {
      try {
        await gateway.importRhythm({ title: String(item.title ?? 'Imported rhythm'), frequency: normalizeFrequency(item.frequency), dayOfWeek: typeof item.dayOfWeek === 'number' ? item.dayOfWeek : undefined });
        appendReceipt('POST /recurring-rules {title,frequency,dayOfWeek} → 201'); nextCounts.rhythms += 1;
      } catch (error) {
        appendReceipt(`POST /recurring-rules {title,frequency,dayOfWeek} → ${error instanceof IntegrationsGatewayError ? error.status : 0 || 'network error'}`);
        remaining.rhythms.push(item);
      }
    }
    for (const project of plan.projects) {
      const name = String(project.name ?? 'Imported project');
      try {
        const template = await gateway.importProjectTemplate({ name, description: project.description != null ? String(project.description) : undefined });
        appendReceipt('POST /project-templates {name,description} → 201'); nextCounts.projects += 1;
        const steps = Array.isArray(project.steps) ? project.steps as ImportRecord[] : [];
        for (const step of steps) {
          await gateway.addImportedProjectStep(template.id, { title: String(step.title ?? 'Step'), offsetDays: typeof step.offsetDays === 'number' ? step.offsetDays : 0, offsetDescription: step.offsetDescription != null ? String(step.offsetDescription) : undefined });
          appendReceipt(`POST /project-templates/${template.id}/steps {title,offsetDays,offsetDescription,sortOrder,assigneeId} → 201`);
        }
        appendReceipt('GET /project-templates → 200');
      } catch (error) {
        appendReceipt(`POST /project-templates {name,description} → ${error instanceof IntegrationsGatewayError ? error.status : 0 || 'network error'}`);
        remaining.projects.push(project);
      }
    }
    setImportedCounts(nextCounts);
    setMutationPending(false);
    const failed = remaining.tasks.length + remaining.rhythms.length + remaining.projects.length;
    const completedThisPass = plan.tasks.length + plan.rhythms.length + plan.projects.length - failed;
    if (failed) { setPendingImport(remaining); setImportPartial(`${completedThisPass} imported, ${failed} failed. Successful records will not be duplicated.`); return; }
    setPendingImport(null); setImportOpen(false); notify(countMessage(nextCounts));
  };

  const runImport = (plan: ImportPlan, retry = false) => {
    setImportError(''); setImportPartial('');
    if (isLive) {
      if (!liveGateway) return;
      void runLiveImport(plan, liveGateway);
      return;
    }
    const nextCounts = { ...importedCounts };
    const remaining: ImportPlan = { tasks: [], rhythms: [], projects: [] };
    plan.tasks.forEach(() => { appendReceipt('POST /tasks {title,notes,scheduledDate,preferredAgent} → 201'); nextCounts.tasks += 1; });
    plan.rhythms.forEach((item, index) => {
      const fail = fixture === 'import-partial' && !retry && index === 0;
      appendReceipt(`POST /recurring-rules {title,frequency,dayOfWeek} → ${fail ? '500' : '201'}`);
      if (fail) remaining.rhythms.push(item); else nextCounts.rhythms += 1;
    });
    plan.projects.forEach((project) => {
      const name = String(project.name ?? 'Imported project');
      const templateId = `template-${slug(name) || 'imported-project'}`;
      appendReceipt('POST /project-templates {name,description} → 201'); nextCounts.projects += 1;
      const steps = Array.isArray(project.steps) ? project.steps : [];
      steps.forEach(() => {
        appendReceipt(`POST /project-templates/${templateId}/steps {title,offsetDays,offsetDescription,sortOrder,assigneeId} → 201`);
        appendReceipt('GET /project-templates → 200');
      });
    });
    setImportedCounts(nextCounts);
    const failed = remaining.tasks.length + remaining.rhythms.length + remaining.projects.length;
    const completedThisPass = plan.tasks.length + plan.rhythms.length + plan.projects.length - failed;
    if (failed) { setPendingImport(remaining); setImportPartial(`${completedThisPass} imported, ${failed} failed. Successful records will not be duplicated.`); return; }
    setPendingImport(null); setImportOpen(false); notify(countMessage(nextCounts));
  };

  const submitImport = () => { const plan = parseImport(); if (plan) runImport(plan); };

  const providerActive = (id: string) => section === id ? 'true' : undefined;
  const calendar = account('google-calendar'); const gmail = account('gmail'); const pco = account('planning-center');
  // The route segment (`selectedSection`) is this page's hyphenated display/route identifier
  // (ProviderId, fixtures.ts:1); the canonical persisted value the API actually stores is the
  // underscored IntegrationProvider (apps/api_server/src/models/integration_account.ts:1-4), so the
  // stable id translates through the same DISPLAY_TO_CANONICAL map the live boundary uses.
  const selectedStableId = DISPLAY_TO_CANONICAL[selectedSection as ProviderId] as CanonicalProvider | undefined;

  return <section className="page-shell pg-integrations" data-testid="page-integrations" aria-labelledby="integrations-title" {...(selectedStableId ? { 'data-selected-stable-id': selectedStableId } : {})}>
    <header className="pg-integrations-page-header">
      <div><span className="eyebrow">Workspace connections</span><h1 id="integrations-title">Integrations</h1><p>Bring trusted schedule and inbox context into Rhythm, then keep each provider in sync.</p></div>
      <div className="pg-integrations-header-meta"><span><strong>{connectedCount}</strong> / 3 connected</span><small>Auto sync every 30 min</small></div>
      <label className="pg-integrations-state-picker">View state<select value={pageState} onChange={(event) => { const next = event.target.value as PageState; setReceipts(next === 'ready' || next === 'readonly' ? loadReceipts(fixtureAccounts) : []); replaceState(next); }} data-testid="integrations-state-select">{supportedStates.map((state) => <option key={state} value={state}>{state.replace('-', ' ')}</option>)}</select></label>
      {(pageState === 'ready' || pageState === 'readonly') && <button className="primary-button" type="button" onClick={syncAll} disabled={syncingAll || connectedCount === 0 || pageState === 'readonly'} aria-describedby={pageState === 'readonly' ? 'integrations-readonly-reason' : connectedCount === 0 ? 'sync-all-prerequisite' : undefined} data-testid="integrations-sync-all">{syncingAll ? 'Syncing…' : 'Sync all'}</button>}
    </header>

    <div className="pg-integrations-scroll" tabIndex={0} role="region" aria-label="Integration providers">
      {unknownSection ? <div className="tool-state-panel pg-integrations-state warning" role="alert" data-testid="integration-section-not-found"><span className="pg-integrations-state-mark" aria-hidden="true">404</span><span className="eyebrow">Unknown deep link</span><h2>Integration section not found</h2><p>The requested section is not part of the Integrations fixture.</p><button className="secondary-button" type="button" onClick={() => navigate('/integrations')} data-testid="integrations-back">Back to integrations</button></div>
        : pageState !== 'ready' && pageState !== 'readonly' ? <StatePanel state={pageState} onRetry={() => { if (isLive) retryLiveLoad(); else { setReceipts(loadReceipts(fixtureAccounts)); replaceState('ready'); } }} onConnect={() => openHandoff('google')} />
          : <>
            {pageState === 'readonly' && <div className="pg-integrations-readonly" id="integrations-readonly-reason" role="status" data-testid="page-state-readonly"><strong>Read-only integration access.</strong> Integration-management write access is required to connect, sync, or change preferences. Provider details remain inspectable.</div>}
            <p className="sr-only" id="sync-all-prerequisite">Connect at least one provider before syncing all.</p>
            <fieldset className="pg-integrations-mutations" disabled={pageState === 'readonly'} aria-disabled={pageState === 'readonly' ? 'true' : 'false'} aria-describedby={pageState === 'readonly' ? 'integrations-readonly-reason' : undefined} data-testid="integrations-mutations"><legend className="sr-only">Integration management controls</legend>
              <div className="pg-integrations-workspace">
                <div className="pg-integrations-provider-list" aria-label="Providers">
                  <header><span>Providers</span><strong>{connectedCount} connected</strong></header>
                  <section className="pg-integrations-provider-row" aria-current={selectedSection === 'google-calendar' ? 'true' : undefined} data-testid="integration-google-calendar" data-deep-link-active={providerActive('google-calendar')}>
                    <button className="pg-integrations-provider-select" type="button" onClick={() => setSelectedSection('google-calendar')} data-testid="integration-select-google-calendar"><span className={`pg-integrations-provider-mark is-${calendar.id}`} aria-hidden="true">{calendar.monogram}</span><span><strong>{calendar.name}</strong><small>{calendar.identity ?? 'No account identity available'}</small>{calendar.errorMessage && <em>{calendar.errorMessage}</em>}</span><span className={`pg-integrations-status is-${calendar.status}`} data-testid="integration-status-google-calendar">{statusLabel(calendar)}</span></button>
                    <div className="pg-integrations-provider-row-actions">{calendar.status === 'connected' ? <button className="secondary-button" type="button" onClick={() => { setSelectedSection('google-calendar'); syncProvider('google-calendar'); }} disabled={providerSyncing !== null} data-testid="google-calendar-sync">{providerSyncing === 'google-calendar' ? 'Syncing…' : 'Sync'}</button> : <button className="secondary-button" type="button" onClick={() => { setSelectedSection('google-calendar'); openHandoff('google'); }} data-testid={calendar.status === 'disconnected' ? 'google-calendar-connect' : 'google-calendar-reconnect'}>{calendar.status === 'disconnected' ? 'Connect' : 'Reconnect'}</button>}</div>
                  </section>
                  <section className="pg-integrations-provider-row" aria-current={selectedSection === 'gmail' ? 'true' : undefined} data-testid="integration-gmail" data-deep-link-active={providerActive('gmail')}>
                    <button className="pg-integrations-provider-select" type="button" onClick={() => setSelectedSection('gmail')} data-testid="integration-select-gmail"><span className={`pg-integrations-provider-mark is-${gmail.id}`} aria-hidden="true">{gmail.monogram}</span><span><strong>{gmail.name}</strong><small>{gmail.identity ?? 'No account identity available'}</small>{gmail.errorMessage && <em>{gmail.errorMessage}</em>}</span><span className={`pg-integrations-status is-${gmail.status}`} data-testid="integration-status-gmail">{statusLabel(gmail)}</span></button>
                    <div className="pg-integrations-provider-row-actions"><button className="secondary-button" type="button" onClick={() => { setSelectedSection('gmail'); openHandoff('google'); }} data-testid={gmail.status === 'connected' ? 'gmail-reconnect' : 'gmail-connect'}>{gmail.status === 'connected' ? 'Reconnect' : 'Connect'}</button>{gmail.status === 'connected' && <button className="secondary-button" type="button" onClick={() => { setSelectedSection('gmail'); syncProvider('gmail'); }} disabled={providerSyncing !== null} data-testid="gmail-sync">{providerSyncing === 'gmail' ? 'Syncing…' : 'Sync'}</button>}</div>
                  </section>
                  <section className="pg-integrations-provider-row" aria-current={selectedSection === 'planning-center' ? 'true' : undefined} data-testid="integration-planning-center" data-deep-link-active={providerActive('planning-center')}>
                    <button className="pg-integrations-provider-select" type="button" onClick={() => setSelectedSection('planning-center')} data-testid="integration-select-planning-center"><span className={`pg-integrations-provider-mark is-${pco.id}`} aria-hidden="true">{pco.monogram}</span><span><strong>{pco.name}</strong><small>{pco.identity ?? 'No account identity available'}</small>{pco.errorMessage && <em>{pco.errorMessage}</em>}</span><span className={`pg-integrations-status is-${pco.status}`} data-testid="integration-status-planning-center">{statusLabel(pco)}</span></button>
                    <div className="pg-integrations-provider-row-actions"><button className="secondary-button" type="button" onClick={() => { setSelectedSection('planning-center'); openHandoff('planning-center'); }} data-testid={pco.status === 'connected' ? 'planning-center-reconnect' : 'planning-center-connect'}>{pco.status === 'connected' ? 'Reconnect' : 'Connect'}</button>{pco.status === 'connected' && <button className="secondary-button" type="button" onClick={() => { setSelectedSection('planning-center'); syncProvider('planning-center'); }} disabled={providerSyncing !== null} data-testid="planning-center-sync">{providerSyncing === 'planning-center' ? 'Syncing…' : 'Sync'}</button>}</div>
                  </section>

                  <div className="pg-integrations-utility-list">
                    <section data-testid="integration-assistant-tools" data-deep-link-active={providerActive('assistant-tools')}><button type="button" onClick={() => setSelectedSection('assistant-tools')} data-testid="integration-select-assistant-tools"><span>Assistant access</span><small>Full Google Calendar and Gmail access for agent actions, including read + send.</small></button><button className="text-button" type="button" onClick={() => openHandoff('assistant')} data-testid="assistant-google-enable">Enable</button></section>
                    <section data-testid="integration-ai-import"><button type="button" onClick={() => { setImportStep('prompt'); setImportOpen(true); }} data-testid="open-ai-import"><span>AI Import</span><small>Import tasks, rhythms, and project templates from structured JSON.</small></button></section>
                  </div>
                </div>

                <aside className="pg-integrations-provider-inspector" aria-label="Provider inspector" data-testid="integration-inspector">
                  {selectedSection === 'google-calendar' && <section aria-labelledby="google-calendar-title"><header><span className="eyebrow">Provider details</span><h2 id="google-calendar-title">Google Calendar</h2><p>{calendar.identity ?? 'No account identity available'} · {statusLabel(calendar)}</p></header>{calendar.status === 'connected' ? <div className="pg-integrations-detail"><div className="pg-integrations-section-heading"><div><h3>Calendar sources</h3><p>Choose subscribed calendars that can create shadow-event context. Selecting none is valid.</p></div><div className="pg-integrations-inline-actions"><button className="text-button" type="button" onClick={() => setCalendarSelection(calendarOptions.map((source) => source.id))} data-testid="calendar-select-all">All</button><button className="text-button" type="button" onClick={() => setCalendarSelection([])} data-testid="calendar-select-none">None</button></div></div><p className="pg-integrations-summary" data-testid="calendar-selected-summary">{calendarSelection.length} of {calendarOptions.length} selected</p><div className="pg-integrations-calendar-list">{calendarOptions.map((source) => <label key={source.id}><input type="checkbox" checked={calendarSelection.includes(source.id)} onChange={() => setCalendarSelection((current) => current.includes(source.id) ? current.filter((id) => id !== source.id) : [...current, source.id])} data-testid={`calendar-option-${source.id}`} /><span><strong>{source.name}</strong><small>{source.description}</small></span>{source.primary && <em data-testid={`calendar-primary-${source.id}`}>Primary</em>}</label>)}</div><div className="pg-integrations-save-row"><span>{calendarSaveError && <span className="pg-integrations-inline-error" role="alert" data-testid="calendar-save-error">{calendarSaveError}</span>}{calendarSaveStatus && <span role="status" aria-live="polite" data-testid="calendar-save-status">{calendarSaveStatus}</span>}</span>{calendarSaveError && <button className="secondary-button" type="button" onClick={() => saveCalendar(true)} data-testid="calendar-save-retry">Retry save</button>}<button className="primary-button" type="button" onClick={() => saveCalendar()} disabled={calendarSaving} data-testid="calendar-save">{calendarSaving ? 'Saving…' : 'Save sources'}</button></div><p role="status" aria-live="polite" className="pg-integrations-live" data-testid="google-calendar-sync-status">{providerStatus['google-calendar']}</p></div> : <div className="pg-integrations-prerequisite"><strong>Calendar settings unavailable</strong><span>Connect Google with Calendar permission to choose sources.</span></div>}</section>}
                  {selectedSection === 'gmail' && <section aria-labelledby="gmail-title"><header><span className="eyebrow">Provider details</span><h2 id="gmail-title">Gmail</h2><p>{gmail.identity ?? 'No account identity available'} · {statusLabel(gmail)}</p></header><div className="pg-integrations-detail"><div className="pg-integrations-section-heading"><div><h3>Recent inbox signals</h3><p>Up to five unique threads, source ordered. This metadata connection does not grant assistant mailbox authority.</p></div>{gmail.status === 'connected' && <strong className="pg-integrations-unread" data-testid="gmail-unread-count">{visibleSignals.filter((signal) => signal.unread).length} unread</strong>}</div>{gmail.status === 'connected' ? <ol className="pg-integrations-signal-list" data-testid="gmail-signals-list">{visibleSignals.map((signal) => <li key={signal.id} data-testid={`gmail-signal-${signal.threadId}`} data-gmail-thread-id={signal.threadId} className={signal.unread ? 'is-unread' : ''}><span className="pg-integrations-signal-dot" role="img" aria-label={signal.unread ? 'Unread' : 'Read'} /><div><strong>{signal.subject || '(No subject)'}</strong><small>{signal.sender || 'Unknown sender'}</small>{signal.snippet && <p>{signal.snippet}</p>}</div></li>)}</ol> : <div className="pg-integrations-prerequisite" data-testid="gmail-signals-empty"><strong>No inbox signals yet</strong><span>Connect Gmail and sync once to read recent signal metadata.</span></div>}<div className="pg-integrations-save-row"><span role="status" aria-live="polite" data-testid="gmail-sync-status">{providerStatus.gmail}</span>{gmailFailedOnce && providerStatus.gmail?.includes('could not') && <button className="secondary-button" type="button" onClick={() => syncProvider('gmail', true)} data-testid="gmail-sync-retry">Retry Gmail</button>}</div></div></section>}
                  {selectedSection === 'planning-center' && <section aria-labelledby="planning-center-title"><header><span className="eyebrow">Provider details</span><h2 id="planning-center-title">Planning Center</h2><p>{pco.identity ?? 'No account identity available'} · {statusLabel(pco)}</p></header><div className="pg-integrations-detail"><div className="pg-integrations-section-heading"><div><h3>Task filters</h3><p>Limit imported assignment signals by team and position. Empty means no extra restriction.</p></div></div>{pco.status === 'connected' ? <div className="pg-integrations-preference-summary" data-testid="planning-center-preferences-summary"><span>Teams: {savedTeams.length ? `${savedTeams.length} selected` : 'All teams'}</span><span>Positions: {savedPositions.length ? `${savedPositions.length} selected` : 'All positions'}</span></div> : <div className="pg-integrations-prerequisite"><strong>Task filters unavailable</strong><span>Connect Planning Center before choosing assignment filters.</span></div>}<p role="status" aria-live="polite" className="pg-integrations-live" data-testid="planning-center-sync-status">{providerStatus['planning-center']}</p></div></section>}
                  {selectedSection === 'assistant-tools' && <section aria-labelledby="assistant-tools-title"><header><span className="eyebrow">Separate consent</span><h2 id="assistant-tools-title">Google tools for the assistant</h2><p>Grant the assistant full Google Calendar and Gmail access for agent actions, including read + send. This is broader than the Gmail metadata connection.</p></header></section>}
                </aside>
              </div>
            </fieldset>

            {selectedSection === 'planning-center' && pco.status === 'connected' && <InspectorPortal><section className="pg-integrations-direct-editor" aria-label="Edit Planning Center task filters" data-testid="planning-center-direct-editor"><div className="pg-integrations-pco-dialog"><section aria-labelledby="pco-teams-title"><div className="pg-integrations-dialog-heading"><div><span className="eyebrow">Step 1</span><h3 id="pco-teams-title">Teams</h3></div><span>{draftTeams.length || 'All'}</span></div><div className="pg-integrations-chip-grid">{pcoTeams.map((team) => <button className={draftTeams.includes(team.id) ? 'is-selected' : ''} type="button" aria-pressed={draftTeams.includes(team.id)} onClick={() => toggleTeam(team.id)} key={team.id} data-testid={`pco-team-${slug(team.name)}`}>{team.name}</button>)}</div></section><section aria-labelledby="pco-positions-title"><div className="pg-integrations-dialog-heading"><div><span className="eyebrow">Step 2</span><h3 id="pco-positions-title">Positions</h3></div><span>{draftPositions.length || 'All'}</span></div><div className="pg-integrations-chip-grid">{availablePositions.map((position) => <button className={draftPositions.includes(position) ? 'is-selected' : ''} type="button" aria-pressed={draftPositions.includes(position)} onClick={() => setDraftPositions((current) => current.includes(position) ? current.filter((item) => item !== position) : [...current, position])} key={position} data-testid={`pco-position-${slug(position)}`}>{position}</button>)}</div></section><footer className="pg-integrations-dialog-actions"><button className="text-button" type="button" onClick={() => { setDraftTeams([]); setDraftPositions([]); }} data-testid="planning-center-preferences-clear">Clear all</button><span /><button className="primary-button" type="button" onClick={savePcoPreferences} data-testid="planning-center-preferences-save">Save filters</button></footer></div></section></InspectorPortal>}

            {syncAllPartial && <div className="pg-integrations-partial" role="alert" data-testid="sync-all-partial"><div><strong>Sync completed with one provider error</strong><span>Google Calendar synced · Gmail synced · Planning Center failed</span></div><button className="secondary-button" type="button" onClick={retryFailedSync} disabled={syncingAll} data-testid="sync-all-retry-failed">Retry failed</button></div>}
            <p className="pg-integrations-sync-all-status" role="status" aria-live="polite" data-testid="sync-all-status">{syncAllStatus}</p>
          </>}
      <TraceLedger receipts={receipts} />
    </div>

    <FocusDialog open={Boolean(handoff)} onClose={() => setHandoff(null)} title={handoff?.title ?? 'Authorization handoff'} description="Review the connection details before continuing." testId="oauth-fixture-handoff">
      <div className="pg-integrations-handoff"><span className="pg-integrations-handoff-badge">FIXTURE HANDOFF</span><h3>{handoff?.service}</h3><p>Rhythm would hand this request to the operating system in the shipping app. Here it stops safely before any OAuth host or network request.</p><code>{handoff?.receipt}</code><button className="primary-button" type="button" onClick={() => setHandoff(null)} data-testid="oauth-handoff-close">Return to integrations</button></div>
    </FocusDialog>


    <FocusDialog open={importOpen} onClose={() => setImportOpen(false)} title="AI Import" description="Use any assistant separately, then paste JSON here. Rhythm never contacts it." testId="ai-import-dialog" wide>
      <div className="pg-integrations-import"><div className="pg-integrations-tabs" role="tablist" aria-label="AI Import steps"><button type="button" role="tab" aria-selected={importStep === 'prompt'} onClick={() => setImportStep('prompt')} data-testid="ai-import-prompt-tab">1 · Copy prompt</button><button type="button" role="tab" aria-selected={importStep === 'paste'} onClick={() => setImportStep('paste')} data-testid="ai-import-paste-tab">2 · Paste JSON</button></div>{importStep === 'prompt' ? <section aria-labelledby="import-prompt-title"><div className="pg-integrations-dialog-heading"><div><span className="eyebrow">Local prompt</span><h3 id="import-prompt-title">Ask for structured JSON</h3></div></div><pre>{importPrompt}</pre><div className="pg-integrations-dialog-actions"><button className="secondary-button" type="button" onClick={() => { setCopyStatus('Copied!'); notify('Import prompt copied'); }} data-testid="ai-import-copy-prompt">Copy prompt</button><span role="status" aria-live="polite" data-testid="ai-import-copy-status">{copyStatus}</span><span /><button className="primary-button" type="button" onClick={() => setImportStep('paste')} data-testid="ai-import-next">Next</button></div></section> : <section aria-labelledby="import-json-title"><div className="pg-integrations-dialog-heading"><div><span className="eyebrow">Structured input</span><h3 id="import-json-title">Paste JSON</h3></div></div><label className="pg-integrations-json-label" htmlFor="ai-import-json">Tasks, rhythms, and project templates JSON<textarea id="ai-import-json" rows={12} value={importJson} onChange={(event) => { setImportJson(event.target.value); setImportError(''); }} placeholder='{"tasks":[],"rhythms":[],"projects":[]}' data-autofocus data-testid="ai-import-json" /></label>{importError && <p className="pg-integrations-import-error" role="alert" data-testid="ai-import-error">{importError}</p>}{importPartial && <div className="pg-integrations-import-error" role="alert" data-testid="ai-import-partial-error"><strong>Import paused</strong><span>{importPartial}</span></div>}<div className="pg-integrations-dialog-actions"><button className="secondary-button" type="button" onClick={() => setImportOpen(false)} data-testid="ai-import-cancel">Cancel</button><span />{pendingImport ? <button className="primary-button" type="button" onClick={() => runImport(pendingImport, true)} data-testid="ai-import-retry">Retry remaining</button> : <button className="primary-button" type="button" onClick={submitImport} data-testid="ai-import-submit">Import</button>}</div></section>}</div>
    </FocusDialog>
  </section>;
}
