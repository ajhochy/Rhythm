import { useEffect, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import type { McpServer } from '../../gateway/mcp';
import type { AccountChoice } from '../../gateway/sessions';
import type { AutoPromotion } from '../../gateway/auto-promotion';
import { Icon } from '../../icons';
import { useGateway } from '../../gateway/context';
import { useAuthUser } from '../../gateway/auth';
import { useFixtures } from '../../store';
import {
  CANCEL_TURN_KEY_OPTIONS, DEFAULT_LOCAL_USER_PREFERENCES, NEW_SESSION_KEY_OPTIONS,
  readLocalUserPreferences, SEND_MESSAGE_KEY_OPTIONS, sendMessageKeyLabel,
  SWITCH_SESSION_KEY_OPTIONS, USER_PREFERENCES_CHANGED_EVENT, writeLocalUserPreferences,
  type LocalUserPreferences,
} from '../../gateway/user-preferences';
import { ColumnBrowser, type BrowserColumn, type ColumnItem } from '../ColumnBrowser';
import { ExternalLink } from '../ExternalLink';
import { FocusDialog } from '../FocusDialog';
import { useSelectedId } from '../ListInspector';
import { navigate } from '../Shell';
import './AgentSettingsTool.css';
import { HermesAccountsSettings } from './HermesAccountsSettings';
import { ModelCurationPanel } from './ModelCurationPanel';
import { useModelRouting } from './ModelRouting';
import { RuntimeGatewayError, type RuntimeInfo } from '../../gateway/runtime';

type Trace = { method: string; route: string; detail: string };
type LoadSection = 'accounts' | 'openai' | 'mcp' | 'providers';
type ActionScope = 'accounts' | 'openai' | 'providers' | 'mcp' | 'runtime';
type PendingAction = { scope: ActionScope; key: string };
type RuntimeHealthState = { state: 'checking' | 'healthy' | 'failed' };
type ManualWorkstreamsStatus = {
  configured: boolean;
  effective: {
    source: 'preference' | 'environment_override' | 'adopted_runtime' | 'not_launched';
    workstreamsEnabled: boolean | null;
    managedContextExports: boolean | null;
    enabled: boolean | null;
  };
  pendingRelaunch: boolean;
};
type ManualWorkstreamsBridge = {
  getManualWorkstreams?(): Promise<ManualWorkstreamsStatus>;
  setManualWorkstreams?(enabled: boolean): Promise<ManualWorkstreamsStatus>;
  onStatusChange?(callback: (status: unknown) => void): (() => void) | undefined;
};

const manualWorkstreamsUnavailable: ManualWorkstreamsStatus = {
  configured: false,
  effective: { source: 'not_launched', workstreamsEnabled: null, managedContextExports: null, enabled: null },
  pendingRelaunch: true,
};

function manualWorkstreamsBridge(): ManualWorkstreamsBridge | undefined {
  return (window as Window & { rhythmShell?: { agentServer?: ManualWorkstreamsBridge } }).rhythmShell?.agentServer;
}

function manualWorkstreamsStatus(value: unknown): ManualWorkstreamsStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return manualWorkstreamsUnavailable;
  const record = value as Record<string, unknown>;
  const effective = record.effective;
  if (!effective || typeof effective !== 'object' || Array.isArray(effective)) return manualWorkstreamsUnavailable;
  const launch = effective as Record<string, unknown>;
  const source = launch.source;
  if (!['preference', 'environment_override', 'adopted_runtime', 'not_launched'].includes(String(source))) return manualWorkstreamsUnavailable;
  const optionalBoolean = (candidate: unknown) => candidate === true ? true : candidate === false ? false : null;
  return {
    configured: record.configured === true,
    effective: {
      source: source as ManualWorkstreamsStatus['effective']['source'],
      workstreamsEnabled: optionalBoolean(launch.workstreamsEnabled),
      managedContextExports: optionalBoolean(launch.managedContextExports),
      enabled: optionalBoolean(launch.enabled),
    },
    pendingRelaunch: record.pendingRelaunch === true,
  };
}

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

