import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { applyStructuredEdit, editMcpGroup, isAction, isRecord, mcpGroupSelection, parseMcpSelection, parsePolicy, parseSkillSelection, permissionDefault, serializePolicy } from './profilePolicy';
import type { PermissionAction, StructuredEdit } from './profilePolicy';
import './Profiles.css';
import { useGateway } from '../gateway/context';
import type { McpServer } from '../gateway/mcp';
import type { SkillEntry } from '../gateway/skills';
import { Icon } from '../icons';
import { emptyLiveProfile, useFixtures } from '../store';
import type { IdentityProfile } from '../gateway/sessions';
import type { Profile } from '../types';
import { FocusDialog } from './FocusDialog';
import { Splitter } from './Splitter';
import { navigate } from './Shell';

function parseNameList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; }
  catch { return []; }
}

const looksLikeAssetPath = (icon: string) => icon.includes('/') || /\.[a-z0-9]+$/i.test(icon);
const profileInitials = (label: string) => label.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join('').toUpperCase() || 'AG';
export const profileAvatarLabel = (profile: Pick<Profile, 'icon' | 'label'>) => profile.icon && !looksLikeAssetPath(profile.icon) && profile.icon.length <= 3 ? profile.icon : profileInitials(profile.label);
export function ProfileAvatar({ profile, size }: { profile: Profile; size?: 'large' | 'tiny' }) {
  // ponytail: Flutter agent assets are not shipped by the web bundle, so avoid a known-broken img.
  return <span className={`profile-avatar${size ? ` ${size}` : ''}`} role="img" aria-label={`${profile.label} icon`}>{profileAvatarLabel(profile)}</span>;
}

type CapabilityChoice = { name: string; description?: string; testId: string };
function CapabilityGroup({ name, choices, selected, inherited, filter, disabled, onChange }: {
  name: string; choices: CapabilityChoice[]; selected: string[]; inherited: boolean; filter: string; disabled?: boolean;
  onChange(selected: string[]): void;
}) {
  const [expanded, setExpanded] = useState(true);
  const query = filter.trim().toLowerCase();
  const visible = choices.filter(choice => `${name} ${choice.name} ${choice.description ?? ''}`.toLowerCase().includes(query));
  if (query && !visible.length) return null;
  return <details className="profile-capability-group" open={query ? true : expanded} onToggle={event => { if (!query) setExpanded(event.currentTarget.open); }}>
    <summary><strong>{name}</strong><span>{choices.filter(choice => selected.includes(choice.name)).length} of {choices.length} selected</span><span className="profile-policy-source">{inherited ? 'Inherited' : 'Explicit'}</span></summary>
    <div className="profile-group-actions"><button className="text-button" type="button" disabled={disabled || !choices.length} onClick={() => onChange([...new Set([...selected, ...choices.map(choice => choice.name)])])}>Select all in group<span className="sr-only">: {name}</span></button><button className="text-button" type="button" disabled={disabled || !selected.length} onClick={() => onChange([])}>Clear group<span className="sr-only">: {name}</span></button></div>
    <div className="profile-capability-choices">{visible.map(choice => <label key={choice.name} className="profile-check-choice"><input type="checkbox" checked={selected.includes(choice.name)} disabled={disabled} onChange={event => onChange(event.target.checked ? [...selected, choice.name] : selected.filter(item => item !== choice.name))} data-testid={choice.testId} /><span><strong>{choice.name}</strong>{choice.description && <small>{choice.description}</small>}</span></label>)}</div>
    {!choices.length && <p>No tools are listed for this server.</p>}
  </details>;
}

const permissionCategories = [
  ['read', 'Read files'], ['edit', 'Edit files'], ['bash', 'Run shell commands'],
  ['webfetch', 'Fetch web pages'], ['websearch', 'Search the web'], ['task', 'Delegate tasks'],
  ['external_directory', 'Access files outside the project'],
] as const;
const permissionLabels: Record<string, string> = { ...Object.fromEntries(permissionCategories), shell: 'Shell (legacy rule)', files: 'Files (legacy rule)', network: 'Network (legacy rule)' };

