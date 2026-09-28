import { useEffect, useMemo, useRef, useState } from 'react';
import { applyStructuredEdit, editMcpGroup, isAction, isRecord, mcpGroupSelection, parseMcpSelection, parsePolicy, parseSkillSelection, permissionDefault, serializePolicy } from './profilePolicy';
import type { PermissionAction, StructuredEdit } from './profilePolicy';
import './Profiles.css';
import { useGateway } from '../gateway/context';
import type { McpServer } from '../gateway/mcp';
import type { SkillEntry } from '../gateway/skills';
import { Icon } from '../icons';
import { emptyLiveProfile, useFixtures } from '../store';
import { accountOptionLabel, type IdentityProfile } from '../gateway/sessions';
import type { Profile } from '../types';
import { FocusDialog } from './FocusDialog';
import { ColumnBrowser, ColumnChecklist, groupRowsBy, type BrowserColumn, type ChecklistRow } from './ColumnBrowser';
import { useSelectedId } from './ListInspector';
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
type SkillPolicyMode = 'all' | 'selected' | 'none';
type SkillEditor = { mode: 'create' } | { mode: 'edit'; skill: SkillEntry };
const skillModeFor = (raw: string | null | undefined): SkillPolicyMode => {
  const parsed = parseSkillSelection(raw);
  return parsed.inherited ? 'all' : parsed.selected.length ? 'selected' : 'none';
};
const stableNames = (names: string[]) => [...new Set(names)].sort((a, b) => a.localeCompare(b));
const skillSlugPattern = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export function Profiles() {
  const { profiles, models, accounts, openaiAccounts, catalogError, refreshCatalog, createProfile, updateProfile, duplicateProfile, deleteProfile, setDefaultProfile, notify, sessionGatewayMode } = useFixtures();
  const live = sessionGatewayMode === 'live';
  // The account/model pickers below (defaultAnthropicAccountId, defaultOpenaiAccountId, model)
  // read the shared store catalog — force it fresh whenever this provider-picking view opens.
  useEffect(() => { if (live) void refreshCatalog({ force: true }); }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  const gateway = useGateway();
  const [mcpCatalog, setMcpCatalog] = useState<McpServer[]>([]);
  const [mcpCatalogError, setMcpCatalogError] = useState<string | null>(null);
  const [skillCatalog, setSkillCatalog] = useState<SkillEntry[]>([]);
  const [skillCatalogError, setSkillCatalogError] = useState<string | null>(null);
  const skillCatalogRequest = useRef(0);
  const loadMcpCatalog = () => {
    setMcpCatalogError(null);
    gateway.domains.mcp!.list().then(setMcpCatalog).catch((err) => setMcpCatalogError(err instanceof Error ? err.message : 'MCP catalog failed to load'));
  };
  const loadSkillCatalog = async () => {
    const request = ++skillCatalogRequest.current;
    setSkillCatalogError(null);
    try {
      const skills = await gateway.domains.skills!.list();
      if (request === skillCatalogRequest.current) setSkillCatalog(skills);
    } catch (err) {
      if (request === skillCatalogRequest.current) setSkillCatalogError(err instanceof Error ? err.message : 'Skill catalog failed to load');
    }
  };
  // Fired independently (not Promise.all): one catalog failing must never blank the other's
  // already-fetched rows.
  useEffect(() => { if (live) loadMcpCatalog(); }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (live) loadSkillCatalog(); }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  const requestedProfileId = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('profile');
  const [selectedId, setSelectedId] = useState(profiles.find((profile) => profile.id === requestedProfileId)?.id || profiles.find((profile) => profile.isDefault)?.id || profiles[0]?.id || '');
  const appliedProfileParam = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState(''); const [sort, setSort] = useState('name'); const [renaming, setRenaming] = useState(false); const [deleteOpen, setDeleteOpen] = useState(false);
  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0] ?? emptyLiveProfile();
  const [draft, setDraft] = useState<IdentityProfile>(structuredClone(selected));
  const [skillMode, setSkillMode] = useState<SkillPolicyMode>(() => skillModeFor(selected.allowedSkillsJson));
  const skillModeRef = useRef(skillMode); skillModeRef.current = skillMode;
  const [skillFilter, setSkillFilter] = useState('');
  const [skillEditor, setSkillEditor] = useState<SkillEditor | null>(null);
  const [skillEditorName, setSkillEditorName] = useState('');
  const [skillEditorDescription, setSkillEditorDescription] = useState('');
  const [skillEditorContent, setSkillEditorContent] = useState('');
  const [skillDelete, setSkillDelete] = useState<SkillEntry | null>(null);
  const [skillMutation, setSkillMutation] = useState(false);
  const [skillStatus, setSkillStatus] = useState('');
  const [skillActionError, setSkillActionError] = useState('');
  const skillDialogRequest = useRef(0);
  const [baseline, setBaseline] = useState(draftSignature(selected));
  const dirty = draftSignature(draft) !== baseline;
  const [pendingNavigation, setPendingNavigation] = useState<ProfileNavigation | null>(null);
  const [capabilityFilter, setCapabilityFilter] = useState('');
  const [delegateFilter, setDelegateFilter] = useState('');
  // Explicit "Selected tools" choice while the saved MCP map is still empty.
  const [mcpSelectedPick, setMcpSelectedPick] = useState(false);
  const [groupParam, setGroupParam] = useSelectedId('profileSection');
  const requestedState = live ? 'ready' : new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('state') ?? 'ready';
  const supportedStates = ['ready', 'loading', 'empty', 'first-use', 'no-results', 'failure', 'forbidden', 'read-only', 'unavailable'];
  const [fixtureState, setFixtureState] = useState(supportedStates.includes(requestedState) ? requestedState : 'ready');
  const readOnly = fixtureState === 'read-only';
  const retryTimer = useRef<number | undefined>(undefined);
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
    skillDialogRequest.current++; setSkillEditor(null); setSkillDelete(null); setSkillMutation(false); setSkillActionError(''); setSkillStatus('');
    setDraft(structuredClone(profile)); setSkillMode(skillModeFor(profile.allowedSkillsJson)); setBaseline(draftSignature(profile)); setRenaming(false); setSaveError(''); setSaved(false); setCapabilityFilter(''); setSkillFilter(''); setDelegateFilter(''); setMcpSelectedPick(false);
  };
  useEffect(() => {
    if (!requestedProfileId || appliedProfileParam.current === requestedProfileId || dirty || saving) return;
    const requested = profiles.find((profile) => profile.id === requestedProfileId);
    if (!requested) return;
    appliedProfileParam.current = requestedProfileId;
    setSelectedId(requested.id);
    resetDraft(requested);
  }, [requestedProfileId, profiles, dirty, saving]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const editorDisabled = readOnly || !selected.id || saving;
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
  const mcpPolicy = parseMcpSelection(draft.allowedMcpsJson);
  const skillPolicy = parseSkillSelection(draft.allowedSkillsJson);
  const skillSelections = skillPolicy.inherited ? stableNames(skillCatalog.map(skill => skill.name)) : stableNames(skillPolicy.selected);
  // Chain edits so a bulk change across servers applies every group, not just the last.
  const setMcpGroups = (edits: [string, string[]][]) => {
    if (!edits.length) return;
    try {
      let raw = draft.allowedMcpsJson ?? null;
      for (const [server, tools] of edits) raw = editMcpGroup(parseMcpSelection(raw), server, tools, mcpCatalog);
      setMcpSelectedPick(true); set('allowedMcpsJson', raw);
    } catch (error) { setSaveError((error as Error).message); }
  };
  // null = unrestricted, [] = deny-all (api_server migrations.ts profile scope notes).
  const mcpEmpty = mcpPolicy.map !== null && !mcpPolicy.error && Object.keys(mcpPolicy.map).length === 0;
  const mcpMode: SkillPolicyMode = mcpPolicy.map === null ? 'all' : mcpEmpty && !mcpSelectedPick ? 'none' : 'selected';
  const setMcpMode = (mode: SkillPolicyMode) => {
    setMcpSelectedPick(mode === 'selected');
    if (mode === 'all') set('allowedMcpsJson', null);
    else if (mode === 'none') set('allowedMcpsJson', '[]');
    else if (mcpPolicy.map === null) set('allowedMcpsJson', JSON.stringify(Object.fromEntries(mcpCatalog.filter(server => server.tools.length).map(server => [server.name, server.tools]))));
  };
  const setSkillGroup = (names: string[], groupNames: string[]) => set('allowedSkillsJson', JSON.stringify(stableNames([...skillSelections.filter(name => !groupNames.includes(name)), ...names])));
  const availableMcpGroups = live ? [...new Set([...mcpCatalog.map(server => server.name), ...Object.keys(mcpPolicy.map ?? {})])] : [];
  const unavailableSkills = skillSelections.filter(name => !skillCatalog.some(skill => skill.name === name));
  const setSkillPolicyMode = (mode: SkillPolicyMode) => {
    setSkillMode(mode);
    if (mode === 'all') set('allowedSkillsJson', null);
    else if (mode === 'none') set('allowedSkillsJson', '[]');
    else if (skillMode === 'all') set('allowedSkillsJson', JSON.stringify(stableNames([...skillCatalog.map(skill => skill.name), ...skillPolicy.selected])));
    else set('allowedSkillsJson', JSON.stringify(stableNames(skillPolicy.selected)));
  };
  const openCreateSkill = () => {
    skillDialogRequest.current++; setSkillEditor({ mode: 'create' }); setSkillEditorName(''); setSkillEditorDescription(''); setSkillEditorContent(''); setSkillActionError('');
  };
  const openEditSkill = async (name: string) => {
    const skill = skillCatalog.find(item => item.name === name);
    if (!skill?.managed || skillMutation) return;
    const request = ++skillDialogRequest.current; const profileId = draft.id;
    setSkillMutation(true); setSkillActionError(''); setSkillStatus(`Loading ${name}…`);
    try {
      const result = await gateway.domains.skills!.content(name);
      if (request !== skillDialogRequest.current || profileId !== draft.id) return;
      setSkillEditor({ mode: 'edit', skill }); setSkillEditorName(name); setSkillEditorDescription(skill.description ?? ''); setSkillEditorContent(result.content); setSkillStatus('');
    } catch (err) {
      if (request === skillDialogRequest.current) { setSkillActionError(err instanceof Error ? err.message : 'Skill content could not be loaded'); setSkillStatus(''); }
    } finally { if (request === skillDialogRequest.current) setSkillMutation(false); }
  };
  const submitSkill = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!skillEditor || skillMutation) return;
    const request = ++skillDialogRequest.current; const profileId = draft.id; const editing = skillEditor;
    const name = skillEditorName.trim(); const description = skillEditorDescription.trim() || undefined; const content = skillEditorContent;
    setSkillMutation(true); setSkillActionError('');
    try {
      const savedSkill = editing.mode === 'create'
        ? await gateway.domains.skills!.create({ name, description, content })
        : await gateway.domains.skills!.update(editing.skill.name, { description, content });
      if (request !== skillDialogRequest.current || profileId !== draft.id) return;
      if (editing.mode === 'create' && skillModeRef.current === 'selected') {
        setDraft(current => current.id === profileId ? { ...current, allowedSkillsJson: JSON.stringify(stableNames([...parseSkillSelection(current.allowedSkillsJson).selected, savedSkill.name])) } : current);
        setSaved(false);
      }
      setSkillEditor(null); setSkillStatus(`${savedSkill.name} ${editing.mode === 'create' ? 'created' : 'updated'}. Profile access was not saved.`);
      await loadSkillCatalog();
    } catch (err) {
      if (request === skillDialogRequest.current) setSkillActionError(err instanceof Error ? err.message : 'Skill could not be saved');
    } finally { if (request === skillDialogRequest.current) setSkillMutation(false); }
  };
  const deleteSkill = async () => {
    if (!skillDelete || skillMutation) return;
    const target = skillDelete; const request = ++skillDialogRequest.current; const profileId = draft.id;
    setSkillMutation(true); setSkillActionError('');
    try {
      await gateway.domains.skills!.remove(target.name);
      if (request !== skillDialogRequest.current || profileId !== draft.id) return;
      setDraft(current => {
        if (current.id !== profileId || current.allowedSkillsJson === null) return current;
        return { ...current, allowedSkillsJson: JSON.stringify(stableNames(parseSkillSelection(current.allowedSkillsJson).selected.filter(name => name !== target.name))) };
      });
      setSaved(false); setSkillDelete(null); setSkillStatus(`${target.name} deleted globally. Other profiles were not changed.`);
      await loadSkillCatalog();
    } catch (err) {
      if (request === skillDialogRequest.current) setSkillActionError(err instanceof Error ? err.message : 'Skill could not be deleted');
    } finally { if (request === skillDialogRequest.current) setSkillMutation(false); }
  };
  const skillQuery = skillFilter.trim().toLowerCase();
  const allSkillChoices = [...skillCatalog.map(skill => skill.name), ...unavailableSkills];
  const shownSkillNames = allSkillChoices.filter(name => {
    const skill = skillCatalog.find(item => item.name === name);
    return `${skill?.source ?? 'saved'} ${name} ${skill?.description ?? ''}`.toLowerCase().includes(skillQuery);
  });
  const skillSummary = skillMode === 'all' ? 'All skills' : skillMode === 'none' ? 'No skills' : `${skillSelections.length} selected`;
  if (fixtureState !== 'ready' && fixtureState !== 'read-only') {
    const waiting = fixtureState === 'loading' || fixtureState === 'retrying';
    const recoverable = ['empty', 'first-use', 'no-results'].includes(fixtureState);
    const retryable = fixtureState === 'failure' || fixtureState === 'unavailable';
    return <section className="profiles-workspace profiles-state-workspace" aria-label="Agent profiles" data-testid="profiles-workspace"><button className="text-button profiles-state-back" type="button" onClick={() => navigate('/agents')}><Icon name="chevronRight" className="rotate-180" size={14} />Back to Agents</button><div className="tool-state-panel" role={fixtureState === 'failure' || fixtureState === 'forbidden' || fixtureState === 'unavailable' ? 'alert' : 'status'} aria-busy={waiting || undefined} data-testid={`tool-state-${fixtureState}`}><Icon name={waiting ? 'refresh' : fixtureState === 'forbidden' ? 'background' : 'profile'} className={waiting ? 'spin' : ''} size={26} /><h1>{waiting ? `${fixtureState === 'retrying' ? 'Retrying' : 'Loading'} Profiles` : fixtureState === 'first-use' ? 'Set up Profiles' : fixtureState === 'no-results' ? 'No matching profiles' : fixtureState === 'empty' ? 'No profiles yet' : fixtureState === 'forbidden' ? 'Access denied' : 'Profiles unavailable'}</h1><p>{fixtureState === 'forbidden' ? 'This workspace cannot manage profile policy.' : retryable ? 'The profile service did not return usable data.' : waiting ? 'Waiting for profile data.' : 'No profiles match this view.'}</p>{recoverable && <button className="secondary-button" type="button" onClick={() => setFixtureState('ready')} data-testid="tool-state-restore">Load profiles</button>}{retryable && <button className="primary-button" type="button" onClick={() => { setFixtureState('retrying'); retryTimer.current = window.setTimeout(() => setFixtureState('ready'), 240); }} data-testid="tool-state-retry">Retry</button>}</div></section>;
  }
  // Column 2 groups; each shows a one-line summary of the draft value.
  const delegateIds = live ? parseNameList(draft.allowedDelegatesJson) : draft.allowedDelegates;
  const delegateChoices = profiles.filter((profile) => profile.id !== selected.id && (!live || profile.enabled && !profile.id.startsWith('profile-created-')));
  const setDelegates = (ids: string[]) => {
    const kept = delegateIds.filter((id) => !delegateChoices.some((profile) => profile.id === id));
    if (live) set('allowedDelegatesJson', JSON.stringify([...kept, ...ids])); else set('allowedDelegates', [...kept, ...ids]);
  };
  const mcpToolTotals = availableMcpGroups.reduce((totals, name) => {
    const server = mcpCatalog.find((item) => item.name === name);
    const group = mcpGroupSelection(mcpPolicy, name, server?.tools ?? []);
    return { selected: totals.selected + group.selected.length, total: totals.total + new Set([...(server?.tools ?? []), ...group.selected]).size };
  }, { selected: 0, total: 0 });
  const mcpSummary = !live ? `${draft.mcps.length} MCPs · ${draft.skills.length} skills` : mcpPolicy.error ? 'Advanced policy' : mcpMode === 'all' ? 'All MCPs' : mcpMode === 'none' ? 'No MCPs' : `Selected · ${mcpToolTotals.selected} of ${mcpToolTotals.total} tools`;
  let permissionSummary = 'Inherited';
  try { const value = parsePolicy(policyRaw).value; if (value) permissionSummary = `${Object.keys(value).length} rule${Object.keys(value).length === 1 ? '' : 's'}`; } catch { permissionSummary = 'Invalid JSON'; }
  const groups = [
    { id: 'identity', title: 'Identity & instructions', subtitle: draft.systemPrompt.trim() ? `${draft.systemPrompt.trim().length} character prompt` : 'No instructions' },
    { id: 'model', title: 'Provider, model & account', subtitle: `${draft.modelProvider ?? 'Any provider'} · ${draft.modelId ?? 'any model'}` },
    { id: 'delegation', title: 'Delegation', subtitle: `${(live ? draft.isManager : draft.managerAgent) ? 'Manager · ' : ''}${delegateIds.length} delegation target${delegateIds.length === 1 ? '' : 's'}` },
    { id: 'availability', title: 'Availability & defaults', subtitle: `${draft.enabled ? 'Enabled' : 'Disabled'} · ${draft.selectable ? 'Selectable' : 'Hidden'}` },
    ...(live ? [{ id: 'skills', title: 'Allowed skills', subtitle: skillMode === 'all' ? 'All skills' : skillMode === 'none' ? 'No skills' : `Selected · ${skillSelections.length} of ${new Set(allSkillChoices).size}` }] : []),
    { id: 'capabilities', title: 'MCPs', subtitle: mcpSummary },
    { id: 'permissions', title: 'Permissions', subtitle: permissionSummary },
    { id: 'actions', title: 'Actions', subtitle: selected.isDefault ? 'Default profile' : 'Duplicate, default, delete' },
  ];
  const groupId = groups.some((group) => group.id === groupParam) ? groupParam! : 'identity';
  const group = groups.find((entry) => entry.id === groupId)!;
  const controls = (content: React.ReactNode) => <fieldset className="profile-editor-controls" disabled={editorDisabled}>{content}</fieldset>;
  const skillDeleteRequest = (name: string) => { const skill = skillCatalog.find(item => item.name === name); if (skill?.managed) { skillDialogRequest.current++; setSkillDelete(skill); setSkillActionError(''); } };
  const skillActions = (skill: SkillEntry) => skill.managed ? <>
    <button className="icon-button small" type="button" aria-label={`Edit skill ${skill.name}`} disabled={!!skillPolicy.error || skillMutation} onClick={() => void openEditSkill(skill.name)}><Icon name="rename" size={13} /></button>
    <button className="icon-button small danger" type="button" aria-label={`Delete skill ${skill.name}`} disabled={!!skillPolicy.error || skillMutation} onClick={() => skillDeleteRequest(skill.name)}><Icon name="delete" size={13} /></button>
  </> : undefined;
  const skillRows: ChecklistRow[] = [
    ...skillCatalog.map((skill) => ({ name: skill.name, description: skill.description, checked: skillSelections.includes(skill.name), testId: `skill-${skill.name}`, actions: skillActions(skill), keywords: [skill.source, ...skill.tags ?? []].join(' ') })),
    ...unavailableSkills.map((name) => ({ name, description: 'Not in the current catalog; saved selection retained.', checked: true, testId: `skill-${name}`, keywords: 'saved' })),
  ];

  const inspector = (): React.ReactNode => {
    switch (groupId) {
      case 'identity': return <><p className="profile-group-note">How this profile appears and guides each session.</p><div className="form-grid"><label className="field">{!looksLikeAssetPath(draft.icon) && draft.icon.length <= 3 ? 'Icon label' : 'Icon value'}<input value={draft.icon} maxLength={!looksLikeAssetPath(draft.icon) && draft.icon.length <= 3 ? 3 : undefined} onChange={(event) => set('icon', !looksLikeAssetPath(draft.icon) && draft.icon.length <= 3 ? event.target.value.toUpperCase() : event.target.value)} data-testid="profile-icon" /></label><label className="field">Profile label<input required aria-invalid={!!nameError} aria-describedby={nameError ? "profile-name-error" : undefined} value={draft.label} onChange={(event) => set('label', event.target.value)} data-testid="profile-label" /></label><label className="field span-2">System prompt<textarea rows={10} value={draft.systemPrompt} onChange={(event) => set('systemPrompt', event.target.value)} data-testid="profile-system-prompt" /></label></div></>;
      case 'model': return <><p className="profile-group-note">Defaults used when a session begins with this profile.</p><div className="form-grid">
        <label className="field">Provider<select value={draft.modelProvider ?? ''} onChange={(event) => { set('modelProvider', event.target.value || null); set('modelId', null); }} data-testid="profile-provider"><option value="">No preference</option>{live ? <>{draft.modelProvider && !models.some(m => m.providerId === draft.modelProvider) && <option value={draft.modelProvider} disabled>{draft.modelProvider} (unavailable)</option>}{[...new Set(models.map(m => m.providerId))].map(id => <option key={id} value={id}>{id}</option>)}</> : <><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="local">Local provider</option></>}</select></label>
        <label className="field">Model<select value={draft.modelId ?? ''} onChange={(event) => set('modelId', event.target.value || null)} data-testid="profile-model"><option value="">No preference</option>{live ? <>{draft.modelId && !models.some(m => m.providerId === draft.modelProvider && m.modelId === draft.modelId) && <option value={draft.modelId} disabled>{draft.modelId} (unavailable)</option>}{models.filter(m => m.providerId === draft.modelProvider).map(m => <option key={m.modelId} value={m.modelId}>{m.label}</option>)}</> : <><option value="gpt-5.6">gpt-5.6</option><option value="gpt-5.6-codex">gpt-5.6-codex</option><option value="claude-sonnet-4">claude-sonnet-4</option><option value="claude-sonnet-4-6">claude-sonnet-4-6</option></>}</select></label>
        <label className="field span-2">{live ? 'Default Anthropic account' : 'Default account'}{live ? <select value={draft.defaultAnthropicAccountId ?? ''} onChange={(event) => set('defaultAnthropicAccountId', event.target.value || null)} data-testid="profile-account"><option value="">No default</option>{draft.defaultAnthropicAccountId && !accounts.some(a => a.id === draft.defaultAnthropicAccountId) && <option value={draft.defaultAnthropicAccountId} disabled>{draft.defaultAnthropicAccountId} (unavailable)</option>}{accounts.map(a => <option key={a.id} value={a.id} disabled={!!a.status && a.status !== 'ok'}>{accountOptionLabel(a)}</option>)}</select> : <select value={draft.defaultAccount} onChange={(event) => set('defaultAccount', event.target.value)} data-testid="profile-account"><option>Rhythm workspace</option><option>Research account</option><option>Local account</option></select>}</label>
        {live && <label className="field span-2">Default OpenAI account<select value={draft.defaultOpenaiAccountId ?? ''} onChange={(event) => set('defaultOpenaiAccountId', event.target.value || null)} data-testid="profile-openai-account"><option value="">Use the global default</option>{draft.defaultOpenaiAccountId && !openaiAccounts.some(a => a.id === draft.defaultOpenaiAccountId) && <option value={draft.defaultOpenaiAccountId} disabled>{draft.defaultOpenaiAccountId} (unavailable)</option>}{openaiAccounts.map(a => <option key={a.id} value={a.id} disabled={!!a.status && a.status !== 'ok'}>{accountOptionLabel(a)}</option>)}</select></label>}
      </div></>;
      case 'delegation': return <><p className="profile-group-note">Let this profile coordinate work and choose which profiles it may delegate to.</p><label className="switch-label"><input type="checkbox" checked={live ? draft.isManager === true : draft.managerAgent} onChange={(event) => set(live ? 'isManager' : 'managerAgent', event.target.checked)} data-testid="profile-manager" /><span />Manager agent</label><p className="profile-group-summary" data-testid="profile-delegation-summary">{delegateIds.length} of {delegateChoices.length} profiles allowed as delegation targets</p></>;
      case 'availability': return <><p className="profile-group-note">Enabled profiles can run. Session-selectable profiles appear in the session picker. Choose a default in Actions.</p><div className="switch-row"><label className="switch-label"><input type="checkbox" checked={draft.selectable} onChange={(event) => set('selectable', event.target.checked)} data-testid="profile-selectable" /><span />Session-selectable</label><label className="switch-label"><input type="checkbox" checked={draft.enabled} onChange={(event) => set('enabled', event.target.checked)} data-testid="profile-enabled" /><span />Enabled</label>{!live && <label className="switch-label"><input type="checkbox" checked={draft.managedSkills} onChange={(event) => set('managedSkills', event.target.checked)} data-testid="profile-managed-skills" /><span />Managed skills</label>}</div></>;
      case 'skills': return <section className="profile-skills-section" aria-labelledby="profile-skills-title"><h3 id="profile-skills-title" className="sr-only">Allowed skills</h3><p className="profile-group-note">Choose profile access here. Creating, editing, or deleting a managed skill changes the global Rhythm catalog; it does not save this profile.</p>
        <div className="profile-section-actions"><button className="secondary-button" type="button" onClick={() => void loadSkillCatalog()} disabled={skillMutation} aria-label="Refresh skill catalog"><Icon name="refresh" size={14} />Refresh</button><button className="primary-button" type="button" onClick={openCreateSkill} disabled={skillMutation}><Icon name="plus" size={14} />Add skill</button></div>
        <fieldset className="profile-skill-policy" role="radiogroup" aria-labelledby="profile-skills-title" disabled={!!skillPolicy.error}><legend className="sr-only">Allowed skills</legend>
          <label><input type="radio" name="skill-policy" checked={skillMode === 'all'} onChange={() => setSkillPolicyMode('all')} /><span><strong>All skills</strong><small>Inherit the current catalog and automatically allow future skills.</small></span></label>
          <label><input type="radio" name="skill-policy" checked={skillMode === 'selected'} onChange={() => setSkillPolicyMode('selected')} /><span><strong>Selected skills</strong><small>Allow only the explicit list. Future skills are not added.</small></span></label>
          <label><input type="radio" name="skill-policy" checked={skillMode === 'none'} onChange={() => setSkillPolicyMode('none')} /><span><strong>No skills</strong><small>Deny all skill access with an explicit empty list.</small></span></label>
        </fieldset>
        <p className="profile-group-summary"><strong data-testid="profile-skills-summary">{skillSummary}</strong>{skillMode === 'selected' && <span> of {new Set(allSkillChoices).size} in the catalog</span>}</p>
        {skillPolicy.error && <p role="alert" className="profile-feedback error">{skillPolicy.error}</p>}
        {skillCatalogError && <p role="alert" className="profile-feedback error">{skillCatalogError}. Existing policy and saved choices are unchanged.</p>}
        {skillActionError && !skillEditor && !skillDelete && <p role="alert" className="profile-feedback error">{skillActionError}. Your editor and profile draft are unchanged.</p>}
        <p className="profile-skill-status" role="status" aria-live="polite">{skillStatus}</p>
      </section>;
      case 'capabilities': return <section aria-labelledby="profile-capabilities-title"><h3 id="profile-capabilities-title" className="sr-only">MCPs</h3><p className="profile-group-note">{live ? 'Choose tools from each MCP server.' : 'Preview MCP servers and skills. Fixture choices do not change live access.'}</p>
        <div className="profile-section-actions"><button className="secondary-button" type="button" onClick={() => { if (live) loadMcpCatalog(); else notify('MCP servers and skills refreshed'); }} data-testid="profile-resync"><Icon name="refresh" size={14} />Refresh MCPs</button></div>
        {live && <>
          <fieldset className="profile-skill-policy" role="radiogroup" aria-labelledby="profile-capabilities-title" disabled={!!mcpPolicy.error}><legend className="sr-only">MCP access</legend>
            <label><input type="radio" name="mcp-policy" checked={mcpMode === 'all'} onChange={() => setMcpMode('all')} data-testid="profile-mcp-mode-all" /><span><strong>All MCPs</strong><small>Unrestricted: every server and tool, including servers added later.</small></span></label>
            <label><input type="radio" name="mcp-policy" checked={mcpMode === 'selected'} onChange={() => setMcpMode('selected')} data-testid="profile-mcp-mode-selected" /><span><strong>Selected tools</strong><small>Only the tools checked in the list.</small></span></label>
            <label><input type="radio" name="mcp-policy" checked={mcpMode === 'none'} onChange={() => setMcpMode('none')} data-testid="profile-mcp-mode-none" /><span><strong>No MCPs</strong><small>Deny all MCP tools with an explicit empty list.</small></span></label>
          </fieldset>
          <p className="profile-group-summary" data-testid="profile-mcp-summary">{mcpSummary}</p>
          <p className="profile-policy-note">Inherited means this profile does not narrow that selection. Other engine rules still apply. Editing inherited access creates an explicit selection of the listed choices; future catalog additions are excluded.</p>
          {mcpCatalogError && <p role="alert">{mcpCatalogError} Use Refresh MCPs to retry.</p>}
          {mcpPolicy.error && <p role="alert">{mcpPolicy.error}</p>}
        </>}
      </section>;
      case 'permissions': return <><p className="profile-group-note">Set the approval rules for core tools. Unchanged rules keep their existing behavior.</p>
        <PermissionsEditor key={draft.id} raw={policyRaw} onChange={value => {
          set('corePermissionsJson', value);
          if (!live) { try { const parsed = parsePolicy(value).value; set('permissionRules', Object.fromEntries(Object.entries(parsed ?? {}).filter(([, rule]) => isAction(rule))) as IdentityProfile['permissionRules']); } catch { /* Keep invalid draft for correction. */ } }
        }} />
        {live && <label className="check-label"><input type="checkbox" checked={draft.autoApproveActions === true} onChange={event => set('autoApproveActions', event.target.checked)} data-testid="profile-auto-approve" />Auto-approve protected actions</label>}</>;
      default: return <div className="profile-actions"><p className="profile-group-note">These actions take effect immediately. Save your edits first to include them in a duplicate.</p>
        <div className="profile-action-row"><div><strong>Duplicate profile</strong><p>Create a copy of the saved profile{live ? ', then save it to create it on the server' : ''}.</p></div><button className="secondary-button" type="button" onClick={() => requestNavigation({ kind: 'duplicate' })} disabled={missingDraft || draft.id !== selected.id} data-testid="profile-duplicate"><Icon name="copy" size={14} />Duplicate</button></div>
        <div className="profile-action-row"><div><strong>Default profile</strong><p>{live ? 'Local to this account; resets on reload. Save and enable the profile before choosing it.' : 'Use this profile when starting a new session.'}</p></div><button className="secondary-button" type="button" onClick={() => setDefaultProfile(draft.id)} disabled={missingDraft || draft.id !== selected.id || selected.isDefault || live && (!selected.enabled || !selected.selectable || selected.id.startsWith('profile-created-'))} title={selected.isDefault ? 'Already the default profile' : undefined} data-testid="profile-default"><Icon name="check" size={14} />{selected.isDefault ? 'Default' : 'Set default'}</button></div>
        <div className="profile-action-row profile-destructive-action"><div><strong>Delete profile</strong><p>{selected.isDefault ? 'Choose another default profile before deleting this one.' : 'Remove this profile from the workspace. Confirmation is required.'}</p></div><button className="text-danger-button" type="button" onClick={() => selected.isDefault ? notify('Choose another default before deleting this profile') : setDeleteOpen(true)} disabled={missingDraft || draft.id !== selected.id} data-testid="profile-delete"><Icon name="delete" size={14} />Delete</button></div>
      </div>;
    }
  };

  // Column 4: the long checklists (skills, MCP tools, delegation targets).
  const listColumn = (): BrowserColumn | null => {
    const column = (label: string, content: React.ReactNode): BrowserColumn => ({ kind: 'panel', key: 'list', label, testId: 'settings-column-list', children: controls(content) });
    if (groupId === 'delegation') return column('Delegation targets', <ColumnChecklist noun="delegation targets" filter={delegateFilter} onFilterChange={setDelegateFilter} filterLabel="Filter profiles" filterTestId="profile-delegate-filter"
      groups={[{ id: 'delegates', rows: delegateChoices.map((profile) => ({ name: profile.id, label: profile.label, description: profile.model, checked: delegateIds.includes(profile.id), testId: `delegate-${profile.id}` })), onChange: setDelegates, emptyText: 'No other profiles can receive delegated work.' }]}
      onSelectAll={(shown) => setDelegates([...new Set([...delegateIds.filter((id) => delegateChoices.some((profile) => profile.id === id)), ...shown])])}
      onClear={(shown) => setDelegates(delegateIds.filter((id) => delegateChoices.some((profile) => profile.id === id) && !shown.includes(id)))} />);
    if (groupId === 'skills' && live && skillMode === 'selected') return column('Skills', <div data-testid="profile-skill-catalog"><ColumnChecklist noun="skills" filter={skillFilter} onFilterChange={setSkillFilter} filterLabel="Filter skills" filterPlaceholder="Name, description, or source" filterTestId="profile-capability-filter" disabled={!!skillPolicy.error || skillMutation}
      groups={[{ id: 'all', rows: skillRows, onChange: (names: string[]) => setSkillGroup(names, allSkillChoices) }]}
      groupings={[
        { id: 'source', label: 'source', groups: groupRowsBy(skillRows, (row) => [skillCatalog.find((skill) => skill.name === row.name)?.source ?? 'saved'], 'saved', setSkillGroup) },
        // ponytail: the catalog API has no tags yet; this option appears once SkillEntry.tags does.
        ...(skillCatalog.some((skill) => skill.tags?.length) ? [{ id: 'tag', label: 'tag', groups: groupRowsBy(skillRows, (row) => skillCatalog.find((skill) => skill.name === row.name)?.tags ?? [], 'No tag', setSkillGroup) }] : []),
      ]}
      onSelectAll={(shown) => set('allowedSkillsJson', JSON.stringify(stableNames([...skillSelections, ...shown])))}
      onClear={(shown) => set('allowedSkillsJson', JSON.stringify(skillSelections.filter((name) => !shown.includes(name))))}
      empty={!skillCatalogError && <p>No skills found.</p>} /></div>);
    if (groupId !== 'capabilities') return null;
    if (!live) return column('MCPs list', <ColumnChecklist noun="MCPs and skills" filter={capabilityFilter} onFilterChange={setCapabilityFilter} filterLabel="Filter tools and skills" filterPlaceholder="Server, tool, skill, or source" filterTestId="profile-capability-filter"
      groups={[
        { id: 'mcp', label: 'Workspace MCP servers', meta: <span className="profile-policy-source">Explicit</span>, rows: ['GitNexus', 'Open Design', 'Web research'].map((name) => ({ name, checked: draft.mcps.includes(name), testId: `mcp-${name.toLowerCase().replace(' ', '-')}` })), onChange: (names: string[]) => set('mcps', names) },
        { id: 'skills', label: 'Workspace skills', meta: <span className="profile-policy-source">Explicit</span>, rows: ['planning', 'verification', 'frontend', 'tests', 'research', 'citations'].map((name) => ({ name, checked: draft.skills.includes(name), testId: `skill-${name}` })), onChange: (names: string[]) => set('skills', names) },
      ]} />);
    return column('MCPs', <div data-testid="profile-capability-catalog"><ColumnChecklist noun="MCP tools" filter={capabilityFilter} onFilterChange={setCapabilityFilter} filterLabel="Filter tools" filterPlaceholder="Server or tool" filterTestId="profile-mcp-filter" sortGroups defaultCollapsed disabled={!!mcpPolicy.error || !!mcpCatalogError}
      groups={availableMcpGroups.map((name) => {
        const server = mcpCatalog.find((item) => item.name === name);
        const selection = mcpGroupSelection(mcpPolicy, name, server?.tools ?? []);
        const names = [...new Set([...(server?.tools ?? []), ...selection.selected])];
        return { id: name, label: name, meta: <span className="profile-policy-source">{selection.error ? 'Advanced' : selection.inherited ? 'Inherited' : 'Explicit'}</span>, error: selection.error, disabled: !server || !!selection.error, emptyText: 'No tools are listed for this server.',
          rows: names.map((tool) => ({ name: tool, description: server?.tools.includes(tool) ? undefined : 'Not in the current catalog; saved selection retained.', checked: selection.selected.includes(tool), testId: `mcp-${name}-${tool}` })),
          onChange: (tools: string[]) => setMcpGroups([[name, tools]]) };
      })}
      onSelectAll={(shown) => setMcpGroups(availableMcpGroups.flatMap((name) => {
        const server = mcpCatalog.find((item) => item.name === name);
        const selection = mcpGroupSelection(mcpPolicy, name, server?.tools ?? []);
        const add = (server?.tools ?? []).filter((tool) => shown.includes(tool));
        return server && !selection.error && add.length ? [[name, [...new Set([...selection.selected, ...add])]] as [string, string[]]] : [];
      }))}
      onClear={(shown) => setMcpGroups(availableMcpGroups.flatMap((name) => {
        const server = mcpCatalog.find((item) => item.name === name);
        const selection = mcpGroupSelection(mcpPolicy, name, server?.tools ?? []);
        return server && !selection.error && selection.selected.some((tool) => shown.includes(tool)) ? [[name, selection.selected.filter((tool) => !shown.includes(tool))] as [string, string[]]] : [];
      }))}
      empty={!mcpCatalogError && <p>No MCP servers configured.</p>} /></div>);
  };

  const columns: BrowserColumn[] = [
    {
      kind: 'list', key: 'profiles', label: 'Profiles', testId: 'settings-column-profiles', resizeKey: 'layout.profiles.rail',
      items: visible.map((profile) => ({ id: profile.id, title: profile.label, subtitle: `${profile.modelProvider ?? 'Configured'} · ${profile.modelId ?? 'Configured model'}`, badge: [profile.isDefault && 'Default', !profile.enabled && 'Disabled'].filter(Boolean).join(' · ') || undefined, testId: `profile-${profile.id}`, leading: <ProfileAvatar profile={profile} size="tiny" />, disabled: saving })),
      selectedId: selectedId || null,
      onSelect: (id) => requestNavigation({ kind: 'select', id }),
      adds: [{ label: 'New profile', testId: 'profile-create', disabled: readOnly || saving, onClick: () => requestNavigation({ kind: 'create' }) }],
      emptyState: search ? 'No matching profiles.' : 'No profiles yet.',
      header: <>
        <button className="icon-button small" type="button" onClick={() => requestNavigation({ kind: 'back' })} disabled={saving} aria-label="Back to Agents" data-testid="profiles-back"><Icon name="chevronRight" className="rotate-180" /></button>
        <div className="profile-list-tools">
          <label className="profile-list-search"><Icon name="search" size={13} /><span className="sr-only">Search profiles</span><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} placeholder="Search profiles" data-testid="profile-search" /></label>
          <label className="profile-list-sort"><span className="sr-only">Sort profiles</span><select value={sort} onChange={(event) => setSort(event.target.value)} data-testid="profile-sort" aria-label="Sort profiles"><option value="name">Name</option><option value="updated">Updated</option><option value="provider">Provider</option></select></label>
        </div>
      </>,
    },
    {
      kind: 'list', key: 'groups', label: 'Profile settings', testId: 'settings-column-groups', items: groups, selectedId: groupId, onSelect: setGroupParam,
      header: <div className="profile-summary-header">
        <div className="profile-title-line"><ProfileAvatar profile={draft} /><h3 id="profile-editor-title">{draft.label || 'Untitled profile'}</h3><button className="icon-button small" type="button" onClick={() => setRenaming(true)} disabled={editorDisabled} aria-label="Rename profile inline" data-testid="profile-rename"><Icon name="rename" size={14} /></button></div>
        {renaming && <div className="profile-inline-rename"><label className="sr-only" htmlFor="inline-profile-name">Profile name</label><input id="inline-profile-name" autoFocus value={draft.label} disabled={editorDisabled} onChange={event => set('label', event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setRenaming(false); } }} data-testid="profile-inline-name" /><button className="icon-button small" type="button" onClick={() => setRenaming(false)} aria-label="Confirm rename" data-testid="profile-inline-confirm"><Icon name="check" size={14} /></button></div>}
        <div className="profile-status-line"><span>{draft.enabled ? 'Enabled' : 'Disabled'}</span><span>{draft.selectable ? 'Session-selectable' : 'Hidden from picker'}</span>{selected.isDefault && <span>Default</span>}{(live ? draft.isManager : draft.managerAgent) && <span>Manager</span>}{live && draft.id.startsWith('profile-created-') && <span>New · not saved yet</span>}</div>
      </div>,
    },
    { kind: 'panel', key: 'inspector', label: group.title, testId: 'settings-column-inspector', bodyTestId: 'profile-inspector', children: controls(<div className="profile-inspector">
      {live && catalogError && <p role="alert" className="profile-feedback error">{catalogError}</p>}
      {missingDraft && dirty && <p role="alert">This profile is no longer available. Your draft has been kept. Cancel to load an available profile.</p>}
      {inspector()}
    </div>) },
  ];
  const list = listColumn();
  if (list) columns.push(list);

  return (
    <section className="profiles-workspace profiles-columns" aria-label="Agent profiles" aria-describedby={fixtureState === 'read-only' ? 'profiles-readonly' : undefined} aria-busy={saving} data-od-id="profiles-workspace" data-testid="profiles-workspace">
      {fixtureState === 'read-only' && <div className="tool-readonly-banner profile-editor-readonly" role="status" id="profiles-readonly" data-testid="tool-state-read-only"><Icon name="background" size={15} /><span><strong>Read-only</strong> · Profiles remain inspectable, but policy changes are disabled.</span></div>}
      {!selected.id && <p role="status">No profiles configured. Create a profile to begin.</p>}
      <form className="profile-columns-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <ColumnBrowser label="Profile editor" columns={columns} className="profile-columns" />
      <footer className="profile-save-footer">
        <div className="profile-save-feedback"><p role="status" aria-live="polite" data-testid="profile-save-status">{readOnly ? 'Read-only profile' : saving ? 'Saving profile…' : dirty ? 'Unsaved changes' : saved ? 'Profile saved' : 'No unsaved changes'}</p>{nameError && <p id="profile-name-error" role="alert">{nameError}</p>}{policyError && <p role="alert">Fix the permission JSON before saving.</p>}{saveError && <p role="alert" className="profile-save-error">Could not save: {saveError}. Your edits are kept; try again.</p>}</div>
        <div className="profile-save-buttons"><button className="secondary-button" type="button" onClick={() => resetDraft(selected)} disabled={editorDisabled || !dirty} data-testid="profile-cancel">Cancel changes</button><button className="primary-button" type="submit" disabled={editorDisabled || !!nameError || !!policyError || missingDraft || draft.id !== selected.id} data-testid="profile-save">{saving ? 'Saving…' : 'Save profile'}</button></div>
      </footer>
      </form>
      <FocusDialog open={!!pendingNavigation} onClose={() => setPendingNavigation(null)} title="Discard unsaved changes?" description={`Your edits to ${draft.label || 'this profile'} have not been saved.`} testId="profile-unsaved-dialog"><div className="dialog-actions"><button className="primary-button" type="button" data-autofocus onClick={() => setPendingNavigation(null)} data-testid="profile-keep-editing">Keep editing</button><button className="secondary-button" type="button" onClick={() => { if (pendingNavigation) performNavigation(pendingNavigation); }} data-testid="profile-discard">Discard changes</button></div></FocusDialog>
      <FocusDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete profile?" description={`${selected.label} will be removed from this workspace.`} testId="delete-profile-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setDeleteOpen(false)}>Keep profile</button><button className="danger-button" type="button" disabled={saving || readOnly || selected.isDefault} onClick={() => { if (savingRef.current || readOnly || selected.isDefault) return; const fallback = profiles.find((profile) => profile.id !== selected.id)?.id || ''; savingRef.current = true; setSaving(true); setSaveError(''); void deleteProfile(draft.id).then(() => { setSelectedId(fallback); resetDraft(profiles.find(profile => profile.id === fallback) ?? emptyLiveProfile()); setDeleteOpen(false); }).catch(error => setSaveError(error instanceof Error ? error.message : 'Profile deletion failed')).finally(() => { savingRef.current = false; setSaving(false); }); }} data-testid="confirm-profile-delete">Delete profile</button></div>{saveError && <p role="alert">{saveError}</p>}</FocusDialog>
      <FocusDialog open={!!skillEditor} onClose={() => { if (!skillMutation) { skillDialogRequest.current++; setSkillEditor(null); setSkillActionError(''); } }} title={skillEditor?.mode === 'edit' ? 'Edit managed skill' : 'Add managed skill'} description="This skill is global to Rhythm. Its allowlist selection is profile-specific and is saved separately." testId="profile-skill-editor" wide dismissible={!skillMutation}>
        <form className="form-grid profile-skill-form" onSubmit={event => void submitSkill(event)}>
          <label className="field">Name<input name="name" value={skillEditorName} onChange={event => setSkillEditorName(event.target.value)} disabled={skillEditor?.mode === 'edit' || skillMutation} required pattern="[a-z0-9]+(?:[-_][a-z0-9]+)*" aria-invalid={skillEditor?.mode === 'create' && !!skillEditorName && !skillSlugPattern.test(skillEditorName) || undefined} aria-describedby="profile-skill-name-help" data-autofocus /></label>
          <label className="field">Description<input name="description" value={skillEditorDescription} onChange={event => setSkillEditorDescription(event.target.value)} disabled={skillMutation} /></label>
          <small id="profile-skill-name-help" className="span-2">Use a unique lower-case slug with letters, numbers, hyphens, or underscores. The name cannot change after creation.</small>
          <label className="field span-2">Skill instructions<textarea name="content" value={skillEditorContent} onChange={event => setSkillEditorContent(event.target.value)} disabled={skillMutation} required rows={10} /></label>
          {skillActionError && <p role="alert" className="profile-feedback error span-2">{skillActionError}. Your editor contents are kept.</p>}
          <footer className="dialog-actions span-2"><button className="secondary-button" type="button" disabled={skillMutation} onClick={() => { skillDialogRequest.current++; setSkillEditor(null); setSkillActionError(''); }}>Cancel</button><button className="primary-button" type="submit" disabled={skillMutation || !skillEditorContent.trim() || skillEditor?.mode === 'create' && (!skillSlugPattern.test(skillEditorName) || skillCatalog.some(skill => skill.name.toLowerCase() === skillEditorName.toLowerCase()))}>{skillMutation ? 'Saving…' : skillEditor?.mode === 'edit' ? 'Save skill' : 'Create skill'}</button></footer>
        </form>
      </FocusDialog>
      <FocusDialog open={!!skillDelete} onClose={() => { if (!skillMutation) { skillDialogRequest.current++; setSkillDelete(null); setSkillActionError(''); } }} title="Delete managed skill" description={skillDelete ? `Delete “${skillDelete.name}” globally from Rhythm? Other profiles may retain stale allowlist names; they are not changed.` : ''} testId="profile-skill-delete" dismissible={!skillMutation}>
        {skillActionError && <p role="alert" className="profile-feedback error">{skillActionError}. The skill and profile selection are unchanged.</p>}
        <div className="dialog-actions"><button className="secondary-button" type="button" disabled={skillMutation} onClick={() => { skillDialogRequest.current++; setSkillDelete(null); setSkillActionError(''); }}>Cancel</button><button className="danger-button" type="button" disabled={skillMutation} onClick={() => void deleteSkill()}>{skillMutation ? 'Deleting…' : 'Delete skill'}</button></div>
      </FocusDialog>
    </section>
  );
}