// Profiles are edited only in the Profiles tool (/profiles); this page keeps the
// settings no other tool owns.
const sectionIds = {
  autoPromotion: 'auto-promotion',
  accounts: 'accounts',
  models: 'models',
  modelRouting: 'model-routing',
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

function useDestructiveModalPreference() {
  const auth = useAuthUser();
  const userId = auth?.user.id ?? 'fixture';
  const [enabled, setEnabled] = useState(() => readLocalUserPreferences(userId).requireDestructiveModal);
  useEffect(() => {
    const sync = () => setEnabled(readLocalUserPreferences(userId).requireDestructiveModal);
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener(USER_PREFERENCES_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(USER_PREFERENCES_CHANGED_EVENT, sync);
    };
  }, [userId]);
  const update = (next: boolean) => {
    writeLocalUserPreferences(userId, { requireDestructiveModal: next });
    setEnabled(next);
  };
  return [enabled, update] as const;
}

function BehaviorSettings({ enabled, onChange }: { enabled: boolean; onChange(value: boolean): void }) {
  return <section className="agent-settings-local-preference" aria-labelledby="destructive-modal-label">
    <label>
      <span><strong id="destructive-modal-label">Destructive-tool confirmation dialog</strong><small>When enabled, Bash, write, edit, and patch approvals open a focused confirmation dialog. Other approvals stay inline.</small></span>
      <input type="checkbox" role="switch" aria-label="Destructive-tool confirmation dialog" checked={enabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
    <ScopeLabel>This device · Account scoped</ScopeLabel>
  </section>;
}

function ManualWorkstreamsSettings({ value, loading, saving, available, error, onChange }: {
  value: ManualWorkstreamsStatus;
  loading: boolean;
  saving: boolean;
  available: boolean;
  error: string;
  onChange(enabled: boolean): void;
}) {
  const source = value.effective.source === 'environment_override' ? 'Explicit launch environment override'
    : value.effective.source === 'adopted_runtime' ? 'Adopted runtime (not configured by Rhythm)'
      : value.effective.source === 'not_launched' ? 'No owned local runtime launched yet'
        : 'Saved device preference';
  const effectiveState = value.effective.enabled === true
    ? 'Enabled'
    : value.effective.enabled === false
      ? 'Off'
      : 'Unavailable';
  const effectiveReason = value.effective.enabled !== null
    ? 'Observed from the current owned launch.'
    : value.effective.source === 'adopted_runtime'
      ? 'Rhythm does not control an adopted runtime.'
      : 'No owned local launch has reported an effective state.';
  return <section className="agent-settings-local-preference" aria-labelledby="manual-workstreams-label" data-testid="manual-workstreams-settings">
    <label>
      <span><strong id="manual-workstreams-label">Enable manual workstreams</strong><small>Applies only to the next normal local runtime that Rhythm itself launches.</small></span>
      <input type="checkbox" role="switch" aria-label="Enable manual workstreams" checked={value.configured} disabled={loading || saving || !available} onChange={(event) => onChange(event.target.checked)} data-testid="manual-workstreams-toggle" />
    </label>
    <ScopeLabel>This device · Signed desktop app · Next owned launch</ScopeLabel>
    <dl className="agent-settings-property-list">
      <div><dt>Configured</dt><dd>{value.configured ? 'Enabled for the next owned launch' : 'Off'}</dd></div>
      <div><dt>Effective state</dt><dd>{effectiveState}</dd></div>
      <div><dt>State reason</dt><dd>{effectiveReason}</dd></div>
      <div><dt>Source</dt><dd>{source}</dd></div>
      <div><dt>Relaunch</dt><dd>{value.pendingRelaunch ? 'Saved for the next owned normal launch. Quit and reopen Rhythm when ready; the current runtime is unchanged.' : 'No preference relaunch is pending.'}</dd></div>
    </dl>
    <p>Saving never starts or restarts the runtime, creates a workstream, dispatches a worker, resumes work, or wakes a model.</p>
    <p>Work remains Explicit Run next only. A selected read-only profile, budget authorization, and Pause controls are still required.</p>
    {!available && <p className="agent-settings-runtime-owner-note">Manual workstreams can be configured only from the signed desktop app.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function useKeybindingPreferences() {
  const auth = useAuthUser();
  const userId = auth?.user.id ?? 'fixture';
  const [preferences, setPreferences] = useState(() => readLocalUserPreferences(userId));
  useEffect(() => {
    const sync = () => setPreferences(readLocalUserPreferences(userId));
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener(USER_PREFERENCES_CHANGED_EVENT, sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener(USER_PREFERENCES_CHANGED_EVENT, sync); };
  }, [userId]);
  const update = (patch: Partial<LocalUserPreferences>) => setPreferences(writeLocalUserPreferences(userId, patch));
  const reset = () => update({
    sendKey: DEFAULT_LOCAL_USER_PREFERENCES.sendKey,
    newSessionKey: DEFAULT_LOCAL_USER_PREFERENCES.newSessionKey,
    cancelTurnKey: DEFAULT_LOCAL_USER_PREFERENCES.cancelTurnKey,
    switchSessionKey: DEFAULT_LOCAL_USER_PREFERENCES.switchSessionKey,
  });
  return [preferences, update, reset] as const;
}

function KeybindingsSettings({ preferences, update, reset }: {
  preferences: LocalUserPreferences;
  update(patch: Partial<LocalUserPreferences>): void;
  reset(): void;
}) {
  const fields = [
    ['Send message', 'sendKey', SEND_MESSAGE_KEY_OPTIONS],
    ['New session', 'newSessionKey', NEW_SESSION_KEY_OPTIONS],
    ['Cancel turn', 'cancelTurnKey', CANCEL_TURN_KEY_OPTIONS],
    ['Switch session', 'switchSessionKey', SWITCH_SESSION_KEY_OPTIONS],
  ] as const;
  return <section className="agent-settings-local-preference agent-settings-keybindings">
    <div className="agent-settings-keybinding-fields">{fields.map(([label, key, options]) => <label key={key}>{label}
      <select value={preferences[key]} onChange={(event) => update({ [key]: event.target.value } as Partial<LocalUserPreferences>)} aria-label={`${label} shortcut`}>
        {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
    </label>)}</div>
    <div className="agent-settings-actions"><button className="secondary-button" type="button" onClick={reset}>Reset shortcuts</button></div>
    <ScopeLabel>This device · Account scoped</ScopeLabel>
  </section>;
}

// Ported from apps/desktop_flutter/.../ai_account_section.dart — same endpoints and
// method indexes. method 1 = paste-back (openai); method 0 = the plugin's own local
// listener completes the exchange (google), so the UI only re-checks the provider list.
export const providerCatalog = [
  { id: 'openai', label: 'OpenAI / Codex', kind: 'oauth' as const, method: 1, detail: 'Sign in with ChatGPT, then paste the callback URL or code back here.' },
  { id: 'google', label: 'Google / Gemini', kind: 'oauth' as const, method: 0, detail: 'Sign in with Google; the local listener finishes the exchange, then re-check below.' },
  { id: 'opencode', label: 'OpenCode', kind: 'key' as const, method: 0, detail: 'Paste an OpenCode API key.' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'key' as const, method: 0, detail: 'Last-resort tier of the model fallback chain. Paste an OpenRouter API key.' },
];
export type ProviderCatalogEntry = typeof providerCatalog[number];
// Providers whose sign-in is multi-account and lives in Accounts. Models still curates
// their models, but offers no connect form for them.
export const ACCOUNT_MANAGED_PROVIDERS: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI' };
export type ProviderAuthFlow = { id: string; authUrl: string; instructions: string; method: number };

// #1580 S2: extracted so the new provider-first Models section can render an identical
// connect card in place, instead of a second hand-rolled OAuth/API-key UI (issue explicitly
// asks to reuse the existing flows, not fork them).
export function ProviderConnectCard({ provider, connected, badge, statusKnown, confirmed, apiKeyValue, pending, onApiKeyChange, onAuthorize, onSaveKey }: {
  // statusKnown: authProviders has ever loaded — drives the "Status unknown" badge styling.
  // confirmed: that AND the current reload finished (providersCurrent) — drives needs-relogin,
  // so a stale "Last known Not connected" mid-reload does not flash the warning border/badge.
  provider: ProviderCatalogEntry; connected: boolean; badge: string; statusKnown: boolean; confirmed: boolean;
  apiKeyValue: string; pending: boolean; onApiKeyChange(value: string): void; onAuthorize(): void; onSaveKey(event: FormEvent): void;
}) {
  return <article className={`agent-settings-account${confirmed && !connected ? ' needs-relogin' : ''}`} data-testid={`agent-settings-provider-${provider.id}`}>
    <span><strong>{provider.label}</strong><small>{provider.detail}</small><span className={`kind-badge${statusKnown ? '' : ' agent-settings-status-unknown'}`} data-testid={`agent-settings-provider-status-${provider.id}`}>{badge}</span></span>
    {provider.kind === 'oauth' && <div className="agent-settings-actions"><button className={connected ? 'secondary-button' : 'primary-button'} type="button" disabled={pending} onClick={onAuthorize} data-testid={`agent-settings-provider-authorize-${provider.id}`}>{connected ? 'Reconnect' : 'Connect'}</button></div>}
    {provider.kind === 'key' && <form className="agent-settings-form" onSubmit={onSaveKey}><label>API key<input required type="password" autoComplete="off" value={apiKeyValue} onChange={(event) => onApiKeyChange(event.target.value)} data-testid={`agent-settings-provider-key-${provider.id}`} /></label><button className="primary-button" type="submit" disabled={pending} data-testid={`agent-settings-provider-key-save-${provider.id}`}>{connected ? 'Replace key' : 'Save key'}</button></form>}
  </article>;
}

export function ProviderAuthFlowForm({ flow, code, pending, onCodeChange, onSubmit, onCheck }: {
  flow: ProviderAuthFlow; code: string; pending: boolean; onCodeChange(value: string): void; onSubmit(event: FormEvent): void; onCheck(): void;
}) {
  return <div className="agent-settings-form" data-testid={`agent-settings-provider-flow-${flow.id}`}>
    <h3>Authorizing {flow.id}</h3>
    {flow.instructions && <p>{flow.instructions}</p>}
    <p><ExternalLink href={flow.authUrl} linkTestId="agent-settings-provider-authorization-link" copyTestId="agent-settings-provider-authorization-copy">Open {flow.id} authorization</ExternalLink></p>
    {flow.method === 1
      ? <form className="agent-settings-form" onSubmit={onSubmit}><label>Callback URL or code<input required value={code} onChange={(event) => onCodeChange(event.target.value)} data-testid="agent-settings-provider-code" /></label><button className="primary-button" type="submit" disabled={pending} data-testid="agent-settings-provider-complete">Finish connecting</button></form>
      : <button className="primary-button" type="button" disabled={pending} onClick={onCheck} data-testid="agent-settings-provider-check">I finished sign-in — check connection</button>}
  </div>;
}

const accountNeedsRelogin = (account: AccountChoice) => !/^(ok|connected|active|authorized)$/i.test(account.status);

const mcpStatusPresentation = (status: string) => {
  const normalized = status.trim().toLocaleLowerCase();
  const labels: Record<string, string> = {
    connected: 'Connected',
    needs_auth: 'Needs authorization',
    failed: 'Failed',
    disabled: 'Disabled',
    disconnected: 'Disconnected',
    needs_client_registration: 'Needs client registration',
  };
  return {
    className: `status-${normalized.replace(/[^a-z0-9]+/g, '-') || 'unknown'}`,
    label: labels[normalized] ?? (normalized.split(/[_\s-]+/).filter(Boolean).map((word) => `${word[0]?.toLocaleUpperCase() ?? ''}${word.slice(1)}`).join(' ') || 'Unknown'),
  };
};

// Inspector header fact line: a sanitized locator only (program name / host —
// never args, env, or a full URL, any of which may carry secrets).
function mcpTransportSummary(server: McpServer): string | null {
  if (!server.transport) return null;
  return server.transport.kind === 'remote' ? `Remote · ${server.transport.host}` : `Local · ${server.transport.program}`;
}

function baseItems(status: Partial<Record<keyof typeof sectionIds, string>> = {}, badges: Partial<Record<keyof typeof sectionIds, string>> = {}): ColumnItem[] {
  return [
    { id: sectionIds.accounts, title: 'Accounts', subtitle: status.accounts ?? 'Authorized model provider accounts' },
    { id: sectionIds.models, title: 'Models', subtitle: status.models ?? 'Provider connections and model curation' },
    { id: sectionIds.modelRouting, title: 'Model routing', subtitle: status.modelRouting ?? 'Router backend, tiers and routable models' },
    { id: sectionIds.mcp, title: 'MCP servers', subtitle: status.mcp ?? 'Workspace tool connections and status' },
    // ponytail: Auto-promotion stays here for now; it may belong with the Skills tool.
    { id: sectionIds.autoPromotion, title: 'Auto-promotion', subtitle: status.autoPromotion ?? 'Workspace eligibility and confirmation gates', badge: badges.autoPromotion },
    { id: sectionIds.behavior, title: 'Behavior', subtitle: status.behavior ?? 'Destructive-tool confirmation policy' },
    { id: sectionIds.keybindings, title: 'Keybindings', subtitle: status.keybindings ?? 'Desktop keyboard shortcuts' },
    { id: sectionIds.runtime, title: 'Runtime / OpenCode server', subtitle: status.runtime ?? 'Desktop-local API and engine endpoints' },
  ];
}

/** A category renders either one form, or an item list whose selection drives the inspector. */
type SettingsView =
  | { kind: 'form'; content: ReactNode }
  /** The category builds its own columns after the sections column (e.g. groups → items → inspector). */
  | { kind: 'columns'; columns: BrowserColumn[] }
  | { kind: 'list'; label: string; items: ColumnItem[]; adds?: { id: string; label: string; testId: string }[]; emptyState?: ReactNode; header?: ReactNode; detail(itemId: string | null): { title: string; content: ReactNode } };

/** URL-backed path: ?settingsSection=<category>&settingsItem=<item>. */
function useSettingsPath() {
  const [section, setSection] = useSelectedId('settingsSection');
  const [item, setItem] = useSelectedId('settingsItem');
  const selectSection = (id: string) => { if (id !== section) setItem(null); setSection(id); };
  return { section: section ?? sectionIds.accounts, item, selectSection, setItem };
}

function SettingsBrowser({ categories, loading = false, emptyState, toolbar, view, path }: {
  categories: ColumnItem[]; loading?: boolean; emptyState: ReactNode; toolbar: ReactNode;
  view(sectionId: string): SettingsView | null; path: ReturnType<typeof useSettingsPath>;
}) {
  const category = categories.find((entry) => entry.id === path.section);
  const inspector = (title: string, content: ReactNode): BrowserColumn => ({ kind: 'panel', key: 'inspector', label: title, testId: 'settings-column-inspector', bodyTestId: 'list-inspector-detail', children: content });
  const columns: BrowserColumn[] = [{
    kind: 'list', key: 'categories', label: 'Agent settings sections', testId: 'settings-column-categories', items: categories,
    selectedId: category?.id ?? null, onSelect: path.selectSection, header: toolbar, loading, emptyState, resizeKey: 'layout.list-inspector.agent-settings-sections',
  }];
  const current = !loading && category ? view(category.id) : null;
  if (!loading && !category) {
    columns.push(inspector('Item not found', <><p role="status" aria-live="polite">This section was not found or is no longer available. Select another section from the list.</p>
      {path.section === 'profiles' && <><p>Profiles are edited in the Profiles tool.</p><button className="primary-button" type="button" onClick={() => navigate('/profiles')} data-testid="agent-settings-open-profiles">Open Profiles</button></>}</>));
  } else if (current?.kind === 'form') {
    columns.push(inspector(category!.title, current.content));
  } else if (current?.kind === 'columns') {
    columns.push(...current.columns);
  } else if (current?.kind === 'list') {
    const adds = current.adds ?? [];
    const itemId = current.items.some((item) => item.id === path.item) || adds.some((add) => add.id === path.item) ? path.item
      : current.items[0]?.id ?? adds[0]?.id ?? null;
    columns.push({
      kind: 'list', key: 'items', label: current.label, testId: 'settings-column-items', items: current.items,
      selectedId: itemId, onSelect: path.setItem, emptyState: current.emptyState, header: current.header,
      adds: adds.map((add) => ({ label: add.label, testId: add.testId, selected: itemId === add.id, onClick: () => path.setItem(add.id) })),
    });
    const detail = current.detail(itemId);
    columns.push(inspector(detail.title, detail.content));
  }
  return <ColumnBrowser label="Agent settings" columns={columns} className="agent-settings-browser" />;
}

type AutoPromotionSettingsProps = {
  state: AutoPromotion | null;
  loading: boolean;
  error: string;
  reload: (clearError?: boolean) => Promise<void>;
  reportError: (message: string) => void;
};

export function AutoPromotionSettings({ state, loading, error, reload, reportError }: AutoPromotionSettingsProps) {
  const gateway = useGateway();
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const enabled = state?.state.autoPromotionEnabled ?? false;
  const canEnable = Boolean(state?.availability && state.state.autoPromotionEligible && state.state.totalRegressions === 0);
  const unavailable = Boolean(error && !state);
  const badge = unavailable ? 'Unavailable' : !state ? 'Checking' : enabled ? 'Enabled' : 'Disabled';
  const blockedTitle = unavailable
    ? 'Auto-promotion service is unreachable. Retry the service check.'
    : !state
      ? 'Checking the auto-promotion service.'
      : !state.availability
        ? 'Auto-promotion is unavailable for this workspace.'
        : !state.state.autoPromotionEligible
          ? 'This workspace is not eligible for auto-promotion.'
          : state.state.totalRegressions > 0
            ? 'Resolve recorded regressions before enabling auto-promotion.'
            : undefined;
  const submit = async () => {
    setConfirm(false);
    setSubmitting(true);
    let failed = false;
    try {
      await gateway.domains.autoPromotion!.setEnabled(!enabled);
    } catch (err) {
      failed = true;
      reportError(err instanceof Error ? err.message : 'Auto-promotion update failed');
    }
    await reload(!failed);
    setSubmitting(false);
  };
  return <div className="auto-promotion-card" data-testid="auto-promotion-settings">
    <header><div><p>Verified changes may be promoted automatically only when the organization is eligible.</p></div><span className={`kind-badge${enabled ? ' active' : ''}${unavailable ? ' unavailable' : ''}`}>{badge}</span></header>
    {loading && !state && <p role="status">Checking auto-promotion state…</p>}
    {error && <div className="auto-promotion-error" role="alert"><span aria-hidden="true">!</span><p>{error}</p><button className="secondary-button" type="button" onClick={() => void reload()}>Retry</button></div>}
    {state && <dl className="agent-settings-property-list"><div><dt>Availability</dt><dd>{state.availability ? 'Available' : 'Unavailable'}</dd></div><div><dt>Eligibility</dt><dd>{state.state.autoPromotionEligible ? 'Eligible' : 'Not eligible'}</dd></div><div><dt>Verified changes</dt><dd>{state.state.totalVerified} / {state.state.trustThreshold}</dd></div><div><dt>Regressions</dt><dd>{state.state.totalRegressions}</dd></div>{state.state.enabledAt && <div><dt>Enabled</dt><dd>{state.state.enabledAt}</dd></div>}</dl>}
    <footer><button className={enabled ? 'danger-button' : 'primary-button'} type="button" disabled={submitting || loading || !enabled && !canEnable} title={!enabled && !canEnable ? blockedTitle : undefined} onClick={() => setConfirm(true)} data-testid="auto-promotion-toggle">{enabled ? 'Disable' : 'Enable'}</button></footer>
    <FocusDialog open={confirm} onClose={() => setConfirm(false)} title={enabled ? 'Disable auto-promotion?' : 'Enable auto-promotion?'} description={enabled ? 'Disable is an emergency stop. The server requires your explicit acknowledgement.' : 'Verified changes may be promoted automatically when eligibility is maintained.'} testId="auto-promotion-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setConfirm(false)} data-testid="auto-promotion-cancel">Cancel</button><button className={enabled ? 'danger-button' : 'primary-button'} type="button" onClick={() => void submit()} data-testid="auto-promotion-confirm">Confirm</button></div></FocusDialog>
  </div>;
}

export function FixtureAgentSettingsTool({ Frame }: AgentSettingsToolProps) {
  const path = useSettingsPath();
  const [requireDestructiveModal, setRequireDestructiveModal] = useDestructiveModalPreference();
  const [keybindings, updateKeybindings, resetKeybindings] = useKeybindingPreferences();
  const [trace, setTrace] = useState<Trace>({ method: 'LOCAL', route: 'fixture://agent-settings', detail: 'Local runtime defaults loaded' });
  const items = baseItems({
    autoPromotion: 'Live workspace status required',
    accounts: 'Live local runtime required',
    models: 'Live local runtime required',
    modelRouting: 'Live local runtime required',
    behavior: `${requireDestructiveModal ? 'Full dialog' : 'Inline approval'} · This device`,
    keybindings: `${sendMessageKeyLabel(keybindings.sendKey)} to send · This device`,
    runtime: 'Fixture preview · not connected',
    mcp: 'Live local runtime required',
  });
  const content = (id: string) => {
    switch (id) {
      case sectionIds.autoPromotion:
        return <><SectionIntro scope="Workspace">Auto-promotion is controlled by workspace eligibility and always requires an explicit confirmation.</SectionIntro><GapNotice place="a signed-in live workspace">This fixture cannot read or change auto-promotion.</GapNotice></>;
      case sectionIds.accounts:
        return <><SectionIntro scope="Desktop local">Provider authorization is stored by the local OpenCode runtime.</SectionIntro><GapNotice place="a signed-in live workspace">The fixture cannot call the existing account authorization endpoints.</GapNotice><HermesAccountsSettings /></>;
      case sectionIds.modelRouting:
        return <><SectionIntro scope="Desktop local">Model routing reads and writes the live router settings and catalog.</SectionIntro><GapNotice place="a signed-in live workspace">The fixture cannot read the live router catalog.</GapNotice></>;
      case sectionIds.models:
        return <><SectionIntro scope="Desktop local">Model curation reads and writes the live provider catalog and visibility store.</SectionIntro><GapNotice place="a signed-in live workspace">The fixture cannot read or curate the live model catalog.</GapNotice></>;
      case sectionIds.behavior:
        return <><SectionIntro scope="Desktop local">Destructive tools can require a full confirmation dialog before they run.</SectionIntro><BehaviorSettings enabled={requireDestructiveModal} onChange={setRequireDestructiveModal} /></>;
      case sectionIds.keybindings:
        return <><SectionIntro scope="Desktop local">Keyboard shortcuts control send, new session, cancel turn, and session switching.</SectionIntro><KeybindingsSettings preferences={keybindings} update={updateKeybindings} reset={resetKeybindings} /></>;
      case sectionIds.runtime:
        return <><SectionIntro scope="Desktop local">The fixture is intentionally disconnected and does not claim a live runtime.</SectionIntro><div className="agent-settings-actions"><button className="secondary-button" type="button" onClick={() => setTrace({ method: 'LOCAL', route: 'fixture://agent-settings/connection', detail: 'Desktop endpoint is local' })}>Desktop endpoint</button><button className="secondary-button" type="button" onClick={() => setTrace({ method: 'LOCAL', route: 'fixture://agent-settings/offline-buffer', detail: 'Offline buffering is local UI state until reconnect' })}>Offline buffering</button></div><div className="agent-settings-empty"><strong>Live runtime controls are unavailable in this fixture</strong><p>Open the signed desktop app to inspect or restart its owned runtime.</p></div></>;
      case sectionIds.mcp:
        return <><SectionIntro scope="Workspace">MCP servers add tool capabilities to configured profiles.</SectionIntro><GapNotice place="Flutter Agent settings → MCP servers">The fixture has no live MCP catalog.</GapNotice></>;
      default:
        return null;
    }
  };
  return <Frame slug="agent-settings" title="Agent settings" description="Agent, desktop-local, and workspace configuration in one place." trace={trace}>
    <SettingsBrowser path={path} categories={items} emptyState="No configuration sections are available."
      toolbar={<button className="secondary-button compact" type="button" onClick={() => setTrace({ method: 'LOCAL', route: 'fixture://agent-settings', detail: 'Local runtime defaults refreshed' })} data-testid="agent-settings-refresh"><Icon name="refresh" size={14} />Refresh</button>}
      view={(id) => ({ kind: 'form', content: content(id) })} />
  </Frame>;
}

export function LiveSettingsTool({ Frame }: AgentSettingsToolProps) {
  const gateway = useGateway();
  const sessions = gateway.domains.sessions!;
  const mcp = gateway.domains.mcp!;
  // Every account mutation below also nudges the shared store catalog (store.tsx), so
  // Session settings / new-session / Profiles account pickers reflect it without a reopen.
  const { refreshCatalog } = useFixtures();
  const path = useSettingsPath();
  const selectedId = path.section;
  const modelRouting = useModelRouting({ active: selectedId === sectionIds.modelRouting, onOpenCuration: () => path.selectSection(sectionIds.models) });
  const [requireDestructiveModal, setRequireDestructiveModal] = useDestructiveModalPreference();
  const [keybindings, updateKeybindings, resetKeybindings] = useKeybindingPreferences();
  const [accounts, setAccounts] = useState<AccountChoice[]>([]);
  const [openaiAccounts, setOpenaiAccounts] = useState<AccountChoice[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [autoPromotionState, setAutoPromotionState] = useState<AutoPromotion | null>(null);
  const [autoPromotionLoading, setAutoPromotionLoading] = useState(true);
  const [autoPromotionError, setAutoPromotionError] = useState('');
  const [loading, setLoading] = useState(true);
  const [accountsError, setAccountsError] = useState('');
  const [openaiError, setOpenaiError] = useState('');
  const [mcpError, setMcpError] = useState('');
  const [providerError, setProviderError] = useState('');
  const [accountActionError, setAccountActionError] = useState('');
  const [mcpActionError, setMcpActionError] = useState('');
  const [retrying, setRetrying] = useState<Partial<Record<LoadSection, boolean>>>({});
  const [retryStatus, setRetryStatus] = useState<Partial<Record<LoadSection, string>>>({});
  const retryInFlight = useRef(new Set<LoadSection>());
  const statusRefs = useRef<Partial<Record<LoadSection, HTMLParagraphElement | null>>>({});
  const sectionGeneration = useRef<Record<LoadSection, number>>({ accounts: 0, openai: 0, mcp: 0, providers: 0 });
  const loadGeneration = useRef(0);
  const traceGeneration = useRef(0);
  const [runtimeStatus, setRuntimeStatus] = useState<Record<'api' | 'engine', RuntimeHealthState>>({ api: { state: 'checking' }, engine: { state: 'checking' } });
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [runtimeInfoError, setRuntimeInfoError] = useState('');
  const [runtimeActionError, setRuntimeActionError] = useState('');
  const [restartEngineConfirm, setRestartEngineConfirm] = useState(false);
  const [localRuntime, setLocalRuntime] = useState<{ available: boolean; ownership: 'electron' | 'external' | 'none'; owned: boolean; status: string; errorMessage?: string | null }>({ available: false, ownership: 'none', owned: false, status: 'checking' });
  const [manualWorkstreams, setManualWorkstreams] = useState<ManualWorkstreamsStatus>(manualWorkstreamsUnavailable);
  const [manualWorkstreamsLoading, setManualWorkstreamsLoading] = useState(true);
  const [manualWorkstreamsSaving, setManualWorkstreamsSaving] = useState(false);
  const [manualWorkstreamsError, setManualWorkstreamsError] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionNotices, setActionNotices] = useState<Partial<Record<ActionScope, string>>>({});
  const [removing, setRemoving] = useState<McpServer | null>(null);
  const [removingAccount, setRemovingAccount] = useState<AccountChoice | null>(null);
  const [removingOpenai, setRemovingOpenai] = useState<AccountChoice | null>(null);
  const [openaiDraft, setOpenaiDraft] = useState({ accountId: '', label: '', code: '' });
  const [openaiAuthorizationUrl, setOpenaiAuthorizationUrl] = useState('');
  const [renameDraft, setRenameDraft] = useState<{ key: string; label: string } | null>(null);
  const [accountDraft, setAccountDraft] = useState({ accountId: '', label: '', code: '' });
  const [accountAuthorizationUrl, setAccountAuthorizationUrl] = useState('');
  const [authProviders, setAuthProviders] = useState<string[] | null>(null);
  const [providersCurrent, setProvidersCurrent] = useState(false);
  const [providerFlow, setProviderFlow] = useState<{ id: string; authUrl: string; instructions: string; method: number } | null>(null);
  const [providerDraft, setProviderDraft] = useState<{ code: string; apiKey: Record<string, string> }>({ code: '', apiKey: {} });
  const [mcpDraft, setMcpDraft] = useState({ name: '', kind: 'remote' as 'remote' | 'local', value: '' });
  const [mcpSearch, setMcpSearch] = useState('');
  const [mcpCredentials, setMcpCredentials] = useState<Record<string, Record<string, string>>>({});
  const [mcpAuthorization, setMcpAuthorization] = useState<{ name: string; url: string } | null>(null);
  const [mcpToolFilter, setMcpToolFilter] = useState('');
  const [expandedMcpTool, setExpandedMcpTool] = useState<string | null>(null);
  // A new inspector selection starts with a clean tool search and no expanded row.
  useEffect(() => { setMcpToolFilter(''); setExpandedMcpTool(null); }, [path.item]);
  const [trace, setTrace] = useState<Trace>({ method: 'GET', route: '/agent-configs', detail: 'Loading live agent configuration' });
  const actionPending = (scope: ActionScope, key?: string) => pendingAction?.scope === scope && (key === undefined || pendingAction.key === key);
  const setActionNotice = (scope: ActionScope, notice: string) => setActionNotices((current) => ({
    ...current,
    ...(scope === 'accounts' ? { providers: '' } : scope === 'providers' ? { accounts: '' } : {}),
    [scope]: notice,
  }));

  const loadAutoPromotion = async (clearError = true) => {
    setAutoPromotionLoading(true);
    if (clearError) setAutoPromotionError('');
    try {
      const value = await gateway.domains.autoPromotion!.get();
      setAutoPromotionState(value);
      if (clearError) setAutoPromotionError('');
    } catch (err) {
      setAutoPromotionState(null);
      setAutoPromotionError(err instanceof Error ? err.message : 'Auto-promotion service unavailable');
    } finally {
      setAutoPromotionLoading(false);
    }
  };

  useEffect(() => { setActionNotices({}); }, [selectedId]);
  useEffect(() => { void loadAutoPromotion(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const routes: Record<LoadSection, string> = { accounts: '/opencode/auth/accounts', openai: '/opencode/auth/openai/accounts', mcp: '/opencode/mcp', providers: '/opencode/auth' };
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
      let result: string[] | undefined;
      if (section === 'accounts') {
        const value = await (sessions.accounts?.() ?? Promise.resolve([]));
        if (current()) { setAccounts(value); setAccountsError(''); }
      } else if (section === 'openai') {
        const value = await (sessions.openaiAccounts?.() ?? Promise.resolve([]));
        if (current()) { setOpenaiAccounts(value); setOpenaiError(''); }
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
      if (current()) {
        const message = err instanceof Error ? err.message : `${section} could not be loaded`;
        if (section === 'accounts') setAccountsError(message);
        if (section === 'openai') setOpenaiError(message);
        if (section === 'mcp') setMcpError(message);
        if (section === 'providers') setProviderError(message);
      }
      throw err;
    }
  };
  const load = async () => {
    const run = ++loadGeneration.current;
    const traceRun = ++traceGeneration.current;
    const results = await Promise.allSettled((['accounts', 'openai', 'mcp', 'providers'] as LoadSection[]).map((section) => readSection(section)));
    if (run !== loadGeneration.current) return;
    if (traceRun === traceGeneration.current) {
      const failed = results.flatMap((result, index) => result.status === 'rejected' ? [['accounts', 'OpenAI accounts', 'MCP servers', 'providers'][index]] : []);
      setTrace({ method: 'GET', route: '/opencode/auth/accounts · /opencode/auth/openai/accounts · /opencode/mcp · /opencode/auth', detail: failed.length ? `${failed.join(', ')} failed to load` : 'Agent settings loaded' });
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
    setPendingAction({ scope: 'providers', key: `start:${provider.id}` }); setAccountActionError(''); setActionNotice('providers', '');
    setProviderFlow(null); setProviderDraft((current) => ({ ...current, code: '' }));
    try {
      const result = await sessions.authorizeProvider(provider.id, provider.method);
      setProviderFlow({ id: provider.id, authUrl: result.authUrl, instructions: result.instructions, method: provider.method });
      setActionNotice('providers', `Authorization started for ${provider.label}. Open the provider page to sign in.`);
      setTrace({ method: 'GET', route: `/opencode/auth/${provider.id}/authorize`, detail: `Authorization started for ${provider.id}` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Provider authorization could not be started'); }
    finally { setPendingAction(null); }
  };

  const completeProviderAuth = async (event: FormEvent) => {
    event.preventDefault();
    if (!providerFlow || !sessions.completeProviderAuth) return;
    const flow = providerFlow;
    setPendingAction({ scope: 'providers', key: `complete:${flow.id}` }); setAccountActionError(''); setActionNotice('providers', '');
    try {
      await sessions.completeProviderAuth(flow.id, providerDraft.code.trim(), flow.method);
      await reloadProviders();
      setProviderFlow(null); setProviderDraft((current) => ({ ...current, code: '' }));
      setActionNotice('providers', `${flow.id} connected.`);
      setTrace({ method: 'GET', route: `/opencode/auth/${flow.id}/callback`, detail: `${flow.id} authorization completed` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Provider authorization could not be completed'); }
    finally { setPendingAction(null); }
  };

  // method 0 providers are finished by the engine plugin's own listener, so the UI
  // only needs to re-read the authorized list instead of exchanging a code itself.
  const checkProviderAuth = async () => {
    if (!providerFlow) return;
    const flow = providerFlow;
    setPendingAction({ scope: 'providers', key: `check:${flow.id}` }); setAccountActionError('');
    const generation = sectionGeneration.current.providers + 1;
    const current = () => generation === sectionGeneration.current.providers;
    try {
      const providers = await readSection('providers', 'action') as string[];
      if (!current()) return;
      const connected = providers.includes(flow.id);
      if (connected) setProviderFlow(null);
      setActionNotice('providers', connected ? `${flow.id} connected.` : `${flow.id} is not connected yet. Finish the browser sign-in, then check again.`);
      setTrace({ method: 'GET', route: '/opencode/auth', detail: `${flow.id} is ${connected ? 'connected' : 'not connected yet'}` });
    } catch (err) { if (current()) setAccountActionError(err instanceof Error ? err.message : 'Provider status could not be read'); }
    finally { setPendingAction(null); }
  };

  const saveProviderApiKey = async (event: FormEvent, provider: typeof providerCatalog[number]) => {
    event.preventDefault();
    if (!sessions.saveProviderApiKey) return;
    setPendingAction({ scope: 'providers', key: `key:${provider.id}` }); setAccountActionError(''); setActionNotice('providers', '');
    try {
      await sessions.saveProviderApiKey(provider.id, providerDraft.apiKey[provider.id] ?? '');
      await reloadProviders();
      setProviderDraft((current) => ({ ...current, apiKey: { ...current.apiKey, [provider.id]: '' } }));
      setActionNotice('providers', `${provider.label} connected.`);
      setTrace({ method: 'POST', route: `/opencode/auth/${provider.id}`, detail: `${provider.id} API key stored` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Provider API key could not be saved'); }
    finally { setPendingAction(null); }
  };

  // Re-authorizing an existing account is the same login-start/login-complete
  // pair as a new one — the server upserts by id and keeps the default set.
  const beginAccountLogin = async (accountId: string, label: string) => {
    if (!sessions.startAccountLogin || !accountId) return;
    setPendingAction({ scope: 'accounts', key: `start:${accountId}` }); setAccountActionError(''); setActionNotice('accounts', ''); setAccountAuthorizationUrl('');
    setAccountDraft({ accountId, label, code: '' });
    try {
      const result = await sessions.startAccountLogin({ accountId, label: label || accountId });
      setAccountAuthorizationUrl(result.authorizationUrl);
      setActionNotice('accounts', 'Authorization started. Open the provider page, then paste the returned code.');
      setTrace({ method: 'POST', route: '/opencode/auth/accounts/login-start', detail: `Authorization started for ${accountId}` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Account authorization could not be started'); }
    finally { setPendingAction(null); }
  };

  const startAccountLogin = async (event: FormEvent) => {
    event.preventDefault();
    await beginAccountLogin(accountDraft.accountId.trim(), accountDraft.label.trim() || accountDraft.accountId.trim());
  };

  const completeAccountLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessions.completeAccountLogin) return;
    setPendingAction({ scope: 'accounts', key: `complete:${accountDraft.accountId.trim()}` }); setAccountActionError(''); setActionNotice('accounts', '');
    try {
      await sessions.completeAccountLogin({ accountId: accountDraft.accountId.trim(), code: accountDraft.code.trim() });
      await reloadAccounts();
      void refreshCatalog({ force: true });
      setAccountDraft({ accountId: '', label: '', code: '' });
      setAccountAuthorizationUrl('');
      setActionNotice('accounts', 'Account authorized and saved.');
      path.setItem(`account:${accountDraft.accountId.trim()}`);
      setTrace({ method: 'POST', route: '/opencode/auth/accounts/login-complete', detail: 'Account authorization completed' });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Account authorization could not be completed'); }
    finally { setPendingAction(null); }
  };

  const setDefaultAccount = async (account: AccountChoice) => {
    if (!sessions.setDefaultAccount) return;
    setPendingAction({ scope: 'accounts', key: `default:${account.id}` }); setAccountActionError(''); setActionNotice('accounts', '');
    try {
      await sessions.setDefaultAccount(account.id);
      await reloadAccounts();
      void refreshCatalog({ force: true });
      setActionNotice('accounts', `${account.label} is now the default account.`);
      setTrace({ method: 'PATCH', route: '/opencode/auth/accounts/default', detail: `${account.id} set as default` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Default account could not be saved'); }
    finally { setPendingAction(null); }
  };

  const removeSelectedAccount = async () => {
    if (!removingAccount || !sessions.removeAccount) return;
    const account = removingAccount; setPendingAction({ scope: 'accounts', key: `remove:${account.id}` }); setAccountActionError(''); setActionNotice('accounts', '');
    try {
      await sessions.removeAccount(account.id);
      await reloadAccounts();
      void refreshCatalog({ force: true });
      setActionNotice('accounts', `${account.label} removed.`);
      if (path.item === `account:${account.id}`) path.setItem(null);
      setTrace({ method: 'DELETE', route: `/opencode/auth/accounts/${encodeURIComponent(account.id)}`, detail: `${account.id} removed` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Account could not be removed'); }
    finally { setRemovingAccount(null); setPendingAction(null); }
  };

  // OpenAI (ChatGPT) accounts: the engine resolves the account per request (session or
  // profile choice, else this default), so switching the default needs no engine restart.
  const nextOpenaiAccountId = () => {
    const ids = new Set(openaiAccounts.map((account) => account.id));
    let n = openaiAccounts.length + 1;
    while (ids.has(`openai-${n}`)) n++;
    return `openai-${n}`;
  };
  const beginOpenaiLogin = async (accountId: string, label: string) => {
    if (!sessions.startOpenAIAccountLogin) return;
    setPendingAction({ scope: 'openai', key: `start:${accountId}` }); setAccountActionError(''); setActionNotice('openai', ''); setOpenaiAuthorizationUrl('');
    setOpenaiDraft({ accountId, label, code: '' });
    try {
      const result = await sessions.startOpenAIAccountLogin({ accountId, ...(label ? { label } : {}) });
      setOpenaiAuthorizationUrl(result.authorizationUrl);
      setActionNotice('openai', 'Authorization started. Sign in to ChatGPT, then paste the address back here.');
      setTrace({ method: 'POST', route: '/opencode/auth/openai/accounts/login-start', detail: `OpenAI authorization started for ${accountId}` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'OpenAI authorization could not be started'); }
    finally { setPendingAction(null); }
  };
  const completeOpenaiLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessions.completeOpenAIAccountLogin) return;
    const accountId = openaiDraft.accountId;
    setPendingAction({ scope: 'openai', key: `complete:${accountId}` }); setAccountActionError(''); setActionNotice('openai', '');
    try {
      await sessions.completeOpenAIAccountLogin({ accountId, code: openaiDraft.code.trim() });
      await readSection('openai', 'action');
      void refreshCatalog({ force: true });
      setOpenaiDraft({ accountId: '', label: '', code: '' }); setOpenaiAuthorizationUrl('');
      setActionNotice('openai', 'OpenAI account signed in and saved.');
      path.setItem(`openai:${accountId}`);
      setTrace({ method: 'POST', route: '/opencode/auth/openai/accounts/login-complete', detail: `${accountId} authorization completed` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'OpenAI authorization could not be completed'); }
    finally { setPendingAction(null); }
  };
  const setDefaultOpenai = async (account: AccountChoice) => {
    if (!sessions.setDefaultOpenAIAccount) return;
    setPendingAction({ scope: 'openai', key: `default:${account.id}` }); setAccountActionError(''); setActionNotice('openai', '');
    try {
      const { engineUpdated } = await sessions.setDefaultOpenAIAccount(account.id);
      await readSection('openai', 'action');
      void refreshCatalog({ force: true });
      setActionNotice('openai', engineUpdated ? `${account.label} is now the default OpenAI account, and the engine is signed in with it.` : `${account.label} is now the default OpenAI account.`);
      setTrace({ method: 'PATCH', route: '/opencode/auth/openai/accounts/default', detail: `${account.id} set as default${engineUpdated ? ' · engine updated' : ''}` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Default OpenAI account could not be saved'); }
    finally { setPendingAction(null); }
  };
  const renameAccount = async (event: FormEvent, provider: 'anthropic' | 'openai', account: AccountChoice) => {
    event.preventDefault();
    const rename = provider === 'openai' ? sessions.renameOpenAIAccount : sessions.renameAccount;
    const label = renameDraft?.label.trim() ?? '';
    if (!rename || !label) return;
    const scope = provider === 'openai' ? 'openai' : 'accounts';
    setPendingAction({ scope, key: `rename:${account.id}` }); setAccountActionError(''); setActionNotice(scope, '');
    try {
      await rename(account.id, label);
      await readSection(provider === 'openai' ? 'openai' : 'accounts', 'action');
      void refreshCatalog({ force: true });
      setRenameDraft(null);
      setActionNotice(scope, `Renamed to ${label}.`);
      setTrace({ method: 'PATCH', route: `/opencode/auth/${provider === 'openai' ? 'openai/' : ''}accounts/${encodeURIComponent(account.id)}`, detail: `${account.id} renamed` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'Account could not be renamed'); }
    finally { setPendingAction(null); }
  };
  const removeSelectedOpenai = async () => {
    if (!removingOpenai || !sessions.removeOpenAIAccount) return;
    const account = removingOpenai; setPendingAction({ scope: 'openai', key: `remove:${account.id}` }); setAccountActionError(''); setActionNotice('openai', '');
    try {
      await sessions.removeOpenAIAccount(account.id);
      await readSection('openai', 'action');
      void refreshCatalog({ force: true });
      setActionNotice('openai', `${account.label} removed.`);
      if (path.item === `openai:${account.id}`) path.setItem(null);
      setTrace({ method: 'DELETE', route: `/opencode/auth/openai/accounts/${encodeURIComponent(account.id)}`, detail: `${account.id} removed` });
    } catch (err) { setAccountActionError(err instanceof Error ? err.message : 'OpenAI account could not be removed'); }
    finally { setRemovingOpenai(null); setPendingAction(null); }
  };

  const runRuntimeCheck = async (service: 'api' | 'engine', interactive = true) => {
    if (interactive) { setPendingAction({ scope: 'runtime', key: service }); setActionNotice('runtime', ''); }
    setRuntimeStatus((current) => ({ ...current, [service]: { state: 'checking' } }));
    try {
      await gateway.health[service]();
      setRuntimeStatus((current) => ({ ...current, [service]: { state: 'healthy' } }));
      if (interactive) setTrace({ method: 'GET', route: service === 'api' ? '/health' : '/global/health', detail: `${service === 'api' ? 'Local API' : 'OpenCode engine'} is healthy` });
    } catch {
      setRuntimeStatus((current) => ({ ...current, [service]: { state: 'failed' } }));
      if (interactive) setTrace({ method: 'GET', route: service === 'api' ? '/health' : '/global/health', detail: `${service === 'api' ? 'Local API' : 'OpenCode engine'} health check failed` });
    } finally { if (interactive) setPendingAction(null); }
  };
  useEffect(() => { void runRuntimeCheck('api', false); void runRuntimeCheck('engine', false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRuntimeInfo = async () => {
    try {
      setRuntimeInfo(await gateway.domains.runtime!.get());
      setRuntimeInfoError('');
    } catch (err) {
      setRuntimeInfoError(err instanceof Error ? err.message : 'Runtime details could not be loaded');
    }
  };
  useEffect(() => { void loadRuntimeInfo(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const loadManualWorkstreams = async () => {
    const bridge = manualWorkstreamsBridge();
    if (!bridge?.getManualWorkstreams) {
      setManualWorkstreams(manualWorkstreamsUnavailable);
      setManualWorkstreamsLoading(false);
      return;
    }
    setManualWorkstreamsLoading(true);
    try {
      setManualWorkstreams(manualWorkstreamsStatus(await bridge.getManualWorkstreams()));
      setManualWorkstreamsError('');
    } catch (err) {
      setManualWorkstreamsError(err instanceof Error ? err.message : 'Manual workstreams preference could not be read.');
    } finally {
      setManualWorkstreamsLoading(false);
    }
  };
  useEffect(() => {
    let current = true;
    const bridge = manualWorkstreamsBridge();
    const load = async () => {
      if (!current) return;
      await loadManualWorkstreams();
    };
    void load();
    const unsubscribe = bridge?.onStatusChange?.(() => { void load(); });
    return () => { current = false; unsubscribe?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const bridge = window.rhythmShell?.agentServer;
    if (!bridge) { setLocalRuntime({ available: false, ownership: 'none', owned: false, status: 'unavailable' }); return; }
    let current = true;
    const update = (status: { status: string; ownership?: 'electron' | 'external' | 'none'; owned: boolean; errorMessage?: string | null }) => {
      const ownership = status.ownership ?? (status.owned ? 'electron' : status.status === 'ready' ? 'external' : 'none');
      if (current) setLocalRuntime({ available: true, ownership, owned: ownership === 'electron', status: status.status, errorMessage: status.errorMessage });
    };
    void bridge.status().then(update).catch(() => update({ owned: false, ownership: 'none', status: 'unavailable' }));
    const unsubscribe = bridge.onStatusChange?.(update);
    return () => { current = false; unsubscribe?.(); };
  }, []);

  const saveManualWorkstreams = async (enabled: boolean) => {
    const bridge = manualWorkstreamsBridge();
    if (!bridge?.setManualWorkstreams) {
      setManualWorkstreamsError('Manual workstreams can be configured only from the signed desktop app.');
      return;
    }
    setManualWorkstreamsSaving(true);
    setManualWorkstreamsError('');
    try {
      setManualWorkstreams(manualWorkstreamsStatus(await bridge.setManualWorkstreams(enabled)));
      setTrace({ method: 'IPC', route: 'rhythm:agent-server:manual-workstreams:set', detail: 'Manual workstreams preference saved for the next owned launch' });
    } catch (err) {
      setManualWorkstreamsError(err instanceof Error ? err.message : 'Manual workstreams preference could not be saved.');
    } finally {
      setManualWorkstreamsSaving(false);
    }
  };

  const reloadEngineConfig = async () => {
    setPendingAction({ scope: 'runtime', key: 'reload' }); setRuntimeActionError(''); setActionNotice('runtime', '');
    try {
      const result = await gateway.domains.skills!.reload();
      setActionNotice('runtime', `Reloaded ${result.refreshed.join(', ')}.`);
      setTrace({ method: 'POST', route: '/system/refresh', detail: `Reloaded ${result.refreshed.join(', ')}` });
    } catch (err) {
      setRuntimeActionError(err instanceof Error ? err.message : 'Engine config and skills could not be reloaded');
    } finally { setPendingAction(null); }
  };

  const restartEngine = async () => {
    setRestartEngineConfirm(false);
    setPendingAction({ scope: 'runtime', key: 'restart-engine' }); setRuntimeActionError(''); setActionNotice('runtime', '');
    try {
      const result = await gateway.domains.runtime!.restartEngine();
      setActionNotice('runtime', `OpenCode engine restarted with boot ID ${result.bootId}.`);
      setTrace({ method: 'POST', route: '/system/restart-engine', detail: `Engine restarted: ${result.bootId}` });
      await loadRuntimeInfo();
    } catch (err) {
      if (err instanceof RuntimeGatewayError && err.status === 409 && err.blockers.length) {
        setRuntimeActionError(`Restart blocked by ${err.blockers.map((blocker) => blocker.name ?? blocker.permissionId ?? blocker.message ?? blocker.id ?? blocker.type).join(', ')}.`);
      } else {
        setRuntimeActionError(err instanceof Error ? err.message : 'Engine restart failed');
      }
    } finally { setPendingAction(null); }
  };

  const restartLocalRuntime = async () => {
    const bridge = window.rhythmShell?.agentServer;
    if (!bridge || localRuntime.ownership === 'external') return;
    setPendingAction({ scope: 'runtime', key: 'restart-local' }); setRuntimeActionError(''); setActionNotice('runtime', '');
    try {
      const result = await bridge.restart();
      if (!result.ok) {
        const mapped = result.status?.errorMessage
          ?? (result.code === 'runtime_unowned' ? 'This runtime is owned by another app.'
            : result.code === 'shutting_down' ? 'Rhythm is shutting down; reopen it before retrying the local runtime.'
              : result.code === 'ports_not_released' ? 'The previous local runtime is still stopping. Wait a moment, then Retry local runtime.'
                : 'The local runtime could not restart. Review the error, then Retry local runtime.');
        throw new Error(mapped);
      }
      setActionNotice('runtime', 'Local runtime restarted.');
      setTrace({ method: 'IPC', route: 'rhythm:agent-server:restart', detail: 'Owned local runtime restarted' });
      await loadRuntimeInfo();
      await Promise.all([runRuntimeCheck('api', false), runRuntimeCheck('engine', false)]);
    } catch (err) {
      setRuntimeActionError(err instanceof Error ? err.message : 'Local runtime restart failed');
    } finally { setPendingAction(null); }
  };

  const reloadMcp = async () => {
    await readSection('mcp', 'action');
  };

  const runMcpAction = async (server: McpServer, action: 'connect' | 'disconnect') => {
    setPendingAction({ scope: 'mcp', key: `${action}:${server.name}` }); setMcpActionError(''); setActionNotice('mcp', '');
    try {
      if (action === 'connect') {
        const result = await mcp.connect(server.name);
        if (result.authorizationUrl) setMcpAuthorization({ name: server.name, url: result.authorizationUrl });
        setActionNotice('mcp', result.authorizationUrl ? `${server.name} requires browser authorization.` : `${server.name} connected.`);
      } else {
        await mcp.disconnect(server.name);
        setActionNotice('mcp', `${server.name} disconnected.`);
      }
      await reloadMcp();
      setTrace({ method: 'POST', route: `/opencode/mcp/${encodeURIComponent(server.name)}/${action}`, detail: `${server.name} ${action} request completed` });
    } catch (err) { setMcpActionError(err instanceof Error ? err.message : `MCP ${action} failed`); }
    finally { setPendingAction(null); }
  };

  const removeMcp = async () => {
    if (!removing) return;
    const server = removing; setPendingAction({ scope: 'mcp', key: `remove:${server.name}` }); setMcpActionError(''); setActionNotice('mcp', '');
    try {
      await mcp.remove(server.name);
      await reloadMcp();
      setActionNotice('mcp', `${server.name} removed.`);
      if (path.item === `mcp:${server.name}`) path.setItem(null);
      setTrace({ method: 'DELETE', route: `/opencode/mcp/${encodeURIComponent(server.name)}`, detail: `${server.name} removed` });
    } catch (err) { setMcpActionError(err instanceof Error ? err.message : 'MCP server removal failed'); }
    finally { setRemoving(null); setPendingAction(null); }
  };

  const addMcp = async (event: FormEvent) => {
    event.preventDefault();
    setPendingAction({ scope: 'mcp', key: 'add' }); setMcpActionError(''); setActionNotice('mcp', '');
    try {
      await mcp.add({ name: mcpDraft.name.trim(), ...(mcpDraft.kind === 'remote' ? { url: mcpDraft.value.trim() } : { command: mcpDraft.value.trim() }) });
      await reloadMcp();
      setActionNotice('mcp', `${mcpDraft.name.trim()} added and saved.`);
      path.setItem(`mcp:${mcpDraft.name.trim()}`);
      setTrace({ method: 'POST', route: '/opencode/mcp', detail: `${mcpDraft.name.trim()} added` });
      setMcpDraft({ name: '', kind: 'remote', value: '' });
    } catch (err) { setMcpActionError(err instanceof Error ? err.message : 'MCP server could not be added'); }
    finally { setPendingAction(null); }
  };

  const saveMcpCredentials = async (event: FormEvent, server: McpServer) => {
    event.preventDefault();
    setPendingAction({ scope: 'mcp', key: `credentials:${server.name}` }); setMcpActionError(''); setActionNotice('mcp', '');
    try {
      await mcp.setCredentials(server.name, mcpCredentials[server.name] ?? {});
      await reloadMcp();
      setMcpCredentials((current) => ({ ...current, [server.name]: {} }));
      setActionNotice('mcp', `${server.name} credentials saved.`);
      setTrace({ method: 'POST', route: `/opencode/mcp/${encodeURIComponent(server.name)}/credentials`, detail: `${server.name} credentials saved` });
    } catch (err) { setMcpActionError(err instanceof Error ? err.message : 'MCP credentials could not be saved'); }
    finally { setPendingAction(null); }
  };

  const startMcpOAuth = async (server: McpServer) => {
    setPendingAction({ scope: 'mcp', key: `oauth:${server.name}` }); setMcpActionError(''); setActionNotice('mcp', '');
    try {
      const result = await mcp.startOAuth(server.name);
      setMcpAuthorization({ name: server.name, url: result.authorizationUrl });
      setActionNotice('mcp', `Authorization started for ${server.name}.`);
      setTrace({ method: 'POST', route: `/opencode/mcp/${encodeURIComponent(server.name)}/oauth/start`, detail: `${server.name} OAuth started` });
    } catch (err) { setMcpActionError(err instanceof Error ? err.message : 'MCP authorization could not be started'); }
    finally { setPendingAction(null); }
  };

  const checkMcpOAuth = async () => {
    if (!mcpAuthorization) return;
    setPendingAction({ scope: 'mcp', key: `oauth-status:${mcpAuthorization.name}` }); setMcpActionError('');
    try {
      const result = await mcp.oauthStatus(mcpAuthorization.name);
      await reloadMcp();
      setActionNotice('mcp', `${mcpAuthorization.name} authorization status: ${result.status}.`);
      setTrace({ method: 'GET', route: `/opencode/mcp/${encodeURIComponent(mcpAuthorization.name)}/oauth/status`, detail: `${mcpAuthorization.name} OAuth status is ${result.status}` });
      if (/connected|authorized|complete/i.test(result.status)) setMcpAuthorization(null);
    } catch (err) { setMcpActionError(err instanceof Error ? err.message : 'MCP authorization status could not be loaded'); }
    finally { setPendingAction(null); }
  };

  const allAccounts = [...accounts, ...openaiAccounts];
  const connectedAccounts = allAccounts.filter((account) => !accountNeedsRelogin(account)).length;
  const staleAccounts = allAccounts.length - connectedAccounts;
  const connectedMcp = mcpServers.filter((server) => server.status === 'connected').length;
  const mcpAttentionRank = (server: McpServer) => server.status === 'failed' ? 0 : server.status === 'needs_auth' ? 1 : server.status === 'connected' ? 3 : 2;
  const visibleMcpServers = [...mcpServers]
    .sort((left, right) => mcpAttentionRank(left) - mcpAttentionRank(right) || left.name.localeCompare(right.name))
    .filter((server) => server.name.toLocaleLowerCase().includes((mcpServers.length > 10 ? mcpSearch : '').trim().toLocaleLowerCase()));
  const autoPromotionSummary = autoPromotionError
    ? 'Unavailable'
    : autoPromotionState
      ? `${autoPromotionState.state.autoPromotionEnabled ? 'Enabled' : 'Disabled'} · ${autoPromotionState.state.autoPromotionEligible ? 'Eligible' : 'Not eligible'}`
      : 'Checking status…';
  const items = baseItems({
    autoPromotion: autoPromotionSummary,
    accounts: accountsError || `${connectedAccounts} connected · ${allAccounts.length} available${staleAccounts ? ` · ${staleAccounts} need re-authorization` : ''}`,
    models: 'Provider-first curation',
    modelRouting: modelRouting.subtitle,
    behavior: `${requireDestructiveModal ? 'Full dialog' : 'Inline approval'} · This device`,
    keybindings: `${sendMessageKeyLabel(keybindings.sendKey)} to send · This device`,
    runtime: gateway.environment ? `API :${gateway.environment.apiPort} · engine :${gateway.environment.enginePort}` : 'Local runtime unavailable',
    mcp: mcpError || `${connectedMcp} connected · ${mcpServers.length} configured`,
  }, { autoPromotion: autoPromotionError ? 'Error' : undefined });

  const providerBadge = (id: string) => {
    const connected = authProviders?.includes(id) ?? false;
    const confirmed = providersCurrent && authProviders !== null;
    return { connected, confirmed, badge: authProviders === null ? 'Status unknown' : `${confirmed ? '' : 'Last known '}${connected ? 'Connected' : 'Not connected'}` };
  };
  const accountAuthorizationForm = accountAuthorizationUrl && <form className="agent-settings-form" onSubmit={completeAccountLogin}><h3 data-testid="agent-settings-account-authorizing">Authorizing {accountDraft.label || accountDraft.accountId}</h3><ExternalLink href={accountAuthorizationUrl} linkTestId="agent-settings-account-authorization-link" copyTestId="agent-settings-account-authorization-copy">Open Anthropic authorization</ExternalLink><label>Authorization code<input required value={accountDraft.code} onChange={(event) => setAccountDraft((current) => ({ ...current, code: event.target.value }))} data-testid="agent-settings-account-code" /></label><button className="primary-button" type="submit" disabled={actionPending('accounts')} data-testid="agent-settings-account-complete">Save account</button></form>;
  const openaiAuthorizationForm = openaiAuthorizationUrl && <form className="agent-settings-form" onSubmit={completeOpenaiLogin}>
    <h3 data-testid="agent-settings-openai-authorizing">Signing in {openaiDraft.label || openaiDraft.accountId}</h3>
    <ExternalLink href={openaiAuthorizationUrl} linkTestId="agent-settings-openai-authorization-link" copyTestId="agent-settings-openai-authorization-copy">Open ChatGPT sign-in</ExternalLink>
    <label>Address after sign-in<input required value={openaiDraft.code} onChange={(event) => setOpenaiDraft((current) => ({ ...current, code: event.target.value }))} aria-describedby="agent-settings-openai-paste-help" data-testid="agent-settings-openai-code" /></label>
    <small id="agent-settings-openai-paste-help">After signing in, the browser will fail to load a localhost:1455 page — copy the whole address from the address bar and paste it here.</small>
    <button className="primary-button" type="submit" disabled={actionPending('openai')} data-testid="agent-settings-openai-complete">Save account</button>
  </form>;
  const renameForm = (provider: 'anthropic' | 'openai', account: AccountChoice) => {
    const key = `${provider}:${account.id}`;
    const prefix = provider === 'openai' ? 'agent-settings-openai' : 'agent-settings-account';
    return <form className="agent-settings-form agent-settings-rename" onSubmit={(event) => void renameAccount(event, provider, account)}>
      <label>Label<input required value={renameDraft?.key === key ? renameDraft.label : account.label} onChange={(event) => setRenameDraft({ key, label: event.target.value })} data-testid={`${prefix}-rename-${account.id}`} /></label>
      <button className="secondary-button" type="submit" disabled={actionPending(provider === 'openai' ? 'openai' : 'accounts') || renameDraft?.key !== key || !renameDraft.label.trim() || renameDraft.label.trim() === account.label} data-testid={`${prefix}-rename-save-${account.id}`}>Rename</button>
    </form>;
  };
  const openaiStatus = (account: AccountChoice) => accountNeedsRelogin(account) ? 'Needs re-login' : account.isDefault ? 'Default' : 'OK';
  // Column 2 lists Anthropic and OpenAI accounts, the remaining model providers and Hermes sharing; column 3 inspects one.
  const accountsView = (): SettingsView => ({
    kind: 'list',
    label: 'Accounts',
    adds: [
      { id: 'add', label: 'Add Anthropic account', testId: 'agent-settings-account-add' },
      { id: 'add:openai', label: 'Add OpenAI account', testId: 'agent-settings-openai-add' },
    ],
    items: [
      ...accounts.map((account) => ({ id: `account:${account.id}`, group: 'Anthropic', title: account.label, subtitle: `${account.email ? `${account.email} · ` : ''}${account.status}${account.isDefault ? ' · Default' : ''}`, badge: accountNeedsRelogin(account) ? 'Re-authorize' : undefined, testId: `agent-settings-account-row-${account.id}` })),
      ...openaiAccounts.map((account) => ({ id: `openai:${account.id}`, group: 'OpenAI', title: account.label, subtitle: `${account.email ? `${account.email} · ` : ''}${openaiStatus(account)}`, badge: accountNeedsRelogin(account) ? 'Re-login' : undefined, testId: `agent-settings-openai-row-${account.id}` })),
      ...providerCatalog.filter((provider) => !Object.hasOwn(ACCOUNT_MANAGED_PROVIDERS, provider.id)).map((provider) => ({ id: `provider:${provider.id}`, group: 'Model providers', title: provider.label, subtitle: providerBadge(provider.id).badge, testId: `agent-settings-provider-row-${provider.id}` })),
      { id: 'hermes', group: 'Hermes', title: 'Hermes sharing', subtitle: 'Let Hermes use Rhythm API keys', testId: 'agent-settings-hermes-row' },
    ],
    detail: (itemId) => {
      const chrome = <>
        <SectionIntro scope="Desktop local">Anthropic and OpenAI accounts and every other model provider are authorized against the local OpenCode runtime.</SectionIntro>
        {retryControl('accounts', accountsError, 'Retry accounts')}
        {retryControl('openai', openaiError, 'Retry OpenAI accounts')}
        {retryControl('providers', providerError, 'Retry providers')}
        {accountActionError && <p role="alert">{accountActionError}</p>}
        {(actionPending('accounts') || actionPending('openai') || actionPending('providers')) && <p role="status">Saving account configuration…</p>}
        {(actionNotices.accounts || actionNotices.openai || actionNotices.providers) && <p role="status" data-testid="agent-settings-accounts-notice">{actionNotices.accounts || actionNotices.openai || actionNotices.providers}</p>}
      </>;
      const account = accounts.find((entry) => `account:${entry.id}` === itemId);
      if (account) return {
        title: account.label,
        content: <>{chrome}<div className="agent-settings-records"><article className={`agent-settings-account${accountNeedsRelogin(account) ? ' needs-relogin' : ''}`} data-testid={`agent-settings-account-${account.id}`} data-account-status={account.status}><span><strong>{account.label}</strong><small>{account.email ? `${account.email} · ` : ''}{account.status}{account.isDefault ? ' · Default' : ''}</small>{accountNeedsRelogin(account) && <span className="kind-badge" data-testid={`agent-settings-account-attention-${account.id}`}>Needs re-authorization</span>}</span><div className="agent-settings-actions">{accountNeedsRelogin(account) && <button className="primary-button" type="button" disabled={actionPending('accounts')} onClick={() => void beginAccountLogin(account.id, account.label)} data-testid={`agent-settings-account-relogin-${account.id}`}>Re-authorize</button>}{!account.isDefault && <button className="secondary-button" type="button" disabled={actionPending('accounts')} onClick={() => void setDefaultAccount(account)} data-testid={`agent-settings-account-default-${account.id}`}>Make default</button>}<button className="text-danger-button" type="button" disabled={actionPending('accounts')} onClick={() => setRemovingAccount(account)} data-testid={`agent-settings-account-remove-${account.id}`}>Remove</button></div></article></div>{accountDraft.accountId === account.id && accountAuthorizationForm}{sessions.renameAccount && renameForm('anthropic', account)}</>,
      };
      const openai = openaiAccounts.find((entry) => `openai:${entry.id}` === itemId);
      if (openai) return {
        title: openai.label,
        content: <>{chrome}
          <div className="agent-settings-records"><article className={`agent-settings-account${accountNeedsRelogin(openai) ? ' needs-relogin' : ''}`} data-testid={`agent-settings-openai-account-${openai.id}`} data-account-status={openai.status}>
            <span><strong>{openai.label}</strong><small>{openai.email ? `${openai.email} · ` : ''}{openaiStatus(openai)}</small>{accountNeedsRelogin(openai) && <span className="kind-badge" data-testid={`agent-settings-openai-attention-${openai.id}`}>Needs re-login</span>}</span>
            <div className="agent-settings-actions">
              {accountNeedsRelogin(openai) && <button className="primary-button" type="button" disabled={actionPending('openai')} onClick={() => void beginOpenaiLogin(openai.id, openai.label)} data-testid={`agent-settings-openai-relogin-${openai.id}`}>Sign in again</button>}
              {!openai.isDefault && <button className="secondary-button" type="button" disabled={actionPending('openai')} onClick={() => void setDefaultOpenai(openai)} data-testid={`agent-settings-openai-default-${openai.id}`}>Use this account</button>}
              <button className="text-danger-button" type="button" disabled={actionPending('openai')} onClick={() => setRemovingOpenai(openai)} data-testid={`agent-settings-openai-remove-${openai.id}`}>Remove</button>
            </div>
          </article></div>
          <p className="agent-settings-subhead-note">Sessions and profiles that don't choose their own OpenAI account use the default account. Changing the default applies to new requests without restarting the engine.</p>
          {openaiDraft.accountId === openai.id && openaiAuthorizationForm}
          {sessions.renameOpenAIAccount && renameForm('openai', openai)}</>,
      };
      const provider = providerCatalog.find((entry) => `provider:${entry.id}` === itemId);
      if (provider) {
        const status = providerBadge(provider.id);
        return {
          title: provider.label,
          content: <>{chrome}<p className="agent-settings-subhead-note">OAuth and API-key providers are stored by the local OpenCode runtime, the same as in the Flutter settings screen.</p>
            <div className="agent-settings-records"><ProviderConnectCard provider={provider} connected={status.connected} badge={status.badge} statusKnown={authProviders !== null} confirmed={status.confirmed} pending={actionPending('providers')}
              apiKeyValue={providerDraft.apiKey[provider.id] ?? ''}
              onApiKeyChange={(value) => setProviderDraft((current) => ({ ...current, apiKey: { ...current.apiKey, [provider.id]: value } }))}
              onAuthorize={() => void startProviderAuth(provider)}
              onSaveKey={(event) => void saveProviderApiKey(event, provider)} /></div>
            {providerFlow?.id === provider.id && <ProviderAuthFlowForm flow={providerFlow} code={providerDraft.code} pending={actionPending('providers')}
              onCodeChange={(value) => setProviderDraft((current) => ({ ...current, code: value }))}
              onSubmit={completeProviderAuth} onCheck={() => void checkProviderAuth()} />}</>,
        };
      }
      if (itemId === 'hermes') return { title: 'Hermes sharing', content: <>{chrome}<HermesAccountsSettings /></> };
      if (itemId === 'add:openai') {
        const adding = openaiAuthorizationUrl && !openaiAccounts.some((entry) => entry.id === openaiDraft.accountId);
        return {
          title: 'Add OpenAI account',
          content: <>{chrome}
            <form className="agent-settings-form" onSubmit={(event) => { event.preventDefault(); void beginOpenaiLogin(openaiDraft.accountId && !openaiAccounts.some((entry) => entry.id === openaiDraft.accountId) ? openaiDraft.accountId : nextOpenaiAccountId(), openaiDraft.label.trim()); }}>
              <h3>Sign in with ChatGPT</h3>
              <p className="agent-settings-subhead-note">Adding another account does not change the default. Profiles and sessions can pick any signed-in account.</p>
              <label>Label (optional)<input value={openaiDraft.label} onChange={(event) => setOpenaiDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Work, Personal…" data-testid="agent-settings-openai-label" /></label>
              <button className="primary-button" type="submit" disabled={actionPending('openai') || !sessions.startOpenAIAccountLogin} data-testid="agent-settings-openai-start">Start sign-in</button>
            </form>
            {adding && openaiAuthorizationForm}</>,
        };
      }
      return {
        title: 'Add Anthropic account',
        content: <>{chrome}
          {!accountsError && accounts.length === 0 && <div className="agent-settings-empty"><strong>No provider accounts reported</strong><p>Authorize an account below.</p></div>}
          <form className="agent-settings-form" onSubmit={startAccountLogin}>
            <h3>Authorize Anthropic account</h3>
            <label>Account ID<input required pattern="[a-z0-9-]{1,32}" value={accountDraft.accountId} onChange={(event) => setAccountDraft((current) => ({ ...current, accountId: event.target.value }))} data-testid="agent-settings-account-id" /></label>
            <label>Label<input value={accountDraft.label} onChange={(event) => setAccountDraft((current) => ({ ...current, label: event.target.value }))} data-testid="agent-settings-account-label" /></label>
            <button className="primary-button" type="submit" disabled={actionPending('accounts')} data-testid="agent-settings-account-start">Start authorization</button>
          </form>
          {accountAuthorizationForm}</>,
      };
    },
  });

  const modelsInspector = () => <>
    <SectionIntro scope="Desktop local">Connect providers, then choose which of their models appear in every session and profile model picker.</SectionIntro>
    <ModelCurationPanel
      authProviders={authProviders} providersCurrent={providersCurrent} providerFlow={providerFlow} providerDraft={providerDraft}
      onApiKeyChange={(providerId, value) => setProviderDraft((current) => ({ ...current, apiKey: { ...current.apiKey, [providerId]: value } }))}
      onCodeChange={(value) => setProviderDraft((current) => ({ ...current, code: value }))}
      startProviderAuth={startProviderAuth} completeProviderAuth={completeProviderAuth} checkProviderAuth={checkProviderAuth} saveProviderApiKey={saveProviderApiKey}
      providerPending={actionPending('providers')} providerActionError={accountActionError} providerNotice={actionNotices.providers ?? ''}
      onReloadLocalConfig={() => void reloadEngineConfig()} localConfigPending={actionPending('runtime', 'reload')}
      onOpenAccounts={() => path.selectSection(sectionIds.accounts)}
    />

  </>;
  const runtimeValue = (service: 'api' | 'engine', label: string) => {
    const status = runtimeStatus[service];
    const statusLabel = status.state === 'healthy' ? 'Healthy' : status.state === 'failed' ? 'Failed' : 'Checking';
    const port = service === 'api' ? runtimeInfo?.api?.port ?? gateway.environment?.apiPort : runtimeInfo?.engine?.port ?? gateway.environment?.enginePort;
    return <dd className={`agent-settings-runtime-value status-${status.state}`}>
      <span>{port ? `127.0.0.1:${port}` : 'Unavailable'}</span>
      <span className="agent-settings-runtime-state" data-testid={`runtime-status-${service}`}>
        <strong className="agent-settings-status-indicator"><i aria-hidden="true" />{statusLabel}</strong>
        {status.state === 'failed' && <span className="agent-settings-runtime-error" role="alert">{label} is unavailable. Re-check the service or review the desktop runtime.</span>}
      </span>
    </dd>;
  };
  const runtimeInspector = () => <><SectionIntro scope="Desktop local">Rhythm uses a local API and OpenCode engine supplied by the trusted desktop host. Reload configuration first; restart only when reload cannot recover stale state.</SectionIntro><ManualWorkstreamsSettings value={manualWorkstreams} loading={manualWorkstreamsLoading} saving={manualWorkstreamsSaving} available={Boolean(manualWorkstreamsBridge()?.getManualWorkstreams && manualWorkstreamsBridge()?.setManualWorkstreams)} error={manualWorkstreamsError} onChange={(enabled) => void saveManualWorkstreams(enabled)} /><dl className="agent-settings-property-list"><div><dt>Local API</dt>{runtimeValue('api', 'Local API')}</div><div><dt>OpenCode engine</dt>{runtimeValue('engine', 'OpenCode engine')}</div><div><dt>Engine PID</dt><dd>{runtimeInfo?.engine?.pid ?? 'Unavailable'}</dd></div><div><dt>Boot ID</dt><dd>{runtimeInfo?.engine?.bootId ?? 'Unavailable'}</dd></div><div><dt>Version</dt><dd>{runtimeInfo?.engine?.version ?? 'Unavailable'}</dd></div><div><dt>Event bridge</dt><dd>{runtimeInfo?.engine ? runtimeInfo.engine.bridgeLive ? 'Live' : 'Unavailable' : 'Checking'}</dd></div><div><dt>Remote override</dt><dd>{runtimeInfo?.remoteOverride ?? 'Not set on this device'}</dd></div></dl>{runtimeInfoError && <p role="alert">{runtimeInfoError}</p>}<div className="agent-settings-actions"><button className="secondary-button" type="button" disabled={actionPending('runtime')} aria-busy={actionPending('runtime', 'api')} onClick={() => void runRuntimeCheck('api')} data-testid="agent-settings-check-api">{actionPending('runtime', 'api') ? 'Checking local API…' : 'Check local API'}</button><button className="secondary-button" type="button" disabled={actionPending('runtime')} aria-busy={actionPending('runtime', 'engine')} onClick={() => void runRuntimeCheck('engine')} data-testid="agent-settings-check-engine">{actionPending('runtime', 'engine') ? 'Checking OpenCode engine…' : 'Check OpenCode engine'}</button></div><div className="agent-settings-runtime-controls" data-testid="runtime-control-actions"><button className="primary-button" type="button" disabled={actionPending('runtime')} aria-busy={actionPending('runtime', 'reload')} onClick={() => void reloadEngineConfig()}>{actionPending('runtime', 'reload') ? 'Reloading…' : 'Reload engine config & skills'}</button><button className="secondary-button" type="button" disabled={actionPending('runtime')} onClick={() => setRestartEngineConfirm(true)}>Restart engine</button><button className="danger-button" type="button" disabled={actionPending('runtime') || !localRuntime.available || localRuntime.ownership === 'external'} onClick={() => void restartLocalRuntime()}>{localRuntime.status === 'failed' ? 'Retry local runtime' : 'Restart local runtime'}</button></div>{localRuntime.ownership === 'external' && <p className="agent-settings-runtime-owner-note">Restart unavailable: this runtime is owned by another app.</p>}{!localRuntime.available && <p className="agent-settings-runtime-owner-note">Restart unavailable outside the signed desktop app.</p>}{actionPending('runtime') && <p role="status">Updating the local runtime…</p>}{actionNotices.runtime && <p role="status">{actionNotices.runtime}</p>}{runtimeActionError && <p role="alert">{runtimeActionError}</p>}</>;
  // Column 2 lists servers (attention first); column 3 inspects one server or the add form.
  const mcpView = (): SettingsView => ({
    kind: 'list',
    label: 'MCP servers',
    adds: [{ id: 'add', label: 'Add server', testId: 'agent-settings-mcp-add-item' }],
    header: mcpServers.length > 10 ? <label className="column-browser-search agent-settings-mcp-search"><span className="sr-only">Search MCP servers</span><input type="search" value={mcpSearch} onChange={(event) => setMcpSearch(event.target.value)} placeholder="Search MCP servers" /></label> : undefined,
    emptyState: mcpServers.length > 0 ? 'No matching MCP servers' : mcpError ? 'MCP servers unavailable' : 'No MCP servers configured',
    items: visibleMcpServers.map((server) => ({ id: `mcp:${server.name}`, title: server.name, subtitle: mcpStatusPresentation(server.status).label, testId: `agent-settings-mcp-row-${server.name}` })),
    detail: (itemId) => {
      const chrome = <>
        <SectionIntro scope="Workspace">MCP servers provide tools to profiles. Changes are saved through the workspace MCP service.</SectionIntro>
        {retryControl('mcp', mcpError, 'Retry MCP servers')}
        {mcpActionError && <p role="alert">{mcpActionError}</p>}
        {actionPending('mcp') && <p role="status">{pendingAction ? `${pendingAction.key.split(':')[0]} ${pendingAction.key.split(':').slice(1).join(':')}`.trim() : 'Saving MCP configuration'}…</p>}
        {actionNotices.mcp && <p role="status">{actionNotices.mcp}</p>}
        {mcpAuthorization && <div className="agent-settings-gap" role="status"><strong>{mcpAuthorization.name} authorization</strong><p><ExternalLink href={mcpAuthorization.url} linkTestId="agent-settings-mcp-authorization-link" copyTestId="agent-settings-mcp-authorization-copy">Open provider authorization</ExternalLink></p><button className="secondary-button" type="button" disabled={actionPending('mcp', `oauth-status:${mcpAuthorization.name}`)} aria-busy={actionPending('mcp', `oauth-status:${mcpAuthorization.name}`)} onClick={() => void checkMcpOAuth()} data-testid="agent-settings-mcp-oauth-status">{actionPending('mcp', `oauth-status:${mcpAuthorization.name}`) ? 'Checking authorization…' : 'Check authorization status'}</button></div>}
      </>;
      const server = mcpServers.find((entry) => `mcp:${entry.name}` === itemId);
      if (!server) return {
        title: 'Add MCP server',
        content: <>{chrome}
          {!mcpError && mcpServers.length === 0 && <div className="agent-settings-empty"><strong>No MCP servers configured</strong><p>Add a local command or remote URL below.</p></div>}
          <form className="agent-settings-form" onSubmit={addMcp}>
            <h3>Add MCP server</h3>
            <label>Name<input required value={mcpDraft.name} onChange={(event) => setMcpDraft((current) => ({ ...current, name: event.target.value }))} data-testid="agent-settings-mcp-add-name" /></label>
            <label>Connection type<select value={mcpDraft.kind} onChange={(event) => setMcpDraft((current) => ({ ...current, kind: event.target.value as 'remote' | 'local' }))} data-testid="agent-settings-mcp-add-kind"><option value="remote">Remote URL</option><option value="local">Local command</option></select></label>
            <label>{mcpDraft.kind === 'remote' ? 'URL' : 'Command'}<input required type={mcpDraft.kind === 'remote' ? 'url' : 'text'} value={mcpDraft.value} onChange={(event) => setMcpDraft((current) => ({ ...current, value: event.target.value }))} data-testid="agent-settings-mcp-add-value" /></label>
            <button className="primary-button" type="submit" disabled={actionPending('mcp', 'add')} aria-busy={actionPending('mcp', 'add')} data-testid="agent-settings-mcp-add">{actionPending('mcp', 'add') ? 'Adding server…' : 'Add server'}</button>
          </form></>,
      };
      const rowPending = pendingAction?.scope === 'mcp' && pendingAction.key.endsWith(`:${server.name}`);
      const disconnecting = actionPending('mcp', `disconnect:${server.name}`);
      const connecting = actionPending('mcp', `connect:${server.name}`);
      const authorizing = actionPending('mcp', `oauth:${server.name}`);
      const savingCredentials = actionPending('mcp', `credentials:${server.name}`);
      const presentation = mcpStatusPresentation(server.status);
      const isFailed = server.status === 'failed' || server.status === 'needs_client_registration';
      const isOAuth = server.needsCredentials && server.requiredEnv.length === 0;
      const usage = server.usedByProfiles;
      const facts = [
        server.source,
        mcpTransportSummary(server),
        `${server.tools.length} tools`,
      ].filter(Boolean).join(' · ');
      const sortedTools = [...server.tools].sort((a, b) => a.localeCompare(b));
      const toolQuery = mcpToolFilter.trim().toLocaleLowerCase();
      const visibleTools = server.tools.length > 20 && toolQuery
        ? sortedTools.filter((tool) => tool.toLocaleLowerCase().includes(toolQuery))
        : sortedTools;
      return {
        title: server.name,
        content: <>{chrome}<div className="agent-settings-mcp-list"><article className={presentation.className} data-testid={`agent-settings-mcp-${server.name}`}>
          <header>
            <div>
              <strong>{server.name}</strong>
              <small>{facts}{usage && usage.count > 0 && <> · <span title={usage.names.join(', ')}>Used by {usage.count} profile{usage.count === 1 ? '' : 's'}</span></>}</small>
            </div>
            <span className="kind-badge" data-testid={`agent-settings-mcp-status-${server.name}`}>{presentation.label}</span>
          </header>
          {server.error && <p className="agent-settings-mcp-error" role="alert"><span aria-hidden="true">!</span> {server.error}</p>}
          {server.needsCredentials && server.requiredEnv.length > 0 && <form className="agent-settings-form" onSubmit={(event) => void saveMcpCredentials(event, server)}><p>Credentials required</p>{server.requiredEnv.map((key) => <label key={key}>{key}<input required type="password" autoComplete="off" value={mcpCredentials[server.name]?.[key] ?? ''} onChange={(event) => setMcpCredentials((current) => ({ ...current, [server.name]: { ...current[server.name], [key]: event.target.value } }))} data-testid={`agent-settings-mcp-credential-${server.name}-${key}`} /></label>)}<button className="primary-button" type="submit" disabled={savingCredentials} aria-busy={savingCredentials} data-testid={`agent-settings-mcp-credentials-save-${server.name}`}>{savingCredentials ? 'Saving credentials…' : 'Save credentials'}</button></form>}
          <div className="agent-settings-actions">
            {server.status === 'connected'
              ? <button className="secondary-button" type="button" disabled={rowPending} aria-busy={disconnecting} onClick={() => void runMcpAction(server, 'disconnect')} data-testid={`agent-settings-mcp-disconnect-${server.name}`}>{disconnecting ? 'Disconnecting…' : 'Disconnect'}</button>
              : isOAuth
                ? <button className="primary-button" type="button" disabled={rowPending} aria-busy={authorizing} onClick={() => void startMcpOAuth(server)} data-testid={`agent-settings-mcp-oauth-${server.name}`}>{authorizing ? 'Authenticating…' : 'Authenticate'}</button>
                : <button className="primary-button" type="button" disabled={rowPending || server.needsCredentials} aria-busy={connecting} onClick={() => void runMcpAction(server, 'connect')} data-testid={`agent-settings-mcp-connect-${server.name}`}>{connecting ? (isFailed ? 'Reconnecting…' : 'Connecting…') : (isFailed ? 'Reconnect' : 'Connect')}</button>}
            <button className="text-danger-button" type="button" disabled={rowPending} onClick={() => setRemoving(server)} data-testid={`agent-settings-mcp-remove-${server.name}`}>Remove</button>
          </div>
        </article></div>
          {server.tools.length > 0 && <>
            <h3 className="agent-settings-subhead">Tools</h3>
            {server.tools.length > 20 && <label className="column-checklist-filter agent-settings-mcp-tool-filter"><span className="sr-only">Search tools</span><Icon name="search" size={13} /><input type="search" value={mcpToolFilter} onChange={(event) => setMcpToolFilter(event.target.value)} placeholder="Search tools" data-testid={`agent-settings-mcp-tools-filter-${server.name}`} /></label>}
            <ul className="agent-settings-mcp-tools" data-testid={`agent-settings-mcp-tools-${server.name}`}>
              {visibleTools.map((tool) => <li key={tool}>
                <button type="button" className="agent-settings-mcp-tool-row" aria-expanded={expandedMcpTool === tool} onClick={() => setExpandedMcpTool((current) => current === tool ? null : tool)} data-testid={`agent-settings-mcp-tool-${server.name}-${tool}`}><code>{tool}</code></button>
                {expandedMcpTool === tool && <div className="agent-settings-mcp-tool-detail" role="note" data-testid={`agent-settings-mcp-tool-detail-${server.name}-${tool}`}>Description and parameters for this tool aren't exposed by the local engine yet.</div>}
              </li>)}
              {!visibleTools.length && <li className="agent-settings-mcp-tools-empty" role="status">No matching tools</li>}
            </ul>
          </>}</>,
      };
    },
  });

  const view = (id: string): SettingsView | null => {
    switch (id) {
      case sectionIds.autoPromotion: return { kind: 'form', content: <><SectionIntro scope="Workspace">The server enforces administrator access, eligibility, regression checks, and explicit confirmation.</SectionIntro><AutoPromotionSettings state={autoPromotionState} loading={autoPromotionLoading} error={autoPromotionError} reload={loadAutoPromotion} reportError={setAutoPromotionError} /></> };
      case sectionIds.accounts: return accountsView();
      case sectionIds.models: return { kind: 'form', content: modelsInspector() };
      case sectionIds.modelRouting: return { kind: 'columns', columns: modelRouting.columns() };
      case sectionIds.behavior: return { kind: 'form', content: <><SectionIntro scope="Desktop local">This policy controls whether Bash, write, edit, and patch tool calls use a full destructive-action confirmation dialog.</SectionIntro><BehaviorSettings enabled={requireDestructiveModal} onChange={setRequireDestructiveModal} /></> };
      case sectionIds.keybindings: return { kind: 'form', content: <><SectionIntro scope="Desktop local">Shortcuts cover send message, new session, cancel turn, and switch session.</SectionIntro><KeybindingsSettings preferences={keybindings} update={updateKeybindings} reset={resetKeybindings} /></> };
      case sectionIds.runtime: return { kind: 'form', content: runtimeInspector() };
      case sectionIds.mcp: return mcpView();
      default: return null;
    }
  };

  return <Frame slug="agent-settings" title="Agent settings" description="Agent, desktop-local, and workspace configuration in one place." trace={trace}>
    <SettingsBrowser path={path} categories={items} loading={loading} emptyState={<p>No configuration sections are available.</p>} view={view}
      toolbar={<button className="secondary-button compact" type="button" onClick={() => void load()} data-testid="agent-settings-refresh"><Icon name="refresh" size={14} />Refresh</button>} />
    <FocusDialog open={restartEngineConfirm} onClose={() => setRestartEngineConfirm(false)} title="Restart OpenCode engine?" description="Restarting drops in-flight turns and open permission prompts. Reload engine config and skills first whenever possible." testId="agent-settings-engine-restart-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setRestartEngineConfirm(false)}>Cancel</button><button className="danger-button" type="button" onClick={() => void restartEngine()}>Restart engine</button></div></FocusDialog>
    <FocusDialog open={Boolean(removing)} onClose={() => { if (!actionPending('mcp')) setRemoving(null); }} title="Remove MCP server?" description={removing ? `${removing.name} will be removed from this local workspace configuration.` : ''} testId="agent-settings-mcp-remove-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" disabled={actionPending('mcp')} onClick={() => setRemoving(null)}>Cancel</button><button className="danger-button" type="button" disabled={actionPending('mcp')} aria-busy={Boolean(removing && actionPending('mcp', `remove:${removing.name}`))} onClick={() => void removeMcp()} data-testid="agent-settings-mcp-remove-confirm">{removing && actionPending('mcp', `remove:${removing.name}`) ? 'Removing…' : 'Remove'}</button></div></FocusDialog>
    <FocusDialog open={Boolean(removingOpenai)} onClose={() => { if (!actionPending('openai')) setRemovingOpenai(null); }} title="Remove OpenAI account?" description={removingOpenai ? `${removingOpenai.label} will be removed from Rhythm. If it is the active account, the engine switches to another account or signs out of OpenAI.` : ''} testId="agent-settings-openai-remove-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" disabled={actionPending('openai')} onClick={() => setRemovingOpenai(null)}>Cancel</button><button className="danger-button" type="button" disabled={actionPending('openai')} onClick={() => void removeSelectedOpenai()} data-testid="agent-settings-openai-remove-confirm">{removingOpenai && actionPending('openai', `remove:${removingOpenai.id}`) ? 'Removing…' : 'Remove'}</button></div></FocusDialog>
    <FocusDialog open={Boolean(removingAccount)} onClose={() => { if (!actionPending('accounts')) setRemovingAccount(null); }} title="Remove account?" description={removingAccount ? `${removingAccount.label} will be removed from the local OpenCode account store.` : ''} testId="agent-settings-account-remove-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" disabled={actionPending('accounts')} onClick={() => setRemovingAccount(null)}>Cancel</button><button className="danger-button" type="button" disabled={actionPending('accounts')} aria-busy={Boolean(removingAccount && actionPending('accounts', `remove:${removingAccount.id}`))} onClick={() => void removeSelectedAccount()} data-testid="agent-settings-account-remove-confirm">{removingAccount && actionPending('accounts', `remove:${removingAccount.id}`) ? 'Removing…' : 'Remove'}</button></div></FocusDialog>
  </Frame>;
}
