import { useEffect, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import type { McpServer } from '../../gateway/mcp';
import type { AccountChoice } from '../../gateway/sessions';
import type { Profile } from '../../types';
import { Icon } from '../../icons';
import { useGateway } from '../../gateway/context';
import { FocusDialog } from '../FocusDialog';
import { ListInspector, useSelectedId, type ListInspectorItem } from '../ListInspector';
import { profileAvatarLabel } from '../Profiles';
import { navigate } from '../Shell';
import './AgentSettingsTool.css';

type Trace = { method: string; route: string; detail: string };
type LoadSection = 'profiles' | 'accounts' | 'mcp' | 'providers';

export type AgentSettingsFrameProps = {
  slug: string;
  title: string;
  description: string;
  actions?: ReactNode;
  trace: Trace;
  children: ReactNode;
};

type AgentSettingsToolProps = {
  Frame: ComponentType<AgentSettingsFrameProps>;
};

const sectionIds = {
  profiles: 'profiles',
  autoPromotion: 'auto-promotion',
  accounts: 'accounts',
  behavior: 'behavior',
  keybindings: 'keybindings',
  runtime: 'runtime',
  mcp: 'mcp',
} as const;

function ScopeLabel({ children }: { children: ReactNode }) {
  return <span className="agent-settings-scope">{children}</span>;
}

function GapNotice({ place, children }: { place: string; children: ReactNode }) {
  return <div className="agent-settings-gap" role="note"><strong>Not available in the desktop app yet</strong><p>{children} Configure this in {place}.</p></div>;
}

function SectionIntro({ scope, children }: { scope: string; children: ReactNode }) {
  return <div className="agent-settings-intro"><ScopeLabel>{scope}</ScopeLabel><p>{children}</p></div>;
}

// Ported from apps/desktop_flutter/.../ai_account_section.dart — same endpoints and
// method indexes. method 1 = paste-back (openai); method 0 = the plugin's own local
// listener completes the exchange (google), so the UI only re-checks the provider list.
const providerCatalog = [
  { id: 'openai', label: 'OpenAI / Codex', kind: 'oauth' as const, method: 1, detail: 'Sign in with ChatGPT, then paste the callback URL or code back here.' },
  { id: 'google', label: 'Google / Gemini', kind: 'oauth' as const, method: 0, detail: 'Sign in with Google; the local listener finishes the exchange, then re-check below.' },
  { id: 'opencode', label: 'OpenCode', kind: 'key' as const, method: 0, detail: 'Paste an OpenCode API key.' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'key' as const, method: 0, detail: 'Last-resort tier of the model fallback chain. Paste an OpenRouter API key.' },
];

const accountNeedsRelogin = (account: AccountChoice) => !/^(ok|connected|active|authorized)$/i.test(account.status);

function useSettingsSelection() {
  const [selectedId, setSelectedId] = useSelectedId('settingsSection');
  useEffect(() => {
    if (selectedId === null) setSelectedId(sectionIds.profiles);
  }, [selectedId, setSelectedId]);
  return [selectedId, setSelectedId] as const;
}

function baseItems(status: Partial<Record<keyof typeof sectionIds, string>> = {}): ListInspectorItem[] {
  return [
    { id: sectionIds.profiles, title: 'Profiles overview', subtitle: status.profiles ?? 'Agent identities, defaults, and model assignments' },
    { id: sectionIds.autoPromotion, title: 'Auto-promotion', subtitle: status.autoPromotion ?? 'Workspace eligibility and confirmation gates' },
    { id: sectionIds.accounts, title: 'Accounts', subtitle: status.accounts ?? 'Authorized model provider accounts' },
    { id: sectionIds.behavior, title: 'Behavior', subtitle: status.behavior ?? 'Destructive-tool confirmation policy' },
    { id: sectionIds.keybindings, title: 'Keybindings', subtitle: status.keybindings ?? 'Desktop keyboard shortcuts' },
    { id: sectionIds.runtime, title: 'Runtime / OpenCode server', subtitle: status.runtime ?? 'Desktop-local API and engine endpoints' },
    { id: sectionIds.mcp, title: 'MCP servers', subtitle: status.mcp ?? 'Workspace tool connections and status' },
  ];
}

export function AutoPromotionSettings() {
  const gateway = useGateway(); const [state, setState] = useState<Awaited<ReturnType<NonNullable<typeof gateway.domains.autoPromotion>['get']>> | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [confirm, setConfirm] = useState(false); const [submitting, setSubmitting] = useState(false);
  const load = async (clearError = true) => { setLoading(true); if (clearError) setError(''); try { setState(await gateway.domains.autoPromotion!.get()); } catch (err) { setError(err instanceof Error ? err.message : 'Auto-promotion state could not be loaded'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const enabled = state?.state.autoPromotionEnabled ?? false; const canEnable = Boolean(state?.availability && state.state.autoPromotionEligible && state.state.totalRegressions === 0);
  const submit = async () => { setConfirm(false); setSubmitting(true); setError(''); let failed = false; try { await gateway.domains.autoPromotion!.setEnabled(!enabled); } catch (err) { failed = true; setError(err instanceof Error ? err.message : 'Auto-promotion update failed'); } await load(!failed); setSubmitting(false); };
  return <div className="auto-promotion-card" data-testid="auto-promotion"><header><div><p>Verified changes may be promoted automatically only when the organization is eligible.</p></div><span className={`kind-badge ${enabled ? 'active' : ''}`}>{enabled ? 'Enabled' : 'Disabled'}</span></header>{loading && <p role="status">Loading auto-promotion state…</p>}{error && <p role="alert">{error} <button className="text-button" type="button" onClick={() => void load()}>Retry</button></p>}{state && <dl className="property-list"><div><dt>Availability</dt><dd>{state.availability ? 'Available' : 'Unavailable'}</dd></div><div><dt>Eligibility</dt><dd>{state.state.autoPromotionEligible ? 'Eligible' : 'Not eligible'}</dd></div><div><dt>Verified changes</dt><dd>{state.state.totalVerified} / {state.state.trustThreshold}</dd></div><div><dt>Regressions</dt><dd>{state.state.totalRegressions}</dd></div>{state.state.enabledAt && <div><dt>Enabled</dt><dd>{state.state.enabledAt}</dd></div>}</dl>}<footer><button className={enabled ? 'danger-button' : 'primary-button'} type="button" disabled={submitting || loading || !enabled && !canEnable} title={!enabled && !canEnable ? 'Requires availability, eligibility, and zero regressions.' : undefined} onClick={() => setConfirm(true)} data-testid="auto-promotion-toggle">{enabled ? 'Disable' : 'Enable'}</button></footer><FocusDialog open={confirm} onClose={() => setConfirm(false)} title={enabled ? 'Disable auto-promotion?' : 'Enable auto-promotion?'} description={enabled ? 'Disable is an emergency stop. The server requires your explicit acknowledgement.' : 'Verified changes may be promoted automatically when eligibility is maintained.'} testId="auto-promotion-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setConfirm(false)} data-testid="auto-promotion-cancel">Cancel</button><button className={enabled ? 'danger-button' : 'primary-button'} type="button" onClick={() => void submit()} data-testid="auto-promotion-confirm">Confirm</button></div></FocusDialog></div>;
}

export function FixtureAgentSettingsTool({ Frame }: AgentSettingsToolProps) {
  const [selectedId, setSelectedId] = useSettingsSelection();
  const [trace, setTrace] = useState<Trace>({ method: 'LOCAL', route: 'fixture://agent-settings', detail: 'Local runtime defaults loaded' });
  const items = baseItems({
    profiles: 'Use the Profiles tool for profile editing',
    autoPromotion: 'Live workspace status required',
    accounts: 'Live local runtime required',
    behavior: 'Configure in Flutter Agent settings',
    keybindings: 'Configure in Flutter Agent settings',
    runtime: 'Fixture preview · not connected',
    mcp: 'Live local runtime required',
  });
  const inspector = (item: ListInspectorItem | null) => {
    if (!item) return <p>Select a configuration section.</p>;
    switch (item.id) {
      case sectionIds.profiles:
        return <><SectionIntro scope="Agent / profile">Profiles determine agent identity, model defaults, skills, MCP access, and permission rules.</SectionIntro><button className="primary-button" type="button" onClick={() => navigate('/profiles')} data-testid="agent-settings-open-profiles">Open profile editor</button></>;
      case sectionIds.autoPromotion:
        return <><SectionIntro scope="Workspace">Auto-promotion is controlled by workspace eligibility and always requires an explicit confirmation.</SectionIntro><GapNotice place="a signed-in live workspace">This fixture cannot read or change auto-promotion.</GapNotice></>;
      case sectionIds.accounts:
        return <><SectionIntro scope="Desktop local">Provider authorization is stored by the local OpenCode runtime.</SectionIntro><GapNotice place="a signed-in live workspace">The fixture cannot call the existing account authorization endpoints.</GapNotice></>;
      case sectionIds.behavior:
        return <><SectionIntro scope="Desktop local">Destructive tools can require a full confirmation dialog before they run.</SectionIntro><GapNotice place="Flutter Agent settings → Behavior">Saving this in Electron requires GET and PATCH /agent-settings/behavior; those endpoints do not exist.</GapNotice></>;
      case sectionIds.keybindings:
        return <><SectionIntro scope="Desktop local">Keyboard shortcuts control send, new session, cancel turn, and session switching.</SectionIntro><GapNotice place="Flutter Agent settings → Keybindings">Saving shortcuts in Electron requires GET and PATCH /agent-settings/keybindings; those endpoints do not exist.</GapNotice></>;
      case sectionIds.runtime:
        return <><SectionIntro scope="Desktop local">The fixture is intentionally disconnected and does not claim a live runtime.</SectionIntro><div className="agent-settings-actions"><button className="secondary-button" type="button" onClick={() => setTrace({ method: 'LOCAL', route: 'fixture://agent-settings/connection', detail: 'Desktop endpoint is local' })}>Desktop endpoint</button><button className="secondary-button" type="button" onClick={() => setTrace({ method: 'LOCAL', route: 'fixture://agent-settings/offline-buffer', detail: 'Offline buffering is local UI state until reconnect' })}>Offline buffering</button></div><GapNotice place="Flutter Agent settings → OpenCode server">Changing or restarting the runtime requires GET and PATCH /opencode/runtime plus POST /opencode/runtime/restart; those endpoints do not exist.</GapNotice></>;
      case sectionIds.mcp:
        return <><SectionIntro scope="Workspace">MCP servers add tool capabilities to configured profiles.</SectionIntro><GapNotice place="Flutter Agent settings → MCP servers">The fixture has no live MCP catalog.</GapNotice></>;
      default:
        return null;
    }
  };
  return <Frame slug="agent-settings" title="Agent settings" description="Agent, desktop-local, and workspace configuration in one place." trace={trace}>
    <ListInspector label="Agent settings sections" items={items} selectedId={selectedId} onSelect={setSelectedId} toolbar={<button className="secondary-button compact" type="button" onClick={() => setTrace({ method: 'LOCAL', route: 'fixture://agent-settings', detail: 'Local runtime defaults refreshed' })} data-testid="agent-settings-refresh"><Icon name="refresh" size={14} />Refresh</button>} inspector={inspector} />
  </Frame>;
}

export function LiveSettingsTool({ Frame }: AgentSettingsToolProps) {
  const gateway = useGateway();
  const sessions = gateway.domains.sessions!;
  const mcp = gateway.domains.mcp!;
  const [selectedId, setSelectedId] = useSettingsSelection();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [accounts, setAccounts] = useState<AccountChoice[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [accountsError, setAccountsError] = useState('');
  const [mcpError, setMcpError] = useState('');
  const [providerError, setProviderError] = useState('');
  const [accountActionError, setAccountActionError] = useState('');
  const [mcpActionError, setMcpActionError] = useState('');
  const [retrying, setRetrying] = useState<Partial<Record<LoadSection, boolean>>>({});
  const [retryStatus, setRetryStatus] = useState<Partial<Record<LoadSection, string>>>({});
  const retryInFlight = useRef(new Set<LoadSection>());
  const statusRefs = useRef<Partial<Record<LoadSection, HTMLParagraphElement | null>>>({});
  const sectionGeneration = useRef<Record<LoadSection, number>>({ profiles: 0, accounts: 0, mcp: 0, providers: 0 });
  const loadGeneration = useRef(0);
  const traceGeneration = useRef(0);
  const [runtimeStatus, setRuntimeStatus] = useState<Record<'api' | 'engine', string>>({ api: 'Not checked', engine: 'Not checked' });
  const [pendingAction, setPendingAction] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [removing, setRemoving] = useState<McpServer | null>(null);
  const [removingAccount, setRemovingAccount] = useState<AccountChoice | null>(null);
  const [accountDraft, setAccountDraft] = useState({ accountId: '', label: '', code: '' });
  const [accountAuthorizationUrl, setAccountAuthorizationUrl] = useState('');
  const [authProviders, setAuthProviders] = useState<string[] | null>(null);
  const [providersCurrent, setProvidersCurrent] = useState(false);
  const [providerFlow, setProviderFlow] = useState<{ id: string; authUrl: string; instructions: string; method: number } | null>(null);
  const [providerDraft, setProviderDraft] = useState<{ code: string; apiKey: Record<string, string> }>({ code: '', apiKey: {} });
  const [mcpDraft, setMcpDraft] = useState({ name: '', kind: 'remote' as 'remote' | 'local', value: '' });
  const [mcpCredentials, setMcpCredentials] = useState<Record<string, Record<string, string>>>({});
  const [mcpAuthorization, setMcpAuthorization] = useState<{ name: string; url: string } | null>(null);
  const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-configs', detail: 'Loading live agent configuration' });

  const routes: Record<LoadSection, string> = { profiles: '/agent-configs', accounts: '/opencode/auth/accounts', mcp: '/opencode/mcp', providers: '/opencode/auth' };
  const readSection = async (section: LoadSection, kind: 'load' | 'retry' | 'action' = 'load') => {
    const generation = ++sectionGeneration.current[section];
    const current = () => generation === sectionGeneration.current[section];
    const retry = kind === 'retry';
    // ponytail: one owner per section also owns its pending indicator and announcement.
    if (retry) retryInFlight.current.add(section); else retryInFlight.current.delete(section);
    setRetrying((state) => ({ ...state, [section]: retry }));
    setRetryStatus((state) => ({ ...state, [section]: retry ? `Retrying ${section}…` : '' }));
    if (section === 'providers') setProvidersCurrent(false);
    try {
      let result: number | string[] | undefined;
      if (section === 'profiles') {
        const value = await sessions.profiles();
        if (current()) { setProfiles(value); setProfileError(''); }
        result = value.length;
      } else if (section === 'accounts') {
        const value = await (sessions.accounts?.() ?? Promise.resolve([]));
        if (current()) { setAccounts(value); setAccountsError(''); }
      } else if (section === 'mcp') {
        const value = await mcp.list();
        if (current()) { setMcpServers(value); setMcpError(''); }
      } else {
        const value = await (sessions.authProviders?.() ?? Promise.resolve([]));
        if (current()) { setAuthProviders(value); setProviderError(''); setProvidersCurrent(true); }
        result = value;
      }
      if (current()) {
        retryInFlight.current.delete(section);
        setRetrying((state) => ({ ...state, [section]: false }));
        if (retry) setRetryStatus((state) => ({ ...state, [section]: `${section} loaded` }));
      }
      return result;
    } catch (err) {
      if (current()) {
        retryInFlight.current.delete(section);
        setRetrying((state) => ({ ...state, [section]: false }));
        if (retry) setRetryStatus((state) => ({ ...state, [section]: `${section} still unavailable` }));
      }
      if (kind !== 'action' && current()) {
        const message = err instanceof Error ? err.message : `${section} could not be loaded`;
        if (section === 'profiles') setProfileError(message);
        if (section === 'accounts') setAccountsError(message);
        if (section === 'mcp') setMcpError(message);
        if (section === 'providers') setProviderError(message);
      }
      throw err;
    }
  };
  const load = async () => {
    const run = ++loadGeneration.current;
    const traceRun = ++traceGeneration.current;
    const results = await Promise.allSettled((['profiles', 'accounts', 'mcp', 'providers'] as LoadSection[]).map((section) => readSection(section)));
    if (run !== loadGeneration.current) return;
    if (traceRun === traceGeneration.current) {
      const failed = results.flatMap((result, index) => result.status === 'rejected' ? [['profiles', 'accounts', 'MCP servers', 'providers'][index]] : []);
      setTrace({ method: 'GET', route: '/agent-configs · /opencode/auth/accounts · /opencode/mcp · /opencode/auth', detail: failed.length ? `${failed.join(', ')} failed to load` : `${results[0].status === 'fulfilled' ? results[0].value : 0} agent profiles loaded` });
    }
    setLoading(false);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const retrySection = async (section: LoadSection, origin: HTMLElement) => {
    if (retryInFlight.current.has(section)) return;
    const traceRun = ++traceGeneration.current;
    const generation = sectionGeneration.current[section] + 1;
    try {
      await readSection(section, 'retry');
      // A removed Retry falls back to body; explicit focus moves remain the user's choice.
      if (generation === sectionGeneration.current[section] && (document.activeElement === origin || (!origin.isConnected && document.activeElement === document.body))) statusRefs.current[section]?.focus();
      if (traceRun === traceGeneration.current && generation === sectionGeneration.current[section]) setTrace({ method: 'GET', route: routes[section], detail: `${section} loaded` });
    } catch {
      if (traceRun === traceGeneration.current && generation === sectionGeneration.current[section]) setTrace({ method: 'GET', route: routes[section], detail: `${section} failed to load` });
    }
  };

  const retryControl = (section: LoadSection, error: string, label: string) => <>
    {error && <p role="alert">{error} <button className="text-button agent-settings-retry" type="button" aria-disabled={Boolean(retrying[section])} aria-busy={Boolean(retrying[section])} onClick={(event) => void retrySection(section, event.currentTarget)}>{label}</button></p>}
    <p role="status" tabIndex={-1} data-testid={`agent-settings-${section}-status`} ref={(element) => { statusRefs.current[section] = element; }}>{retryStatus[section] ?? ''}</p>
  </>;

  const reloadAccounts = async () => {
    await readSection('accounts', 'action');
  };

  const reloadProviders = async () => {
    await readSection('providers', 'action');
  };

  const startProviderAuth = async (provider: typeof providerCatalog[number]) => {
    if (!sessions.authorizeProvider) return;
    setPendingAction(`provider-start-${provider.id}`); setAccountActionError(''); setActionNotice('');
    setProviderFlow(null); setProviderDraft((current) => ({ ...current, code: '' }));
    try {
      const result = await sessions.authorizeProvider(provider.id, provider.method);
      setProviderFlow({ id: provider.id, authUrl: result.authUrl, instructions: result.instructions, method: provider.method });
      setActionNotice(`Authorization started for ${provider.label}. Open the provider page to sign in.`);
      setTrace({ method: 'GET', route: `/opencode/auth/${provider.id}/authorize`, detail: `Authorization started for ${provider.id}` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Provider authorization could not be started'); }
    finally { setPendingAction(''); }
  };

  const completeProviderAuth = async (event: FormEvent) => {
    event.preventDefault();
    if (!providerFlow || !sessions.completeProviderAuth) return;
    const flow = providerFlow;
    setPendingAction(`provider-complete-${flow.id}`); setAccountActionError(''); setActionNotice('');
    try {
      await sessions.completeProviderAuth(flow.id, providerDraft.code.trim(), flow.method);
      await reloadProviders();
      setProviderFlow(null); setProviderDraft((current) => ({ ...current, code: '' }));
      setActionNotice(`${flow.id} connected.`);
      setTrace({ method: 'GET', route: `/opencode/auth/${flow.id}/callback`, detail: `${flow.id} authorization completed` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Provider authorization could not be completed'); }
    finally { setPendingAction(''); }
  };

  // method 0 providers are finished by the engine plugin's own listener, so the UI
  // only needs to re-read the authorized list instead of exchanging a code itself.
  const checkProviderAuth = async () => {
    if (!providerFlow) return;
    const flow = providerFlow;
    setPendingAction(`provider-check-${flow.id}`); setAccountActionError('');
    const generation = sectionGeneration.current.providers + 1;
    const current = () => generation === sectionGeneration.current.providers;
    try {
      const providers = await readSection('providers', 'action') as string[];
      if (!current()) return;
      const connected = providers.includes(flow.id);
      if (connected) setProviderFlow(null);
      setActionNotice(connected ? `${flow.id} connected.` : `${flow.id} is not connected yet. Finish the browser sign-in, then check again.`);
      setTrace({ method: 'GET', route: '/opencode/auth', detail: `${flow.id} is ${connected ? 'connected' : 'not connected yet'}` });
    } catch (err) { if (current()) setAccountActionError(err instanceof Error ? err.message : 'Provider status could not be read'); }
    finally { setPendingAction(''); }
  };

  const saveProviderApiKey = async (event: FormEvent, provider: typeof providerCatalog[number]) => {
    event.preventDefault();
    if (!sessions.saveProviderApiKey) return;
    setPendingAction(`provider-key-${provider.id}`); setAccountActionError(''); setActionNotice('');
    try {
      await sessions.saveProviderApiKey(provider.id, providerDraft.apiKey[provider.id] ?? '');
      await reloadProviders();
      setProviderDraft((current) => ({ ...current, apiKey: { ...current.apiKey, [provider.id]: '' } }));
      setActionNotice(`${provider.label} connected.`);
      setTrace({ method: 'POST', route: `/opencode/auth/${provider.id}`, detail: `${provider.id} API key stored` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Provider API key could not be saved'); }
    finally { setPendingAction(''); }
  };

  // Re-authorizing an existing account is the same login-start/login-complete
  // pair as a new one — the server upserts by id and keeps the default set.
  const beginAccountLogin = async (accountId: string, label: string) => {
    if (!sessions.startAccountLogin || !accountId) return;
    setPendingAction('account-start'); setAccountActionError(''); setActionNotice(''); setAccountAuthorizationUrl('');
    setAccountDraft({ accountId, label, code: '' });
    try {
      const result = await sessions.startAccountLogin({ accountId, label: label || accountId });
      setAccountAuthorizationUrl(result.authorizationUrl);
      setActionNotice('Authorization started. Open the provider page, then paste the returned code.');
      setTrace({ method: 'POST', route: '/opencode/auth/accounts/login-start', detail: `Authorization started for ${accountId}` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Account authorization could not be started'); }
    finally { setPendingAction(''); }
  };

  const startAccountLogin = async (event: FormEvent) => {
    event.preventDefault();
    await beginAccountLogin(accountDraft.accountId.trim(), accountDraft.label.trim() || accountDraft.accountId.trim());
  };

  const completeAccountLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessions.completeAccountLogin) return;
    setPendingAction('account-complete'); setAccountActionError(''); setActionNotice('');
    try {
      await sessions.completeAccountLogin({ accountId: accountDraft.accountId.trim(), code: accountDraft.code.trim() });
      await reloadAccounts();
      setAccountDraft({ accountId: '', label: '', code: '' });
      setAccountAuthorizationUrl('');
      setActionNotice('Account authorized and saved.');
      setTrace({ method: 'POST', route: '/opencode/auth/accounts/login-complete', detail: 'Account authorization completed' });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Account authorization could not be completed'); }
    finally { setPendingAction(''); }
  };

  const setDefaultAccount = async (account: AccountChoice) => {
    if (!sessions.setDefaultAccount) return;
    setPendingAction(`account-default-${account.id}`); setAccountActionError(''); setActionNotice('');
    try {
      await sessions.setDefaultAccount(account.id);
      await reloadAccounts();
      setActionNotice(`${account.label} is now the default account.`);
      setTrace({ method: 'PATCH', route: '/opencode/auth/accounts/default', detail: `${account.id} set as default` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Default account could not be saved'); }
    finally { setPendingAction(''); }
  };

  const removeSelectedAccount = async () => {
    if (!removingAccount || !sessions.removeAccount) return;
    const account = removingAccount; setRemovingAccount(null); setPendingAction(`account-remove-${account.id}`); setAccountActionError(''); setActionNotice('');
    try {
      await sessions.removeAccount(account.id);
      await reloadAccounts();
      setActionNotice(`${account.label} removed.`);
      setTrace({ method: 'DELETE', route: `/opencode/auth/accounts/${encodeURIComponent(account.id)}`, detail: `${account.id} removed` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Account could not be removed'); }
    finally { setPendingAction(''); }
  };

  const runRuntimeCheck = async (service: 'api' | 'engine') => {
    setPendingAction(`runtime-${service}`); setActionNotice('');
    try {
      await gateway.health[service]();
      setRuntimeStatus((current) => ({ ...current, [service]: 'Healthy' }));
      setTrace({ method: 'GET', route: service === 'api' ? '/health' : '/global/health', detail: `${service === 'api' ? 'Local API' : 'OpenCode engine'} is healthy` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Health check failed';
      setRuntimeStatus((current) => ({ ...current, [service]: message }));
    } finally { setPendingAction(''); }
  };

  const reloadMcp = async () => {
    await readSection('mcp', 'action');
  };

  const runMcpAction = async (server: McpServer, action: 'connect' | 'disconnect') => {
    setPendingAction(`${action}-${server.name}`); setMcpActionError(''); setActionNotice('');
    try {
      if (action === 'connect') {
        const result = await mcp.connect(server.name);
        if (result.authorizationUrl) setMcpAuthorization({ name: server.name, url: result.authorizationUrl });
        setActionNotice(result.authorizationUrl ? `${server.name} requires browser authorization.` : `${server.name} connected.`);
      } else {
        await mcp.disconnect(server.name);
        setActionNotice(`${server.name} disconnected.`);
      }
      await reloadMcp();
      setTrace({ method: 'POST', route: `/opencode/mcp/${encodeURIComponent(server.name)}/${action}`, detail: `${server.name} ${action} request completed` });
    } catch (err) { setMcpActionError(err instanceof Error ? err.message : `MCP ${action} failed`); }
    finally { setPendingAction(''); }
  };

  const removeMcp = async () => {
    if (!removing) return;
    const server = removing; setRemoving(null); setPendingAction(`remove-${server.name}`); setMcpActionError(''); setActionNotice('');
    try {
      await mcp.remove(server.name);
      await reloadMcp();
      setActionNotice(`${server.name} removed.`);
      setTrace({ method: 'DELETE', route: `/opencode/mcp/${encodeURIComponent(server.name)}`, detail: `${server.name} removed` });
    } catch (err) { setMcpActionError(err instanceof Error ? err.message : 'MCP server removal failed'); }
    finally { setPendingAction(''); }
  };

  const addMcp = async (event: FormEvent) => {
    event.preventDefault();
    setPendingAction('mcp-add'); setMcpActionError(''); setActionNotice('');
    try {
      await mcp.add({ name: mcpDraft.name.trim(), ...(mcpDraft.kind === 'remote' ? { url: mcpDraft.value.trim() } : { command: mcpDraft.value.trim() }) });
      await reloadMcp();
      setActionNotice(`${mcpDraft.name.trim()} added and saved.`);
      setTrace({ method: 'POST', route: '/opencode/mcp', detail: `${mcpDraft.name.trim()} added` });
      setMcpDraft({ name: '', kind: 'remote', value: '' });
    } catch (err) { setMcpActionError(err instanceof Error ? err.message : 'MCP server could not be added'); }
    finally { setPendingAction(''); }
  };

  const saveMcpCredentials = async (event: FormEvent, server: McpServer) => {
    event.preventDefault();
    setPendingAction(`mcp-credentials-${server.name}`); setMcpActionError(''); setActionNotice('');
    try {
      await mcp.setCredentials(server.name, mcpCredentials[server.name] ?? {});
      await reloadMcp();
      setMcpCredentials((current) => ({ ...current, [server.name]: {} }));
      setActionNotice(`${server.name} credentials saved.`);
      setTrace({ method: 'POST', route: `/opencode/mcp/${encodeURIComponent(server.name)}/credentials`, detail: `${server.name} credentials saved` });
    } catch (err) { setMcpActionError(err instanceof Error ? err.message : 'MCP credentials could not be saved'); }
    finally { setPendingAction(''); }
  };

  const startMcpOAuth = async (server: McpServer) => {
    setPendingAction(`mcp-oauth-${server.name}`); setMcpActionError(''); setActionNotice('');
    try {
      const result = await mcp.startOAuth(server.name);
      setMcpAuthorization({ name: server.name, url: result.authorizationUrl });
      setActionNotice(`Authorization started for ${server.name}.`);
      setTrace({ method: 'POST', route: `/opencode/mcp/${encodeURIComponent(server.name)}/oauth/start`, detail: `${server.name} OAuth started` });
    } catch (err) { setMcpActionError(err instanceof Error ? err.message : 'MCP authorization could not be started'); }
    finally { setPendingAction(''); }
  };

  const checkMcpOAuth = async () => {
    if (!mcpAuthorization) return;
    setPendingAction(`mcp-oauth-status-${mcpAuthorization.name}`); setMcpActionError('');
    try {
      const result = await mcp.oauthStatus(mcpAuthorization.name);
      await reloadMcp();
      setActionNotice(`${mcpAuthorization.name} authorization status: ${result.status}.`);
      setTrace({ method: 'GET', route: `/opencode/mcp/${encodeURIComponent(mcpAuthorization.name)}/oauth/status`, detail: `${mcpAuthorization.name} OAuth status is ${result.status}` });
      if (/connected|authorized|complete/i.test(result.status)) setMcpAuthorization(null);
    } catch (err) { setMcpActionError(err instanceof Error ? err.message : 'MCP authorization status could not be loaded'); }
    finally { setPendingAction(''); }
  };

  const defaultProfile = profiles.find((profile) => profile.isDefault);
  const connectedAccounts = accounts.filter((account) => !accountNeedsRelogin(account)).length;
  const staleAccounts = accounts.length - connectedAccounts;
  const connectedMcp = mcpServers.filter((server) => server.status === 'connected').length;
  const items = baseItems({
    profiles: profileError || (profiles.length ? `${profiles.length} configured${defaultProfile ? ` · default ${defaultProfile.label}` : ''}` : 'No profiles configured'),
    accounts: accountsError || `${connectedAccounts} connected · ${accounts.length} available${staleAccounts ? ` · ${staleAccounts} need re-authorization` : ''}`,
    behavior: 'Configure in Flutter Agent settings',
    keybindings: 'Configure in Flutter Agent settings',
    runtime: gateway.environment ? `API :${gateway.environment.apiPort} · engine :${gateway.environment.enginePort}` : 'Local runtime unavailable',
    mcp: mcpError || `${connectedMcp} connected · ${mcpServers.length} configured`,
  });

  const profilesInspector = () => <><SectionIntro scope="Agent / profile">Profiles own identity, model defaults, delegation, skills, MCP access, and protected-action policy. Editing stays in the dedicated profile surface.</SectionIntro>{retryControl('profiles', profileError, 'Retry profiles')}{!profileError && (profiles.length === 0 ? <div className="agent-settings-empty"><strong>No agent profiles configured</strong><p>Create a profile before starting a configured session.</p></div> : <div className="agent-settings-records">{profiles.map((profile) => <article key={profile.id} data-testid={`agent-setting-${profile.id}`}><span className="profile-avatar" aria-hidden="true">{profileAvatarLabel(profile)}</span><span><strong>{profile.label}</strong><small>{profile.enabled ? 'Enabled' : 'Disabled'} · {profile.provider} · {profile.model}{profile.isDefault ? ' · Default' : ''}</small></span></article>)}</div>)}<button className="primary-button" type="button" onClick={() => navigate('/profiles')} data-testid="agent-settings-open-profiles">Open profile editor</button></>;
  const accountsInspector = () => <>
    <SectionIntro scope="Desktop local">Anthropic accounts and every other model provider are authorized against the local OpenCode runtime.</SectionIntro>
    {retryControl('accounts', accountsError, 'Retry accounts')}
    {accountActionError && <p role="alert">{accountActionError}</p>}
    {(pendingAction.startsWith('account-') || pendingAction.startsWith('provider-')) && <p role="status">Saving account configuration…</p>}
    {actionNotice && <p role="status">{actionNotice}</p>}
    {!accountsError && accounts.length === 0 && <div className="agent-settings-empty"><strong>No provider accounts reported</strong><p>Authorize an account below.</p></div>}
    <div className="agent-settings-records">
      {accounts.map((account) => <article key={account.id} className={`agent-settings-account${accountNeedsRelogin(account) ? ' needs-relogin' : ''}`} data-testid={`agent-settings-account-${account.id}`} data-account-status={account.status}><span><strong>{account.label}</strong><small>{account.status}{account.isDefault ? ' · Default' : ''}</small>{accountNeedsRelogin(account) && <span className="kind-badge" data-testid={`agent-settings-account-attention-${account.id}`}>Needs re-authorization</span>}</span><div className="agent-settings-actions">{accountNeedsRelogin(account) && <button className="primary-button" type="button" disabled={Boolean(pendingAction)} onClick={() => void beginAccountLogin(account.id, account.label)} data-testid={`agent-settings-account-relogin-${account.id}`}>Re-authorize</button>}{!account.isDefault && <button className="secondary-button" type="button" disabled={Boolean(pendingAction)} onClick={() => void setDefaultAccount(account)} data-testid={`agent-settings-account-default-${account.id}`}>Make default</button>}<button className="text-danger-button" type="button" disabled={Boolean(pendingAction)} onClick={() => setRemovingAccount(account)} data-testid={`agent-settings-account-remove-${account.id}`}>Remove</button></div></article>)}
    </div>
    <form className="agent-settings-form" onSubmit={startAccountLogin}>
      <h3>Authorize Anthropic account</h3>
      <label>Account ID<input required pattern="[a-z0-9-]{1,32}" value={accountDraft.accountId} onChange={(event) => setAccountDraft((current) => ({ ...current, accountId: event.target.value }))} data-testid="agent-settings-account-id" /></label>
      <label>Label<input value={accountDraft.label} onChange={(event) => setAccountDraft((current) => ({ ...current, label: event.target.value }))} data-testid="agent-settings-account-label" /></label>
      <button className="primary-button" type="submit" disabled={Boolean(pendingAction)} data-testid="agent-settings-account-start">Start authorization</button>
    </form>
    {accountAuthorizationUrl && <form className="agent-settings-form" onSubmit={completeAccountLogin}><h3 data-testid="agent-settings-account-authorizing">Authorizing {accountDraft.label || accountDraft.accountId}</h3><a href={accountAuthorizationUrl} target="_blank" rel="noreferrer" data-testid="agent-settings-account-authorization-link">Open Anthropic authorization</a><label>Authorization code<input required value={accountDraft.code} onChange={(event) => setAccountDraft((current) => ({ ...current, code: event.target.value }))} data-testid="agent-settings-account-code" /></label><button className="primary-button" type="submit" disabled={Boolean(pendingAction)} data-testid="agent-settings-account-complete">Save account</button></form>}
    <h3 className="agent-settings-subhead">Model providers</h3>
    <p className="agent-settings-subhead-note">OAuth and API-key providers are stored by the local OpenCode runtime, the same as in the Flutter settings screen.</p>
    {retryControl('providers', providerError, 'Retry providers')}
    <div className="agent-settings-records">
      {providerCatalog.map((provider) => { const connected = authProviders?.includes(provider.id) ?? false; const confirmed = providersCurrent && authProviders !== null; const badge = authProviders === null ? 'Status unknown' : `${confirmed ? '' : 'Last known '}${connected ? 'Connected' : 'Not connected'}`; return <article key={provider.id} className={`agent-settings-account${confirmed && !connected ? ' needs-relogin' : ''}`} data-testid={`agent-settings-provider-${provider.id}`}><span><strong>{provider.label}</strong><small>{provider.detail}</small><span className={`kind-badge${authProviders === null ? ' agent-settings-status-unknown' : ''}`} data-testid={`agent-settings-provider-status-${provider.id}`}>{badge}</span></span>{provider.kind === 'oauth' && <div className="agent-settings-actions"><button className={connected ? 'secondary-button' : 'primary-button'} type="button" disabled={Boolean(pendingAction)} onClick={() => void startProviderAuth(provider)} data-testid={`agent-settings-provider-authorize-${provider.id}`}>{connected ? 'Reconnect' : 'Connect'}</button></div>}{provider.kind === 'key' && <form className="agent-settings-form" onSubmit={(event) => void saveProviderApiKey(event, provider)}><label>API key<input required type="password" autoComplete="off" value={providerDraft.apiKey[provider.id] ?? ''} onChange={(event) => { const value = event.target.value; setProviderDraft((current) => ({ ...current, apiKey: { ...current.apiKey, [provider.id]: value } })); }} data-testid={`agent-settings-provider-key-${provider.id}`} /></label><button className="primary-button" type="submit" disabled={Boolean(pendingAction)} data-testid={`agent-settings-provider-key-save-${provider.id}`}>{connected ? 'Replace key' : 'Save key'}</button></form>}</article>; })}
    </div>
    {providerFlow && <div className="agent-settings-form" data-testid={`agent-settings-provider-flow-${providerFlow.id}`}><h3>Authorizing {providerFlow.id}</h3>{providerFlow.instructions && <p>{providerFlow.instructions}</p>}<p><a href={providerFlow.authUrl} target="_blank" rel="noreferrer" data-testid="agent-settings-provider-authorization-link">Open {providerFlow.id} authorization</a></p>{providerFlow.method === 1 ? <form className="agent-settings-form" onSubmit={completeProviderAuth}><label>Callback URL or code<input required value={providerDraft.code} onChange={(event) => { const value = event.target.value; setProviderDraft((current) => ({ ...current, code: value })); }} data-testid="agent-settings-provider-code" /></label><button className="primary-button" type="submit" disabled={Boolean(pendingAction)} data-testid="agent-settings-provider-complete">Finish connecting</button></form> : <button className="primary-button" type="button" disabled={Boolean(pendingAction)} onClick={() => void checkProviderAuth()} data-testid="agent-settings-provider-check">I finished sign-in — check connection</button>}</div>}
  </>;
  const runtimeInspector = () => <><SectionIntro scope="Desktop local">Rhythm uses a local API and OpenCode engine supplied by the trusted desktop host.</SectionIntro><dl className="property-list"><div><dt>Local API</dt><dd>{gateway.environment ? `127.0.0.1:${gateway.environment.apiPort}` : 'Unavailable'} · {runtimeStatus.api}</dd></div><div><dt>OpenCode engine</dt><dd>{gateway.environment ? `127.0.0.1:${gateway.environment.enginePort}` : 'Unavailable'} · {runtimeStatus.engine}</dd></div></dl>{pendingAction.startsWith('runtime-') && <p role="status">Checking the local runtime…</p>}<div className="agent-settings-actions"><button className="secondary-button" type="button" disabled={Boolean(pendingAction)} onClick={() => void runRuntimeCheck('api')} data-testid="agent-settings-check-api">Check local API</button><button className="secondary-button" type="button" disabled={Boolean(pendingAction)} onClick={() => void runRuntimeCheck('engine')} data-testid="agent-settings-check-engine">Check OpenCode engine</button></div><GapNotice place="Flutter Agent settings → OpenCode server">Changing or restarting the runtime requires GET and PATCH /opencode/runtime plus POST /opencode/runtime/restart; those endpoints do not exist.</GapNotice></>;
  const mcpInspector = () => <>
    <SectionIntro scope="Workspace">MCP servers provide tools to profiles. Changes are saved through the workspace MCP service.</SectionIntro>
    {retryControl('mcp', mcpError, 'Retry MCP servers')}
    {mcpActionError && <p role="alert">{mcpActionError}</p>}
    {pendingAction.startsWith('mcp-') && <p role="status">Saving MCP configuration…</p>}
    {actionNotice && <p role="status">{actionNotice}</p>}
    <form className="agent-settings-form" onSubmit={addMcp}>
      <h3>Add MCP server</h3>
      <label>Name<input required value={mcpDraft.name} onChange={(event) => setMcpDraft((current) => ({ ...current, name: event.target.value }))} data-testid="agent-settings-mcp-add-name" /></label>
      <label>Connection type<select value={mcpDraft.kind} onChange={(event) => setMcpDraft((current) => ({ ...current, kind: event.target.value as 'remote' | 'local' }))} data-testid="agent-settings-mcp-add-kind"><option value="remote">Remote URL</option><option value="local">Local command</option></select></label>
      <label>{mcpDraft.kind === 'remote' ? 'URL' : 'Command'}<input required type={mcpDraft.kind === 'remote' ? 'url' : 'text'} value={mcpDraft.value} onChange={(event) => setMcpDraft((current) => ({ ...current, value: event.target.value }))} data-testid="agent-settings-mcp-add-value" /></label>
      <button className="primary-button" type="submit" disabled={Boolean(pendingAction)} data-testid="agent-settings-mcp-add">Add server</button>
    </form>
    {!mcpError && mcpServers.length === 0 && <div className="agent-settings-empty"><strong>No MCP servers configured</strong><p>Add a local command or remote URL above.</p></div>}
    {mcpAuthorization && <div className="agent-settings-gap" role="status"><strong>{mcpAuthorization.name} authorization</strong><p><a href={mcpAuthorization.url} target="_blank" rel="noreferrer" data-testid="agent-settings-mcp-authorization-link">Open provider authorization</a></p><button className="secondary-button" type="button" disabled={Boolean(pendingAction)} onClick={() => void checkMcpOAuth()} data-testid="agent-settings-mcp-oauth-status">Check authorization status</button></div>}
    <div className="agent-settings-mcp-list">{mcpServers.map((server) => <article key={server.name} data-testid={`agent-settings-mcp-${server.name}`}><header><div><strong>{server.name}</strong><small>{server.source} · {server.tools.length} tools</small></div><span className="kind-badge">{server.status}</span></header>{server.error && <p role="alert">{server.error}</p>}{server.needsCredentials && server.requiredEnv.length > 0 && <form className="agent-settings-form" onSubmit={(event) => void saveMcpCredentials(event, server)}><p>Credentials required</p>{server.requiredEnv.map((key) => <label key={key}>{key}<input required type="password" autoComplete="off" value={mcpCredentials[server.name]?.[key] ?? ''} onChange={(event) => setMcpCredentials((current) => ({ ...current, [server.name]: { ...current[server.name], [key]: event.target.value } }))} data-testid={`agent-settings-mcp-credential-${server.name}-${key}`} /></label>)}<button className="primary-button" type="submit" disabled={Boolean(pendingAction)} data-testid={`agent-settings-mcp-credentials-save-${server.name}`}>Save credentials</button></form>}<div className="agent-settings-actions">{server.status === 'connected' ? <button className="secondary-button" type="button" disabled={Boolean(pendingAction)} onClick={() => void runMcpAction(server, 'disconnect')} data-testid={`agent-settings-mcp-disconnect-${server.name}`}>Disconnect</button> : server.needsCredentials && server.requiredEnv.length === 0 ? <button className="primary-button" type="button" disabled={Boolean(pendingAction)} onClick={() => void startMcpOAuth(server)} data-testid={`agent-settings-mcp-oauth-${server.name}`}>Authorize</button> : <button className="primary-button" type="button" disabled={Boolean(pendingAction) || server.needsCredentials} onClick={() => void runMcpAction(server, 'connect')} data-testid={`agent-settings-mcp-connect-${server.name}`}>Connect</button>}<button className="text-danger-button" type="button" disabled={Boolean(pendingAction)} onClick={() => setRemoving(server)} data-testid={`agent-settings-mcp-remove-${server.name}`}>Remove</button></div></article>)}</div>
  </>;

  const inspector = (item: ListInspectorItem | null) => {
    if (!item) return <p>Select a configuration section.</p>;
    switch (item.id) {
      case sectionIds.profiles: return profilesInspector();
      case sectionIds.autoPromotion: return <><SectionIntro scope="Workspace">The server enforces administrator access, eligibility, regression checks, and explicit confirmation.</SectionIntro><AutoPromotionSettings /></>;
      case sectionIds.accounts: return accountsInspector();
      case sectionIds.behavior: return <><SectionIntro scope="Desktop local">This policy controls whether Bash, write, and edit tool calls use a full destructive-action confirmation dialog.</SectionIntro><GapNotice place="Flutter Agent settings → Behavior">Saving this in Electron requires GET and PATCH /agent-settings/behavior; those endpoints do not exist, so no no-op switch is shown.</GapNotice></>;
      case sectionIds.keybindings: return <><SectionIntro scope="Desktop local">Shortcuts cover send message, new session, cancel turn, and switch session.</SectionIntro><GapNotice place="Flutter Agent settings → Keybindings">Saving shortcuts in Electron requires GET and PATCH /agent-settings/keybindings; those endpoints do not exist, so no temporary editor is shown.</GapNotice></>;
      case sectionIds.runtime: return runtimeInspector();
      case sectionIds.mcp: return mcpInspector();
      default: return null;
    }
  };

  return <Frame slug="agent-settings" title="Agent settings" description="Agent, desktop-local, and workspace configuration in one place." trace={trace}>
    <ListInspector label="Agent settings sections" items={items} selectedId={selectedId} onSelect={setSelectedId} loading={loading} toolbar={<button className="secondary-button compact" type="button" onClick={() => void load()} data-testid="agent-settings-refresh"><Icon name="refresh" size={14} />Refresh</button>} inspector={inspector} emptyState={<p>No configuration sections are available.</p>} />
    <FocusDialog open={Boolean(removing)} onClose={() => setRemoving(null)} title="Remove MCP server?" description={removing ? `${removing.name} will be removed from this local workspace configuration.` : ''} testId="agent-settings-mcp-remove-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setRemoving(null)}>Cancel</button><button className="danger-button" type="button" onClick={() => void removeMcp()} data-testid="agent-settings-mcp-remove-confirm">Remove</button></div></FocusDialog>
    <FocusDialog open={Boolean(removingAccount)} onClose={() => setRemovingAccount(null)} title="Remove account?" description={removingAccount ? `${removingAccount.label} will be removed from the local OpenCode account store.` : ''} testId="agent-settings-account-remove-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setRemovingAccount(null)}>Cancel</button><button className="danger-button" type="button" onClick={() => void removeSelectedAccount()} data-testid="agent-settings-account-remove-confirm">Remove</button></div></FocusDialog>
  </Frame>;
}
