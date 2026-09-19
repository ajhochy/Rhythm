import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
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
  return <section className="auto-promotion-card" aria-label="Auto-promotion" data-testid="auto-promotion"><header><div><p>Verified changes may be promoted automatically only when the organization is eligible.</p></div><span className={`kind-badge ${enabled ? 'active' : ''}`}>{enabled ? 'Enabled' : 'Disabled'}</span></header>{loading && <p role="status">Loading auto-promotion state…</p>}{error && <p role="alert">{error} <button className="text-button" type="button" onClick={() => void load()}>Retry</button></p>}{state && <dl className="property-list"><div><dt>Availability</dt><dd>{state.availability ? 'Available' : 'Unavailable'}</dd></div><div><dt>Eligibility</dt><dd>{state.state.autoPromotionEligible ? 'Eligible' : 'Not eligible'}</dd></div><div><dt>Verified changes</dt><dd>{state.state.totalVerified} / {state.state.trustThreshold}</dd></div><div><dt>Regressions</dt><dd>{state.state.totalRegressions}</dd></div>{state.state.enabledAt && <div><dt>Enabled</dt><dd>{state.state.enabledAt}</dd></div>}</dl>}<footer><button className={enabled ? 'danger-button' : 'primary-button'} type="button" disabled={submitting || loading || !enabled && !canEnable} title={!enabled && !canEnable ? 'Requires availability, eligibility, and zero regressions.' : undefined} onClick={() => setConfirm(true)} data-testid="auto-promotion-toggle">{enabled ? 'Disable' : 'Enable'}</button></footer><FocusDialog open={confirm} onClose={() => setConfirm(false)} title={enabled ? 'Disable auto-promotion?' : 'Enable auto-promotion?'} description={enabled ? 'Disable is an emergency stop. The server requires your explicit acknowledgement.' : 'Verified changes may be promoted automatically when eligibility is maintained.'} testId="auto-promotion-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setConfirm(false)} data-testid="auto-promotion-cancel">Cancel</button><button className={enabled ? 'danger-button' : 'primary-button'} type="button" onClick={() => void submit()} data-testid="auto-promotion-confirm">Confirm</button></div></FocusDialog></section>;
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
        return <><SectionIntro scope="Desktop local">Provider authorization is stored by the local OpenCode runtime, outside the renderer.</SectionIntro><GapNotice place="Flutter Agent settings → Accounts">Account connection and credential entry do not have a desktop gateway path.</GapNotice></>;
      case sectionIds.behavior:
        return <><SectionIntro scope="Desktop local">Destructive tools can require a full confirmation dialog before they run.</SectionIntro><GapNotice place="Flutter Agent settings → Behavior">The desktop gateway does not expose this preference.</GapNotice></>;
      case sectionIds.keybindings:
        return <><SectionIntro scope="Desktop local">Keyboard shortcuts control send, new session, cancel turn, and session switching.</SectionIntro><GapNotice place="Flutter Agent settings → Keybindings">The desktop gateway does not expose shortcut persistence.</GapNotice></>;
      case sectionIds.runtime:
        return <><SectionIntro scope="Desktop local">The fixture is intentionally disconnected and does not claim a live runtime.</SectionIntro><div className="agent-settings-actions"><button className="secondary-button" type="button" onClick={() => setTrace({ method: 'LOCAL', route: 'fixture://agent-settings/connection', detail: 'Desktop endpoint is local' })}>Desktop endpoint</button><button className="secondary-button" type="button" onClick={() => setTrace({ method: 'LOCAL', route: 'fixture://agent-settings/offline-buffer', detail: 'Offline buffering is local UI state until reconnect' })}>Offline buffering</button></div><GapNotice place="Flutter Agent settings → OpenCode server">Changing the runtime URL is not exposed by the desktop gateway.</GapNotice></>;
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
  const [selectedId, setSelectedId] = useSettingsSelection();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [accounts, setAccounts] = useState<AccountChoice[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountsError, setAccountsError] = useState('');
  const [mcpError, setMcpError] = useState('');
  const [runtimeStatus, setRuntimeStatus] = useState<Record<'api' | 'engine', string>>({ api: 'Not checked', engine: 'Not checked' });
  const [pendingAction, setPendingAction] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [removing, setRemoving] = useState<McpServer | null>(null);
  const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-configs', detail: 'Loading live agent configuration' });

  const load = async () => {
    setError(null); setAccountsError(''); setMcpError(''); setLoading(true);
    const [profileResult, accountResult, mcpResult] = await Promise.allSettled([
      gateway.domains.sessions!.profiles(),
      gateway.domains.sessions!.accounts?.() ?? Promise.resolve([]),
      gateway.domains.mcp!.list(),
    ]);
    if (profileResult.status === 'fulfilled') setProfiles(profileResult.value);
    else setError(profileResult.reason instanceof Error ? profileResult.reason.message : 'Agent settings failed to load');
    if (accountResult.status === 'fulfilled') setAccounts(accountResult.value);
    else setAccountsError(accountResult.reason instanceof Error ? accountResult.reason.message : 'Accounts could not be loaded');
    if (mcpResult.status === 'fulfilled') setMcpServers(mcpResult.value);
    else setMcpError(mcpResult.reason instanceof Error ? mcpResult.reason.message : 'MCP servers could not be loaded');
    const profileCount = profileResult.status === 'fulfilled' ? profileResult.value.length : 0;
    setTrace({ method: 'GET', route: '/agent-configs · /opencode/auth/accounts · /opencode/mcp', detail: `${profileCount} agent profiles loaded` });
    setLoading(false);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    const next = await gateway.domains.mcp!.list();
    setMcpServers(next);
  };

  const runMcpAction = async (server: McpServer, action: 'connect' | 'disconnect') => {
    setPendingAction(`${action}-${server.name}`); setMcpError(''); setActionNotice('');
    try {
      if (action === 'connect') {
        const result = await gateway.domains.mcp!.connect(server.name);
        setActionNotice(result.authorizationUrl ? `${server.name} requires browser authorization. Continue in Flutter Agent settings → MCP servers.` : `${server.name} connected.`);
      } else {
        await gateway.domains.mcp!.disconnect(server.name);
        setActionNotice(`${server.name} disconnected.`);
      }
      await reloadMcp();
      setTrace({ method: 'POST', route: `/opencode/mcp/${encodeURIComponent(server.name)}/${action}`, detail: `${server.name} ${action} request completed` });
    } catch (err) { setMcpError(err instanceof Error ? err.message : `MCP ${action} failed`); }
    finally { setPendingAction(''); }
  };

  const removeMcp = async () => {
    if (!removing) return;
    const server = removing; setRemoving(null); setPendingAction(`remove-${server.name}`); setMcpError(''); setActionNotice('');
    try {
      await gateway.domains.mcp!.remove(server.name);
      await reloadMcp();
      setActionNotice(`${server.name} removed.`);
      setTrace({ method: 'DELETE', route: `/opencode/mcp/${encodeURIComponent(server.name)}`, detail: `${server.name} removed` });
    } catch (err) { setMcpError(err instanceof Error ? err.message : 'MCP server removal failed'); }
    finally { setPendingAction(''); }
  };

  const defaultProfile = profiles.find((profile) => profile.isDefault);
  const connectedAccounts = accounts.filter((account) => /connected|active|authorized/i.test(account.status)).length;
  const connectedMcp = mcpServers.filter((server) => server.status === 'connected').length;
  const items = baseItems({
    profiles: profiles.length ? `${profiles.length} configured${defaultProfile ? ` · default ${defaultProfile.label}` : ''}` : 'No profiles configured',
    accounts: accountsError || `${connectedAccounts} connected · ${accounts.length} available`,
    behavior: 'Configure in Flutter Agent settings',
    keybindings: 'Configure in Flutter Agent settings',
    runtime: gateway.environment ? `API :${gateway.environment.apiPort} · engine :${gateway.environment.enginePort}` : 'Local runtime unavailable',
    mcp: mcpError || `${connectedMcp} connected · ${mcpServers.length} configured`,
  });

  const profilesInspector = () => <><SectionIntro scope="Agent / profile">Profiles own identity, model defaults, delegation, skills, MCP access, and protected-action policy. Editing stays in the dedicated profile surface.</SectionIntro>{profiles.length === 0 ? <div className="agent-settings-empty"><strong>No agent profiles configured</strong><p>Create a profile before starting a configured session.</p></div> : <div className="agent-settings-records">{profiles.map((profile) => <article key={profile.id} data-testid={`agent-setting-${profile.id}`}><span className="profile-avatar" aria-hidden="true">{profileAvatarLabel(profile)}</span><span><strong>{profile.label}</strong><small>{profile.enabled ? 'Enabled' : 'Disabled'} · {profile.provider} · {profile.model}{profile.isDefault ? ' · Default' : ''}</small></span></article>)}</div>}<button className="primary-button" type="button" onClick={() => navigate('/profiles')} data-testid="agent-settings-open-profiles">Open profile editor</button></>;
  const accountsInspector = () => <><SectionIntro scope="Desktop local">Authorized model accounts are read from the local OpenCode runtime. Credentials stay outside the renderer.</SectionIntro>{accountsError && <p role="alert">{accountsError}</p>}{!accountsError && accounts.length === 0 && <div className="agent-settings-empty"><strong>No provider accounts reported</strong><p>The local runtime did not return any configured accounts.</p></div>}{accounts.length > 0 && <dl className="property-list">{accounts.map((account) => <div key={account.id}><dt>{account.label}</dt><dd>{account.status}</dd></div>)}</dl>}<GapNotice place="Flutter Agent settings → Accounts">The desktop gateway can read account status but cannot start provider authorization or accept credentials.</GapNotice></>;
  const runtimeInspector = () => <><SectionIntro scope="Desktop local">Rhythm uses a local API and OpenCode engine supplied by the trusted desktop host.</SectionIntro><dl className="property-list"><div><dt>Local API</dt><dd>{gateway.environment ? `127.0.0.1:${gateway.environment.apiPort}` : 'Unavailable'} · {runtimeStatus.api}</dd></div><div><dt>OpenCode engine</dt><dd>{gateway.environment ? `127.0.0.1:${gateway.environment.enginePort}` : 'Unavailable'} · {runtimeStatus.engine}</dd></div></dl>{pendingAction.startsWith('runtime-') && <p role="status">Checking the local runtime…</p>}<div className="agent-settings-actions"><button className="secondary-button" type="button" disabled={Boolean(pendingAction)} onClick={() => void runRuntimeCheck('api')} data-testid="agent-settings-check-api">Check local API</button><button className="secondary-button" type="button" disabled={Boolean(pendingAction)} onClick={() => void runRuntimeCheck('engine')} data-testid="agent-settings-check-engine">Check OpenCode engine</button></div><GapNotice place="Flutter Agent settings → OpenCode server">Changing or restarting the runtime is not exposed by the desktop gateway.</GapNotice></>;
  const mcpInspector = () => <><SectionIntro scope="Workspace">MCP servers provide tools to profiles. Selection only opens this inspector; connections change only when an action below is pressed.</SectionIntro>{mcpError && <p role="alert">{mcpError}</p>}{pendingAction && !pendingAction.startsWith('runtime-') && <p role="status">Updating the MCP configuration…</p>}{actionNotice && <p role="status">{actionNotice}</p>}{!mcpError && mcpServers.length === 0 && <div className="agent-settings-empty"><strong>No MCP servers configured</strong><p>Add servers from Flutter Agent settings.</p></div>}<div className="agent-settings-mcp-list">{mcpServers.map((server) => <article key={server.name} data-testid={`agent-settings-mcp-${server.name}`}><header><div><strong>{server.name}</strong><small>{server.source} · {server.tools.length} tools</small></div><span className="kind-badge">{server.status}</span></header>{server.error && <p role="alert">{server.error}</p>}{server.needsCredentials && <p>Credentials required. Enter them in Flutter Agent settings so they never pass through the renderer.</p>}<div className="agent-settings-actions">{server.status === 'connected' ? <button className="secondary-button" type="button" disabled={Boolean(pendingAction)} onClick={() => void runMcpAction(server, 'disconnect')} data-testid={`agent-settings-mcp-disconnect-${server.name}`}>Disconnect</button> : <button className="primary-button" type="button" disabled={Boolean(pendingAction) || server.needsCredentials} onClick={() => void runMcpAction(server, 'connect')} data-testid={`agent-settings-mcp-connect-${server.name}`}>Connect</button>}<button className="text-danger-button" type="button" disabled={Boolean(pendingAction)} onClick={() => setRemoving(server)} data-testid={`agent-settings-mcp-remove-${server.name}`}>Remove</button></div></article>)}</div><GapNotice place="Flutter Agent settings → MCP servers">Adding servers, entering credentials, and completing browser authorization do not have a safe desktop host handoff yet.</GapNotice></>;

  const inspector = (item: ListInspectorItem | null) => {
    if (!item) return <p>Select a configuration section.</p>;
    switch (item.id) {
      case sectionIds.profiles: return profilesInspector();
      case sectionIds.autoPromotion: return <><SectionIntro scope="Workspace">The server enforces administrator access, eligibility, regression checks, and explicit confirmation.</SectionIntro><AutoPromotionSettings /></>;
      case sectionIds.accounts: return accountsInspector();
      case sectionIds.behavior: return <><SectionIntro scope="Desktop local">This policy controls whether Bash, write, and edit tool calls use a full destructive-action confirmation dialog.</SectionIntro><GapNotice place="Flutter Agent settings → Behavior">The desktop gateway does not expose this preference, so no no-op switch is shown.</GapNotice></>;
      case sectionIds.keybindings: return <><SectionIntro scope="Desktop local">Shortcuts cover send message, new session, cancel turn, and switch session.</SectionIntro><GapNotice place="Flutter Agent settings → Keybindings">The desktop gateway does not expose shortcut persistence, so no temporary editor is shown.</GapNotice></>;
      case sectionIds.runtime: return runtimeInspector();
      case sectionIds.mcp: return mcpInspector();
      default: return null;
    }
  };

  return <Frame slug="agent-settings" title="Agent settings" description="Agent, desktop-local, and workspace configuration in one place." trace={trace}>
    <ListInspector label="Agent settings sections" items={items} selectedId={selectedId} onSelect={setSelectedId} loading={loading} error={error ? <span data-testid="agent-settings-error">{error}</span> : null} toolbar={<button className="secondary-button compact" type="button" onClick={() => void load()} data-testid="agent-settings-refresh"><Icon name="refresh" size={14} />Refresh</button>} inspector={inspector} emptyState={<p>No configuration sections are available.</p>} />
    <FocusDialog open={Boolean(removing)} onClose={() => setRemoving(null)} title="Remove MCP server?" description={removing ? `${removing.name} will be removed from this local workspace configuration.` : ''} testId="agent-settings-mcp-remove-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setRemoving(null)}>Cancel</button><button className="danger-button" type="button" onClick={() => void removeMcp()} data-testid="agent-settings-mcp-remove-confirm">Remove</button></div></FocusDialog>
  </Frame>;
}
