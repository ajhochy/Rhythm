import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ListInspector, useSelectedId, type ListInspectorItem } from '../../components/ListInspector';
import { navigate } from '../../components/Shell';
import { resetSplitterSizes } from '../../components/Splitter';
import { useAuthUser } from '../../gateway/auth';
import { useGateway } from '../../gateway/context';
import type { WorkspaceSettings } from '../../gateway/settings';
import {
  DEFAULT_LOCAL_USER_PREFERENCES,
  readLocalUserPreferences,
  resetLocalUserPreferences,
  SEND_MESSAGE_KEY_OPTIONS,
  sendMessageKeyLabel,
  USER_PREFERENCES_CHANGED_EVENT,
  writeLocalUserPreferences,
  type SendMessageKey,
} from '../../gateway/user-preferences';
import type { WorkspaceMember } from '../../gateway/workspace-members';
import { useFixtures } from '../../store';
import './SettingsPage.css';

type SettingsMember = WorkspaceMember & { isFacilitiesManager?: boolean };

const settingsGroups = [
  { id: 'preferences', label: 'Personal preferences' },
  { id: 'workspace', label: 'Workspace administration' },
  { id: 'account', label: 'Account and desktop' },
  { id: 'related', label: 'Related settings' },
];

const relatedDestinations: Record<string, string> = {
  'agent-settings': '/tools/agent-settings',
  'shared-agents': '/tools/shared-agents',
  integrations: '/integrations',
  'mobile-access': '/mobile-access',
  memory: '/tools/brain',
};