function PermissionsEditor({ raw, onChange }: { raw: string | null; onChange(value: string | null): void }) {
  const [editError, setEditError] = useState('');
  const [tool, setTool] = useState('bash');
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState<PermissionAction>('ask');
  const parsed = useMemo(() => {
    try { return { policy: parsePolicy(raw), error: '' }; }
    catch (error) { return { policy: null, error: (error as Error).message }; }
  }, [raw]);
  const value = parsed.policy?.value;
  const categories = [...new Set([...permissionCategories.map(([key]) => key), ...Object.keys(value ?? {})])];
  const patterns = Object.entries(value ?? {}).flatMap(([category, rules]) => isRecord(rules)
    ? Object.entries(rules).filter(([key, rule]) => key !== '*' && isAction(rule)).map(([key, rule]) => ({ tool: category, pattern: key, action: rule as PermissionAction })) : []);
  const edit = (change: StructuredEdit) => {
    if (!parsed.policy) return false;
    try { onChange(serializePolicy(applyStructuredEdit(parsed.policy, change))); setEditError(''); return true; }
    catch (error) { setEditError((error as Error).message); return false; }
  };
  return <>
    <p className="profile-policy-note">{parsed.error ? 'Correct the JSON to see its permission rules.' : value === null ? 'Inherited engine policy. No profile overrides.' : 'Explicit profile policy. Unlisted rules inherit engine policy.'} Ask requests approval; allow permits the action; deny blocks it. Pattern rules can override a category default.</p>
    {(parsed.error || editError) && <p role="alert" className="profile-feedback error" id="profile-policy-error">{parsed.error || editError}</p>}
    <fieldset className="profile-permission-controls" disabled={!parsed.policy}><legend className="sr-only">Common permission choices</legend>
      {categories.map(category => {
        const choice = permissionDefault(value?.[category]);
        return <label className="profile-permission-row" key={category}><span><strong>{Object.hasOwn(permissionLabels, category) ? permissionLabels[category] : category}</strong><small>{category}{isRecord(value?.[category]) ? ' · pattern rules retained' : ''}</small></span><select value={choice} disabled={choice === 'advanced'} onChange={event => edit({ kind: 'default', tool: category, action: event.target.value as PermissionAction | 'inherit' })} data-testid={`permission-${category}`}><option value="inherit">Inherit</option><option value="ask">Ask</option><option value="allow">Allow</option><option value="deny">Deny</option>{choice === 'advanced' && <option value="advanced">Advanced value — see JSON</option>}</select></label>;
      })}
      <details className="profile-patterns" open={patterns.length > 0 ? true : undefined}><summary>Per-tool patterns ({patterns.length})</summary>
        <p>Match a command or path for one tool. Rules stay in their saved order; later matching rules take precedence. Add specific rules after broad patterns.</p>
        {patterns.map(row => <div className="profile-pattern-row" key={`${row.tool}:${row.pattern}`}><div><strong>{row.tool}</strong><code>{row.pattern}</code></div><label><span className="sr-only">{row.tool}: {row.pattern}</span><select value={row.action} onChange={event => edit({ kind: 'pattern', tool: row.tool, pattern: row.pattern, action: event.target.value as PermissionAction })}><option value="ask">Ask</option><option value="allow">Allow</option><option value="deny">Deny</option></select></label><button className="text-danger-button" type="button" onClick={() => edit({ kind: 'remove-pattern', tool: row.tool, pattern: row.pattern })}>Remove<span className="sr-only"> {row.tool}: {row.pattern}</span></button></div>)}
        <p>Fill in a tool and pattern, then choose Add pattern to include the rule in this draft.</p>
        <div className="profile-pattern-add" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault(); }}><label className="field">Tool category<input list="profile-permission-categories" value={tool} onChange={event => setTool(event.target.value)} data-testid="profile-pattern-tool" /></label><datalist id="profile-permission-categories">{categories.map(category => <option key={category} value={category} />)}</datalist><label className="field">Command or path pattern<input placeholder="git * or src/**" value={pattern} onChange={event => setPattern(event.target.value)} data-testid="profile-pattern-value" /></label><label className="field">Permission<select value={action} onChange={event => setAction(event.target.value as PermissionAction)} data-testid="profile-pattern-action"><option value="ask">Ask</option><option value="allow">Allow</option><option value="deny">Deny</option></select></label><button className="secondary-button" type="button" data-testid="profile-pattern-add" disabled={!tool.trim() || !pattern.trim()} onClick={() => {
          if (isRecord(value?.[tool]) && Object.hasOwn(value[tool], pattern)) { setEditError('That pattern already exists. Edit its permission in the row above.'); return; }
          if (edit({ kind: 'pattern', tool, pattern, action })) setPattern('');
        }}>Add pattern</button></div>
      </details>
    </fieldset>
    <details className="profile-advanced" open={parsed.error ? true : undefined}><summary>Advanced (JSON)</summary><label className="field">Canonical permission policy (JSON)<textarea rows={8} value={raw ?? ''} onChange={event => { setEditError(''); onChange(event.target.value.trim() ? event.target.value : null); }} aria-invalid={!!parsed.error} aria-describedby={parsed.error ? 'profile-policy-error' : 'profile-policy-help'} spellCheck={false} data-testid="profile-permissions" /><span id="profile-policy-help">Blank inherits engine policy. Structured edits preserve untouched keys, patterns, and advanced values exactly. The server validates supported policy when you save.</span></label></details>
  </>;
}

const draftSignature = ({ updatedAt: _updatedAt, isDefault: _isDefault, ...profile }: IdentityProfile) => JSON.stringify(profile);
type ProfileNavigation = { kind: 'select'; id: string } | { kind: 'create' | 'duplicate' | 'back' };

export function Profiles() {
  const { profiles, models, accounts, catalogError, createProfile, updateProfile, duplicateProfile, deleteProfile, setDefaultProfile, notify, sessionGatewayMode } = useFixtures();
  const live = sessionGatewayMode === 'live';
  const gateway = useGateway();
  const [mcpCatalog, setMcpCatalog] = useState<McpServer[]>([]);
  const [mcpCatalogError, setMcpCatalogError] = useState<string | null>(null);
  const [skillCatalog, setSkillCatalog] = useState<SkillEntry[]>([]);
  const [skillCatalogError, setSkillCatalogError] = useState<string | null>(null);
  const loadMcpCatalog = () => {
    setMcpCatalogError(null);
    gateway.domains.mcp!.list().then(setMcpCatalog).catch((err) => setMcpCatalogError(err instanceof Error ? err.message : 'MCP catalog failed to load'));
  };
  const loadSkillCatalog = () => {
    setSkillCatalogError(null);
    gateway.domains.skills!.list().then(setSkillCatalog).catch((err) => setSkillCatalogError(err instanceof Error ? err.message : 'Skill catalog failed to load'));
  };
  // Fired independently (not Promise.all): one catalog failing must never blank the other's
  // already-fetched rows.
  useEffect(() => { if (live) loadMcpCatalog(); }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (live) loadSkillCatalog(); }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selectedId, setSelectedId] = useState(profiles.find((profile) => profile.isDefault)?.id || profiles[0]?.id || '');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState(''); const [sort, setSort] = useState('name'); const [renaming, setRenaming] = useState(false); const [deleteOpen, setDeleteOpen] = useState(false);
  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0] ?? emptyLiveProfile();
  const [draft, setDraft] = useState<IdentityProfile>(structuredClone(selected));
  const [baseline, setBaseline] = useState(draftSignature(selected));
  const dirty = draftSignature(draft) !== baseline;
  const [pendingNavigation, setPendingNavigation] = useState<ProfileNavigation | null>(null);
  const [capabilityFilter, setCapabilityFilter] = useState('');
  const [profileRailWidth, setProfileRailWidth] = useState(260);
  const requestedState = live ? 'ready' : new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('state') ?? 'ready';
  const supportedStates = ['ready', 'loading', 'empty', 'first-use', 'no-results', 'failure', 'forbidden', 'read-only', 'unavailable'];
  const [fixtureState, setFixtureState] = useState(supportedStates.includes(requestedState) ? requestedState : 'ready');
  const readOnly = fixtureState === 'read-only';
  const retryTimer = useRef<number | undefined>(undefined);
  const footerRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    const measure = () => scrollRef.current?.style.setProperty('--profile-footer-height', `${footer.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure); observer.observe(footer); measure();
    return () => observer.disconnect();
  }, [fixtureState]);
  // Catalog/readback refreshes may update status, but never overwrite an unsaved
  // draft. Navigation explicitly resets the draft and binds it to the chosen ID.
  useEffect(() => {
    if (dirty || saving) return;
    setDraft(structuredClone(selected)); setBaseline(draftSignature(selected)); setSelectedId(selected.id);
  }, [selected.id, selected.updatedAt, selected.isDefault, saving, dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (retryTimer.current) window.clearTimeout(retryTimer.current); }, []);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  const visible = useMemo(() => profiles.filter((profile) => `${profile.label} ${profile.modelProvider ?? ''} ${profile.modelId ?? ''}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) : sort === 'provider' ? (a.modelProvider ?? '').localeCompare(b.modelProvider ?? '') : a.label.localeCompare(b.label)), [profiles, search, sort]);
  const set = <K extends keyof IdentityProfile>(key: K, value: IdentityProfile[K]) => { setDraft((current) => ({ ...current, [key]: value })); setSaved(false); setSaveError(''); };
  const resetDraft = (profile: IdentityProfile) => {
    setDraft(structuredClone(profile)); setBaseline(draftSignature(profile)); setRenaming(false); setSaveError(''); setSaved(false); setCapabilityFilter('');
  };
  const performNavigation = (target: ProfileNavigation) => {
    setPendingNavigation(null);
    if (target.kind === 'back') { navigate('/agents'); return; }
    if (target.kind === 'select') {
      const profile = profiles.find(item => item.id === target.id);
      if (profile) { resetDraft(profile); setSelectedId(profile.id); }
      return;
    }
    const id = target.kind === 'create' ? createProfile() : duplicateProfile(draft.id);
    // The new store row arrives on the next render. Clear dirtiness so the
    // identity effect adopts it; Save remains disabled until the IDs agree.
    setBaseline(draftSignature(draft)); setSelectedId(id); setRenaming(false); setSaveError(''); setSaved(false);
  };
  const requestNavigation = (target: ProfileNavigation) => {
    if (savingRef.current || target.kind === 'select' && target.id === draft.id) return;
    if (readOnly && (target.kind === 'create' || target.kind === 'duplicate')) return;
    if (dirty) setPendingNavigation(target); else performNavigation(target);
  };
  const policyRaw = live ? draft.corePermissionsJson ?? null : draft.corePermissionsJson !== undefined ? draft.corePermissionsJson : JSON.stringify(draft.permissionRules);
  let policyError = '';
  try { parsePolicy(policyRaw); } catch (error) { policyError = (error as Error).message; }
  const nameError = draft.label.trim() ? '' : 'Enter a profile label before saving.';
  const missingDraft = !profiles.some(profile => profile.id === draft.id);
  const save = async () => {
    if (savingRef.current || readOnly || missingDraft || draft.id !== selected.id || nameError || policyError) return;
    const submitted = structuredClone(draft);
    const original = JSON.parse(baseline) as Record<string, unknown>;
    // Send only this draft's edits. A status/default/catalog refresh must not
    // make unchanged stale fields overwrite newer store values.
    const patch = Object.fromEntries(Object.entries(submitted).filter(([key, value]) =>
      !['id', 'isDefault', 'updatedAt'].includes(key) && JSON.stringify(value) !== JSON.stringify(original[key]),
    )) as Partial<IdentityProfile>;
    savingRef.current = true; setSaving(true); setSaveError(''); setSaved(false);
    try {
      const id = await updateProfile(submitted.id, patch);
      setDraft({ ...submitted, id }); setBaseline(draftSignature({ ...submitted, id })); setSelectedId(id);
      setRenaming(false); setSaved(true); notify('Profile saved');
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'Profile could not be saved'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const toggleArray = (key: 'allowedDelegates' | 'mcps' | 'skills', value: string) => set(key, draft[key].includes(value) ? draft[key].filter((item) => item !== value) : [...draft[key], value]);
  const mcpPolicy = parseMcpSelection(draft.allowedMcpsJson);
  const skillPolicy = parseSkillSelection(draft.allowedSkillsJson);
  const skillSelections = skillPolicy.inherited ? skillCatalog.map(skill => skill.name) : skillPolicy.selected;
  const setMcpGroup = (server: string, tools: string[]) => {
    try { set('allowedMcpsJson', editMcpGroup(mcpPolicy, server, tools, mcpCatalog)); }
    catch (error) { setSaveError((error as Error).message); }
  };
  const setSkillGroup = (names: string[], groupNames: string[]) => set('allowedSkillsJson', JSON.stringify([...new Set([...skillSelections.filter(name => !groupNames.includes(name)), ...names])]));
  const availableMcpGroups = live ? [...new Set([...mcpCatalog.map(server => server.name), ...Object.keys(mcpPolicy.map ?? {})])] : [];
  const unavailableSkills = skillSelections.filter(name => !skillCatalog.some(skill => skill.name === name));
  const skillSources = [...new Set(skillCatalog.map(skill => skill.source))];
  const capabilitiesMatch = (value: string) => value.toLowerCase().includes(capabilityFilter.trim().toLowerCase());
  if (fixtureState !== 'ready' && fixtureState !== 'read-only') {
    const waiting = fixtureState === 'loading' || fixtureState === 'retrying';
    const recoverable = ['empty', 'first-use', 'no-results'].includes(fixtureState);
    const retryable = fixtureState === 'failure' || fixtureState === 'unavailable';
    return <section className="profiles-workspace profiles-state-workspace" aria-label="Agent profiles" data-testid="profiles-workspace"><button className="text-button profiles-state-back" type="button" onClick={() => navigate('/agents')}><Icon name="chevronRight" className="rotate-180" size={14} />Back to Agents</button><div className="tool-state-panel" role={fixtureState === 'failure' || fixtureState === 'forbidden' || fixtureState === 'unavailable' ? 'alert' : 'status'} aria-busy={waiting || undefined} data-testid={`tool-state-${fixtureState}`}><Icon name={waiting ? 'refresh' : fixtureState === 'forbidden' ? 'background' : 'profile'} className={waiting ? 'spin' : ''} size={26} /><h1>{waiting ? `${fixtureState === 'retrying' ? 'Retrying' : 'Loading'} Profiles` : fixtureState === 'first-use' ? 'Set up Profiles' : fixtureState === 'no-results' ? 'No matching profiles' : fixtureState === 'empty' ? 'No profiles yet' : fixtureState === 'forbidden' ? 'Access denied' : 'Profiles unavailable'}</h1><p>{fixtureState === 'forbidden' ? 'This workspace cannot manage profile policy.' : retryable ? 'The profile service did not return usable data.' : waiting ? 'Waiting for profile data.' : 'No profiles match this view.'}</p>{recoverable && <button className="secondary-button" type="button" onClick={() => setFixtureState('ready')} data-testid="tool-state-restore">Load profiles</button>}{retryable && <button className="primary-button" type="button" onClick={() => { setFixtureState('retrying'); retryTimer.current = window.setTimeout(() => setFixtureState('ready'), 240); }} data-testid="tool-state-retry">Retry</button>}</div></section>;
  }
  return (
    <section className="profiles-workspace profiles-resizable" style={{ '--profile-rail-width': `${profileRailWidth}px` } as React.CSSProperties} aria-label="Agent profiles" aria-describedby={fixtureState === 'read-only' ? 'profiles-readonly' : undefined} data-od-id="profiles-workspace" data-testid="profiles-workspace">
      <aside className="profile-rail" aria-label="Profile list">
        <header><button className="icon-button small" type="button" onClick={() => requestNavigation({ kind: 'back' })} disabled={saving} aria-label="Back to Agents" data-testid="profiles-back"><Icon name="chevronRight" className="rotate-180" /></button><div><h1>Profiles</h1><small>Agent identity &amp; policy</small></div></header>
        <button className="primary-button full" type="button" onClick={() => requestNavigation({ kind: 'create' })} disabled={readOnly || saving} data-testid="profile-create"><Icon name="plus" size={15} />Create profile</button>
        <label className="search-field"><Icon name="search" size={14} /><span className="sr-only">Search profiles</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search profiles" data-testid="profile-search" /></label>
        <label className="sort-label">Sort profiles<select value={sort} onChange={(event) => setSort(event.target.value)} data-testid="profile-sort"><option value="name">Name</option><option value="updated">Updated</option><option value="provider">Provider</option></select></label>
        <div className="profile-list">{visible.map((profile) => <button className={`profile-row ${selectedId === profile.id ? 'selected' : ''}`} type="button" key={profile.id} onClick={() => requestNavigation({ kind: 'select', id: profile.id })} disabled={saving} data-testid={`profile-${profile.id}`}><ProfileAvatar profile={profile} /><span><strong>{profile.label}</strong><small>{profile.modelProvider ?? 'Configured'} · {profile.modelId ?? 'Configured model'}</small></span>{profile.isDefault && <em>Default</em>}{!profile.enabled && <em>Disabled</em>}</button>)}</div>
      </aside>
      <Splitter orientation="vertical" storageKey="layout.profiles.rail" min={240} max={420} defaultSize={260} onResize={setProfileRailWidth} ariaLabel="Resize Profiles list" testId="profiles-rail-resizer" />
      {!selected.id && <p role="status">No profiles configured. Create a profile to begin.</p>}
      <fieldset className="profile-editor profile-editor-fieldset" aria-labelledby="profile-editor-title" disabled={readOnly || !selected.id || saving} aria-busy={saving}>
        <div className="profile-editor-layout">
      {fixtureState === 'read-only' && <div className="tool-readonly-banner profile-editor-readonly" role="status" id="profiles-readonly" data-testid="tool-state-read-only"><Icon name="background" size={15} /><span><strong>Read-only</strong> · Profiles remain inspectable, but policy changes are disabled.</span></div>}
        <header className="profile-editor-header" tabIndex={0}><div className="editor-title"><ProfileAvatar profile={draft} size="large" /><div>
          <div className="profile-title-line"><h2 id="profile-editor-title">{draft.label || 'Untitled profile'}</h2><button className="icon-button" type="button" onClick={() => setRenaming(true)} aria-label="Rename profile inline" data-testid="profile-rename"><Icon name="rename" size={16} /></button></div>
          {renaming && <div className="profile-inline-rename"><label className="sr-only" htmlFor="inline-profile-name">Profile name</label><input id="inline-profile-name" autoFocus value={draft.label} onChange={event => set('label', event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setRenaming(false); } }} data-testid="profile-inline-name" /><button className="icon-button" type="button" onClick={() => setRenaming(false)} aria-label="Confirm rename" data-testid="profile-inline-confirm"><Icon name="check" size={16} /></button></div>}
          <p>{draft.modelProvider ?? 'No provider preference'} · {draft.modelId ?? 'No model preference'}</p>
          <div className="profile-status-line"><span>{draft.enabled ? 'Enabled' : 'Disabled'}</span><span>{draft.selectable ? 'Session-selectable' : 'Hidden from session picker'}</span>{selected.isDefault && <span>Default profile</span>}{(live ? draft.isManager : draft.managerAgent) && <span>Manager</span>}{live && draft.id.startsWith('profile-created-') && <span>New · not saved yet</span>}</div>
        </div></div></header>
        <form className="profile-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="profile-editor-scroll" ref={scrollRef} tabIndex={0} role="region" aria-label="Profile settings" data-testid="profile-editor-scroll">
          {live && catalogError && <p role="alert" className="profile-feedback error">{catalogError}</p>}
          {missingDraft && dirty && <p role="alert">This profile is no longer available. Your draft has been kept. Cancel to load an available profile.</p>}
          <section className="editor-section"><header><div><h3>Identity &amp; instructions</h3><p>How this profile appears and guides each session.</p></div></header><div className="form-grid"><label className="field">{!looksLikeAssetPath(draft.icon) && draft.icon.length <= 3 ? 'Icon label' : 'Icon value'}<input value={draft.icon} maxLength={!looksLikeAssetPath(draft.icon) && draft.icon.length <= 3 ? 3 : undefined} onChange={(event) => set('icon', !looksLikeAssetPath(draft.icon) && draft.icon.length <= 3 ? event.target.value.toUpperCase() : event.target.value)} data-testid="profile-icon" /></label><label className="field">Profile label<input required aria-invalid={!!nameError} aria-describedby={nameError ? "profile-name-error" : undefined} value={draft.label} onChange={(event) => set('label', event.target.value)} data-testid="profile-label" /></label><label className="field span-2">System prompt<textarea rows={5} value={draft.systemPrompt} onChange={(event) => set('systemPrompt', event.target.value)} data-testid="profile-system-prompt" /></label></div></section>
          <section className="editor-section"><header><div><h3>Provider, model &amp; account</h3><p>Defaults used when a session begins with this profile.</p></div></header><div className="form-grid">
            <label className="field">Provider<select value={draft.modelProvider ?? ''} onChange={(event) => { set('modelProvider', event.target.value || null); set('modelId', null); }} data-testid="profile-provider"><option value="">No preference</option>{live ? <>{draft.modelProvider && !models.some(m => m.providerId === draft.modelProvider) && <option value={draft.modelProvider} disabled>{draft.modelProvider} (unavailable)</option>}{[...new Set(models.map(m => m.providerId))].map(id => <option key={id} value={id}>{id}</option>)}</> : <><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="local">Local provider</option></>}</select></label>
            <label className="field">Model<select value={draft.modelId ?? ''} onChange={(event) => set('modelId', event.target.value || null)} data-testid="profile-model"><option value="">No preference</option>{live ? <>{draft.modelId && !models.some(m => m.providerId === draft.modelProvider && m.modelId === draft.modelId) && <option value={draft.modelId} disabled>{draft.modelId} (unavailable)</option>}{models.filter(m => m.providerId === draft.modelProvider).map(m => <option key={m.modelId} value={m.modelId}>{m.label}</option>)}</> : <><option value="gpt-5.6">gpt-5.6</option><option value="gpt-5.6-codex">gpt-5.6-codex</option><option value="claude-sonnet-4">claude-sonnet-4</option><option value="claude-sonnet-4-6">claude-sonnet-4-6</option></>}</select></label>
            <label className="field span-2">{live ? 'Default Anthropic account' : 'Default account'}{live ? <select value={draft.defaultAnthropicAccountId ?? ''} onChange={(event) => set('defaultAnthropicAccountId', event.target.value || null)} data-testid="profile-account"><option value="">No default</option>{draft.defaultAnthropicAccountId && !accounts.some(a => a.id === draft.defaultAnthropicAccountId) && <option value={draft.defaultAnthropicAccountId} disabled>{draft.defaultAnthropicAccountId} (unavailable)</option>}{accounts.map(a => <option key={a.id} value={a.id} disabled={!!a.status && a.status !== 'ok'}>{a.label} · {a.id}{a.status && a.status !== 'ok' ? ` (${a.status})` : ''}</option>)}</select> : <select value={draft.defaultAccount} onChange={(event) => set('defaultAccount', event.target.value)} data-testid="profile-account"><option>Rhythm workspace</option><option>Research account</option><option>Local account</option></select>}</label>

          </div></section>
          <section className="editor-section"><header><div><h3>Delegation</h3><p>Let this profile coordinate work and choose which profiles it may delegate to.</p></div><label className="switch-label"><input type="checkbox" checked={live ? draft.isManager === true : draft.managerAgent} onChange={(event) => set(live ? 'isManager' : 'managerAgent', event.target.checked)} data-testid="profile-manager" /><span />Manager agent</label></header><fieldset className="option-grid"><legend>Allowed delegates</legend>{profiles.filter((profile) => profile.id !== selected.id && (!live || profile.enabled && !profile.id.startsWith('profile-created-'))).map((profile) => <label key={profile.id}><input type="checkbox" checked={(live ? parseNameList(draft.allowedDelegatesJson) : draft.allowedDelegates).includes(profile.id)} onChange={() => { if (!live) toggleArray('allowedDelegates', profile.id); else { const list = parseNameList(draft.allowedDelegatesJson); set('allowedDelegatesJson', JSON.stringify(list.includes(profile.id) ? list.filter(id => id !== profile.id) : [...list, profile.id])); } }} data-testid={`delegate-${profile.id}`} /><ProfileAvatar profile={profile} size="tiny" /><span><strong>{profile.label}</strong><small>{profile.model}</small></span></label>)}</fieldset></section>
          <section className="editor-section"><header><div><h3>Availability &amp; defaults</h3><p>Enabled profiles can run. Session-selectable profiles appear in the session picker. Choose a default in Actions below.</p></div></header><div className="switch-row"><label className="switch-label"><input type="checkbox" checked={draft.selectable} onChange={(event) => set('selectable', event.target.checked)} data-testid="profile-selectable" /><span />Session-selectable</label><label className="switch-label"><input type="checkbox" checked={draft.enabled} onChange={(event) => set('enabled', event.target.checked)} data-testid="profile-enabled" /><span />Enabled</label><label className="switch-label"><input type="checkbox" checked={draft.managedSkills} disabled={live} aria-describedby={live ? 'managed-skills-unavailable' : undefined} onChange={(event) => set('managedSkills', event.target.checked)} data-testid="profile-managed-skills" /><span />Managed skills</label></div>{live && <p id="managed-skills-unavailable">Managed skills cannot be saved by this editor.</p>}</section>
          <section className="editor-section" aria-labelledby="profile-capabilities-title"><header><div><h3 id="profile-capabilities-title">Capabilities</h3><p>{live ? 'Choose tools from each server and skills from each source.' : 'Preview MCP servers and skills. Fixture choices do not change live access.'}</p></div><button className="secondary-button" type="button" onClick={() => { if (live) { loadMcpCatalog(); loadSkillCatalog(); } else notify('MCP servers and skills refreshed'); }} data-testid="profile-resync"><Icon name="refresh" size={14} />Refresh capabilities</button></header>
            <label className="field profile-capability-filter">Filter tools and skills<input type="search" value={capabilityFilter} onChange={event => setCapabilityFilter(event.target.value)} placeholder="Server, tool, skill, or source" data-testid="profile-capability-filter" /></label>
            {live && <p className="profile-policy-note">Inherited means this profile does not narrow that selection. Other engine rules still apply. Editing inherited access creates an explicit selection of the listed choices; future catalog additions are excluded.</p>}
            <div className="profile-capability-catalog" data-testid="profile-capability-catalog">
              <h4>MCP tools</h4>
              {live ? <>
                {mcpCatalogError && <p role="alert">{mcpCatalogError} Use Refresh capabilities to retry.</p>}
                {mcpPolicy.error && <p role="alert">{mcpPolicy.error}</p>}
                {availableMcpGroups.map(name => {
                  const server = mcpCatalog.find(item => item.name === name);
                  const group = mcpGroupSelection(mcpPolicy, name, server?.tools ?? []);
                  const names = [...new Set([...(server?.tools ?? []), ...group.selected])];
                  return <CapabilityGroup key={name} name={name} choices={names.map(tool => ({ name: tool, description: server?.tools.includes(tool) ? undefined : 'Not in the current catalog; saved selection retained.', testId: `mcp-${name}-${tool}` }))} selected={group.selected} inherited={group.inherited} filter={capabilityFilter} disabled={!!mcpPolicy.error || !!mcpCatalogError || !server} onChange={tools => setMcpGroup(name, tools)} />;
                })}
                {!mcpCatalogError && !availableMcpGroups.length && <p>No MCP servers configured.</p>}
                {capabilityFilter && availableMcpGroups.length > 0 && !availableMcpGroups.some(name => capabilitiesMatch(`${name} ${mcpCatalog.find(server => server.name === name)?.tools.join(' ') ?? ''} ${mcpGroupSelection(mcpPolicy, name, []).selected.join(' ')}`)) && <p>No matching MCP tools.</p>}
              </> : <CapabilityGroup name="Workspace MCP servers" choices={['GitNexus', 'Open Design', 'Web research'].map(name => ({ name, testId: `mcp-${name.toLowerCase().replace(' ', '-')}` }))} selected={draft.mcps} inherited={false} filter={capabilityFilter} onChange={names => set('mcps', names)} />}
              <h4>Skills</h4>
              {live ? <>
                {skillCatalogError && <p role="alert">{skillCatalogError} Use Refresh capabilities to retry.</p>}
                {skillPolicy.error && <p role="alert">{skillPolicy.error}</p>}
                {skillSources.map(source => {
                  const skills = skillCatalog.filter(skill => skill.source === source);
                  return <CapabilityGroup key={source} name={`${source} skills`} choices={skills.map(skill => ({ name: skill.name, description: skill.description, testId: `skill-${skill.name}` }))} selected={skillSelections.filter(name => skills.some(skill => skill.name === name))} inherited={skillPolicy.inherited} filter={capabilityFilter} disabled={!!skillPolicy.error || !!skillCatalogError} onChange={names => setSkillGroup(names, skills.map(skill => skill.name))} />;
                })}
                {unavailableSkills.length > 0 && <CapabilityGroup name="Saved skills outside the catalog" choices={unavailableSkills.map(name => ({ name, testId: `skill-${name}`, description: 'Not in the current catalog; saved selection retained.' }))} selected={unavailableSkills} inherited={false} filter={capabilityFilter} disabled={!!skillPolicy.error} onChange={names => setSkillGroup(names, unavailableSkills)} />}
                {!skillCatalogError && !skillCatalog.length && !unavailableSkills.length && <p>No skills found.</p>}
                {capabilityFilter && skillCatalog.length > 0 && !skillCatalog.some(skill => capabilitiesMatch(`${skill.source} skills ${skill.name} ${skill.description ?? ''}`)) && !unavailableSkills.some(capabilitiesMatch) && <p>No matching skills.</p>}
              </> : <CapabilityGroup name="Workspace skills" choices={['planning', 'verification', 'frontend', 'tests', 'research', 'citations'].map(name => ({ name, testId: `skill-${name}` }))} selected={draft.skills} inherited={false} filter={capabilityFilter} onChange={names => set('skills', names)} />}
            </div>
          </section>
          <section className="editor-section"><header><div><h3>Permissions</h3><p>Set the approval rules for core tools. Unchanged rules keep their existing behavior.</p></div></header>
            <PermissionsEditor key={draft.id} raw={policyRaw} onChange={value => {
              set('corePermissionsJson', value);
              if (!live) { try { const parsed = parsePolicy(value).value; set('permissionRules', Object.fromEntries(Object.entries(parsed ?? {}).filter(([, rule]) => isAction(rule))) as IdentityProfile['permissionRules']); } catch { /* Keep invalid draft for correction. */ } }
            }} />
            {live && <label className="check-label"><input type="checkbox" checked={draft.autoApproveActions === true} onChange={event => set('autoApproveActions', event.target.checked)} data-testid="profile-auto-approve" />Auto-approve protected actions</label>}
          </section>
          <section className="editor-section profile-actions"><header><div><h3>Actions</h3><p>These actions take effect immediately. Save your edits first to include them in a duplicate.</p></div></header>
            <div className="profile-action-row"><div><strong>Duplicate profile</strong><p>Create a copy of the saved profile{live ? ', then save it to create it on the server' : ''}.</p></div><button className="secondary-button" type="button" onClick={() => requestNavigation({ kind: 'duplicate' })} disabled={missingDraft || draft.id !== selected.id} data-testid="profile-duplicate"><Icon name="copy" size={14} />Duplicate</button></div>
            <div className="profile-action-row"><div><strong>Default profile</strong><p>{live ? 'Local to this account; resets on reload. Save and enable the profile before choosing it.' : 'Use this profile when starting a new session.'}</p></div><button className="secondary-button" type="button" onClick={() => setDefaultProfile(draft.id)} disabled={missingDraft || draft.id !== selected.id || selected.isDefault || live && (!selected.enabled || !selected.selectable || selected.id.startsWith('profile-created-'))} title={selected.isDefault ? 'Already the default profile' : undefined} data-testid="profile-default"><Icon name="check" size={14} />{selected.isDefault ? 'Default' : 'Set default'}</button></div>
            <div className="profile-action-row profile-destructive-action"><div><strong>Delete profile</strong><p>{selected.isDefault ? 'Choose another default profile before deleting this one.' : 'Remove this profile from the workspace. Confirmation is required.'}</p></div><button className="text-danger-button" type="button" onClick={() => selected.isDefault ? notify('Choose another default before deleting this profile') : setDeleteOpen(true)} disabled={missingDraft || draft.id !== selected.id} data-testid="profile-delete"><Icon name="delete" size={14} />Delete</button></div>
          </section>
          </div>
          <footer className="sticky-save profile-save-footer" ref={footerRef}>
            <div className="profile-save-feedback"><p role="status" aria-live="polite" data-testid="profile-save-status">{readOnly ? 'Read-only profile' : saving ? 'Saving profile…' : dirty ? 'Unsaved changes' : saved ? 'Profile saved' : 'No unsaved changes'}</p>{nameError && <p id="profile-name-error" role="alert">{nameError}</p>}{policyError && <p role="alert">Fix the permission JSON before saving.</p>}{saveError && <p role="alert" className="profile-save-error">Could not save: {saveError}. Your edits are kept; try again.</p>}</div>
            <div className="profile-save-buttons"><button className="secondary-button" type="button" onClick={() => resetDraft(selected)} disabled={!dirty} data-testid="profile-cancel">Cancel changes</button><button className="primary-button" type="submit" disabled={!!nameError || !!policyError || missingDraft || draft.id !== selected.id} data-testid="profile-save">{saving ? 'Saving…' : 'Save profile'}</button></div>
          </footer>
        </form>
        </div>
      </fieldset>
      <FocusDialog open={!!pendingNavigation} onClose={() => setPendingNavigation(null)} title="Discard unsaved changes?" description={`Your edits to ${draft.label || 'this profile'} have not been saved.`} testId="profile-unsaved-dialog"><div className="dialog-actions"><button className="primary-button" type="button" data-autofocus onClick={() => setPendingNavigation(null)} data-testid="profile-keep-editing">Keep editing</button><button className="secondary-button" type="button" onClick={() => { if (pendingNavigation) performNavigation(pendingNavigation); }} data-testid="profile-discard">Discard changes</button></div></FocusDialog>
      <FocusDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete profile?" description={`${selected.label} will be removed from this workspace.`} testId="delete-profile-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setDeleteOpen(false)}>Keep profile</button><button className="danger-button" type="button" disabled={saving || readOnly || selected.isDefault} onClick={() => { if (savingRef.current || readOnly || selected.isDefault) return; const fallback = profiles.find((profile) => profile.id !== selected.id)?.id || ''; savingRef.current = true; setSaving(true); setSaveError(''); void deleteProfile(draft.id).then(() => { setSelectedId(fallback); resetDraft(profiles.find(profile => profile.id === fallback) ?? emptyLiveProfile()); setDeleteOpen(false); }).catch(error => setSaveError(error instanceof Error ? error.message : 'Profile deletion failed')).finally(() => { savingRef.current = false; setSaving(false); }); }} data-testid="confirm-profile-delete">Delete profile</button></div>{saveError && <p role="alert">{saveError}</p>}</FocusDialog>
    </section>
  );
}