export function SettingsPage() {
  const gateway = useGateway();
  const settings = gateway.domains.settings;
  const auth = useAuthUser();
  const { theme, setTheme } = useFixtures();
  const preferenceUserId = auth?.user.id ?? 'fixture';
  const initialLocal = readLocalUserPreferences(preferenceUserId);
  const shell = (window as Window & {
    rhythmShell?: { appVersion?: string; updates?: { openDownloadPage(): Promise<void> } };
  }).rhythmShell;

  const [workspace, setWorkspace] = useState<WorkspaceSettings | null>(null);
  const [members, setMembers] = useState<SettingsMember[]>([]);
  const [loading, setLoading] = useState(Boolean(settings));
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(auth?.user.emailNotificationsEnabled ?? true);
  const [runtime, setRuntime] = useState({ api: 'checking', engine: 'checking' });
  const [sendKey, setSendKey] = useState<SendMessageKey>(initialLocal.sendKey);
  const [savedKeyboard, setSavedKeyboard] = useState(initialLocal.sendKey);
  const [selectedId, setSelectedId] = useSelectedId('settingsSection');

  const keyboardDirty = sendKey !== savedKeyboard;
  const admin = workspace?.role === 'admin';

  const loadWorkspace = useCallback(async (showLoading = false) => {
    if (!settings) {
      setLoading(false);
      setLoadError('Settings are unavailable in this environment.');
      return false;
    }
    if (showLoading) setLoading(true);
    try {
      const [nextWorkspace, nextMembers] = await Promise.all([settings.workspace(), settings.members()]);
      setWorkspace(nextWorkspace ?? null);
      setMembers((nextMembers ?? []) as SettingsMember[]);
      setLoadError('');
      return true;
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Settings could not be loaded.');
      return false;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [settings]);

  useEffect(() => { void loadWorkspace(true); }, [loadWorkspace]);

  useEffect(() => {
    const next = readLocalUserPreferences(preferenceUserId);
    setTheme(next.theme);
    setSendKey(next.sendKey);
    setSavedKeyboard(next.sendKey);
    setEmailEnabled(auth?.user.emailNotificationsEnabled ?? true);
  }, [auth?.user.emailNotificationsEnabled, preferenceUserId, setTheme]);

  useEffect(() => {
    const sync = () => {
      if (keyboardDirty) return;
      const next = readLocalUserPreferences(preferenceUserId).sendKey;
      setSendKey(next);
      setSavedKeyboard(next);
    };
    window.addEventListener('storage', sync);
    window.addEventListener(USER_PREFERENCES_CHANGED_EVENT, sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener(USER_PREFERENCES_CHANGED_EVENT, sync); };
  }, [keyboardDirty, preferenceUserId]);

  useEffect(() => {
    void Promise.all([gateway.health.api(), gateway.health.engine()])
      .then(([api, engine]) => setRuntime({ api: api.state, engine: engine.state }))
      .catch(() => setRuntime({ api: 'unavailable', engine: 'unavailable' }));
  }, [gateway]);

  useEffect(() => {
    const route = window.location.hash.split('?')[0];
    if (selectedId === null && (route === '' || route === '#/settings')) setSelectedId('appearance');
  }, [selectedId, setSelectedId]);

  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setActionError('');
    try {
      await operation();
      await loadWorkspace(false);
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Setting could not be saved.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const discardKeyboardDraft = () => {
    setSendKey(savedKeyboard);
  };

  const canLeaveSelection = (nextId: string) => {
    if (selectedId !== 'keyboard-safety' || nextId === selectedId || !keyboardDirty) return true;
    if (!window.confirm('Discard unsaved keyboard and safety changes?')) return false;
    discardKeyboardDraft();
    return true;
  };

  const selectSetting = (nextId: string) => {
    if (!canLeaveSelection(nextId)) return;
    setActionError('');
    const destination = relatedDestinations[nextId];
    if (destination) navigate(destination);
    else setSelectedId(nextId);
  };

  const saveKeyboardPreferences = () => {
    try {
      writeLocalUserPreferences(preferenceUserId, { sendKey });
      setSavedKeyboard(sendKey);
      setActionError('');
    } catch {
      setActionError('Device preference could not be saved. Allow device storage and retry.');
    }
  };

  const resetLocalPreferences = () => {
    try {
      resetLocalUserPreferences(preferenceUserId);
      setTheme(DEFAULT_LOCAL_USER_PREFERENCES.theme);
      setSendKey(DEFAULT_LOCAL_USER_PREFERENCES.sendKey);
      setSavedKeyboard(DEFAULT_LOCAL_USER_PREFERENCES.sendKey);
      setActionError('');
    } catch {
      setActionError('Device preference could not be saved. Allow device storage and retry.');
    }
  };

  const facilitiesManagers = members.filter((member) => member.isFacilitiesManager).length;
  const items: ListInspectorItem[] = [
    { id: 'appearance', title: 'Appearance', subtitle: `${theme === 'light' ? 'Light' : 'Dark'} theme · This device`, group: 'preferences' },
    { id: 'keyboard-safety', title: 'Keyboard & safety', subtitle: `${sendMessageKeyLabel(sendKey)} to send · This device`, badge: keyboardDirty ? 'Unsaved' : undefined, group: 'preferences' },
    { id: 'workspace', title: 'Workspace', subtitle: workspace?.name ?? 'No workspace available', group: 'workspace' },
    { id: 'members', title: 'Members & roles', subtitle: members.length === 1 ? '1 workspace member' : `${members.length} workspace members`, group: 'workspace' },
    { id: 'join-code', title: 'Join code', subtitle: admin ? 'Available to workspace admins' : 'Admin access required', group: 'workspace' },
    { id: 'facilities-access', title: 'Facilities Manager access', subtitle: `${facilitiesManagers} ${facilitiesManagers === 1 ? 'member' : 'members'} with access`, group: 'workspace' },
    { id: 'notifications', title: 'Notifications', subtitle: `Email notifications ${emailEnabled ? 'on' : 'off'} · User preference`, group: 'account' },
    { id: 'accounts', title: 'Accounts & access', subtitle: auth?.user.email ?? 'No signed-in account', group: 'account' },
    { id: 'runtime', title: 'Runtime & updates', subtitle: `API ${runtime.api} · Engine ${runtime.engine}`, group: 'account' },
    { id: 'agent-settings', title: 'Agent Settings', subtitle: 'AI accounts, profiles, and tool access', group: 'related' },
    { id: 'shared-agents', title: 'Shared Agents', subtitle: 'Canonical agents across OpenCode and Hermes', group: 'related' },
    { id: 'integrations', title: 'Integrations', subtitle: 'Google, Gmail, and Planning Center', group: 'related' },
    { id: 'mobile-access', title: 'Mobile Access', subtitle: 'Connect a phone to this desktop', group: 'related' },
    { id: 'memory', title: 'Memory', subtitle: 'Semantic memory and memory vault', group: 'related' },
  ];

  const inspectorFeedback = <>
    {busy && <p className="settings-feedback" role="status">Saving workspace setting…</p>}
    {actionError && <p className="settings-feedback error" role="alert">{actionError}</p>}
  </>;

  const renderInspector = (item: ListInspectorItem | null): ReactNode => {
    if (!item) return <p className="settings-empty">Select a settings section to inspect its current values and actions.</p>;

    const workspaceDependent = ['workspace', 'members', 'join-code', 'facilities-access'].includes(item.id);
    const workspaceError = workspaceDependent && loadError ? <div className="settings-load-error" role="alert" data-testid="settings-workspace-error"><p>{loadError}</p><button className="secondary-button" type="button" onClick={() => void loadWorkspace(true)}>Try again</button></div> : null;

    let content: ReactNode;
    switch (item.id) {
      case 'appearance':
        content = <>
          <p className="settings-section-intro">Choose how Rhythm looks on this device. The preference is kept separate for each signed-in account.</p>
          <label className="settings-field">Theme
            <select value={theme} onChange={(event) => {
              const next = event.target.value as 'dark' | 'light';
              try {
                writeLocalUserPreferences(preferenceUserId, { theme: next });
                setTheme(next);
                setActionError('');
              } catch {
                setActionError('Device preference could not be saved. Allow device storage and retry.');
              }
            }}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <div className="settings-actions">
            <button className="secondary-button" type="button" onClick={() => resetSplitterSizes()} data-testid="reset-layout">Reset layout</button>
          </div>
          <p className="settings-scope">Device preference · Account scoped</p>
        </>;
        break;
      case 'keyboard-safety':
        content = <>
          <p className="settings-section-intro">Set the composer shortcut on this device. Destructive actions keep the confirmation required by their own workflow.</p>
          <form className="settings-form" onSubmit={(event) => { event.preventDefault(); saveKeyboardPreferences(); }}>
            <label className="settings-field">Send message key
              <select value={sendKey} onChange={(event) => setSendKey(event.target.value as SendMessageKey)}>
                {SEND_MESSAGE_KEY_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="settings-actions">
              <button className="primary-button" type="submit" disabled={!keyboardDirty}>Save keyboard preference</button>
              <button className="secondary-button" type="button" onClick={resetLocalPreferences}>Reset keyboard preference</button>
            </div>
          </form>
          <p className="settings-scope">Device preference · Account scoped</p>
        </>;
        break;
      case 'workspace':
        content = <>
          <p className="settings-section-intro">This information comes from the signed-in workspace. Workspace administration is shared with every member.</p>
          {workspace ? <dl className="settings-properties">
            <div><dt>Workspace</dt><dd>{workspace.name}</dd></div>
            <div><dt>Your access</dt><dd>{workspace.role === 'admin' ? 'Administrator' : 'Staff member'}</dd></div>
            <div><dt>Workspace ID</dt><dd>{workspace.id}</dd></div>
          </dl> : <p className="settings-empty">No workspace is available for this account.</p>}
          <p className="settings-scope">Workspace administration</p>
        </>;
        break;
      case 'members':
        content = <>
          <p className="settings-section-intro">Review workspace membership and roles. You cannot change your own role or remove yourself.</p>
          {members.length === 0 ? <p className="settings-empty">No workspace members found.</p> : <ul className="settings-member-list">
            {members.map((member) => {
              const self = member.userId === auth?.user.id;
              return <li key={member.userId}>
                <div className="settings-member-copy"><strong>{member.name}{self ? ' (you)' : ''}</strong><small>{member.email}</small></div>
                <label className="settings-inline-field">Role for {member.name}
                  <select aria-label={`Role for ${member.name}`} value={member.role} disabled={!admin || busy || self} onChange={(event) => void mutate(() => settings!.updateRole(member.userId, event.target.value as 'admin' | 'staff'))}>
                    <option value="admin">Admin</option>
                    <option value="staff">Staff</option>
                  </select>
                </label>
                {admin && !self && <button className="text-danger-button" type="button" disabled={busy} onClick={() => {
                  if (window.confirm(`Remove ${member.name} from this workspace?`)) void mutate(() => settings!.removeMember(member.userId));
                }}>Remove {member.name}</button>}
              </li>;
            })}
          </ul>}
        </>;
        break;
      case 'join-code':
        content = <>
          <p className="settings-section-intro">Share this code only with people who should join the workspace. Regenerating it invalidates the previous code.</p>
          {workspace?.joinCode ? <p className="settings-join-code">Join code: <code>{workspace.joinCode}</code></p> : <p className="settings-empty">No join code is available.</p>}
          {admin ? <button className="primary-button" type="button" disabled={busy} onClick={() => {
            if (window.confirm('Regenerate the workspace join code? The current code will stop working.')) void mutate(() => settings!.regenerateJoinCode());
          }}>Regenerate join code</button> : <p className="settings-readonly" role="status">Only a workspace administrator can regenerate the join code.</p>}
        </>;
        break;
      case 'facilities-access':
        content = <>
          <p className="settings-section-intro">Control who can manage facilities scheduling. This workspace-wide permission is separate from member roles.</p>
          {members.length === 0 ? <p className="settings-empty">No workspace members found.</p> : <ul className="settings-access-list">
            {members.map((member) => <li key={member.userId}>
              <label className="settings-check">
                <input
                  type="checkbox"
                  aria-label={`Facilities manager for ${member.name}`}
                  checked={Boolean(member.isFacilitiesManager)}
                  disabled={!admin || busy}
                  onChange={(event) => void mutate(() => settings!.updateUser(member.userId, { isFacilitiesManager: event.target.checked }))}
                />
                <span><strong>{member.name}</strong><small>{member.email}</small></span>
              </label>
            </li>)}
          </ul>}
          {!admin && <p className="settings-readonly" role="status">Facilities Manager access is read-only for staff members.</p>}
        </>;
        break;
      case 'notifications':
        content = <>
          <p className="settings-section-intro">Notification preferences follow your Rhythm account rather than the whole workspace.</p>
          <label className="settings-check">
            <input type="checkbox" checked={emailEnabled} disabled={busy} onChange={(event) => {
              const checked = event.target.checked;
              setEmailEnabled(checked);
              void mutate(() => settings!.updatePreferences({ emailNotificationsEnabled: checked })).then((saved) => {
                if (!saved) setEmailEnabled(!checked);
              });
            }} />
            <span><strong>Email notifications</strong><small>Receive account email for supported Rhythm activity.</small></span>
          </label>
          <p className="settings-scope">User preference · Synced with your account</p>
        </>;
        break;
      case 'accounts':
        content = <>
          <p className="settings-section-intro">Review the current signed-in identity or end this desktop session. Provider and integration setup live in their dedicated destinations.</p>
          <dl className="settings-properties">
            <div><dt>Name</dt><dd>{auth?.user.name ?? 'Unavailable'}</dd></div>
            <div><dt>Email</dt><dd>{auth?.user.email ?? 'Unavailable'}</dd></div>
          </dl>
          {auth?.auth?.logout ? <button className="text-danger-button" type="button" onClick={() => {
            if (window.confirm('Sign out of Rhythm on this device?')) void auth.auth!.logout!();
          }}>Sign out</button> : <p className="settings-readonly" role="status">Sign out is available in the Rhythm desktop app.</p>}
        </>;
        break;
      case 'runtime':
        content = <>
          <p className="settings-section-intro">Inspect the desktop build and the two local services Rhythm uses for agent work.</p>
          <dl className="settings-properties">
            <div><dt>Version</dt><dd>Version: {shell?.appVersion ?? 'development'}</dd></div>
            <div><dt>API</dt><dd>{runtime.api}</dd></div>
            <div><dt>Engine</dt><dd>{runtime.engine}</dd></div>
          </dl>
          <p className="settings-readonly" role="status">Restart Rhythm to restart the owned local runtime.</p>
          {shell?.updates && <button className="primary-button" type="button" onClick={() => void shell.updates!.openDownloadPage()}>Check Rhythm releases</button>}
        </>;
        break;
      default:
        content = <p className="settings-section-intro">This settings destination opens in its own workspace.</p>;
    }

    return <div className="settings-inspector-content">{inspectorFeedback}{workspaceError}{content}</div>;
  };

  return <section className="page-shell settings-page" aria-labelledby="settings-title" data-testid="page-settings">
    <header className="settings-page-header">
      <span className="eyebrow">Rhythm</span>
      <h1 id="settings-title">Settings</h1>
      <p>Personal preferences, workspace administration, account access, and desktop health.</p>
    </header>
    <ListInspector
      label="Settings sections"
      items={items}
      groups={settingsGroups}
      selectedId={selectedId}
      onSelect={selectSetting}
      loading={loading}
      emptyState={<p>No settings sections are available.</p>}
      inspector={renderInspector}
      className="settings-list-inspector"
    />
  </section>;
}
