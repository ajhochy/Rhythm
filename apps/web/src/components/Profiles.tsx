import { useEffect, useMemo, useRef, useState } from 'react';
import { useGateway } from '../gateway/context';
import type { McpServer } from '../gateway/mcp';
import type { SkillEntry } from '../gateway/skills';
import { Icon } from '../icons';
import { useFixtures } from '../store';
import type { Profile } from '../types';
import { FocusDialog } from './FocusDialog';
import { navigate } from './Shell';

// `allowedMcpsJson` is a server→tool map, `allowedSkillsJson` a flat name array —
// apps/api_server/src/routes/opencode_mcp_routes.ts:78-159 (tools per server) and
// apps/api_server/src/routes/opencode_skills_routes.ts:90-98 (skill name). Parsed
// defensively: a live row always carries these as JSON text, never pre-parsed.
function parseMcpSelectionMap(raw: string | null | undefined): Record<string, string[]> {
  if (!raw) return {};
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string[]> : {}; }
  catch { return {}; }
}
function parseNameList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; }
  catch { return []; }
}

export function Profiles() {
  const { profiles, createProfile, updateProfile, duplicateProfile, deleteProfile, setDefaultProfile, notify, sessionGatewayMode } = useFixtures();
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
  const [selectedId, setSelectedId] = useState(profiles.find((profile) => profile.isDefault)?.id || profiles[0].id);
  const [search, setSearch] = useState(''); const [sort, setSort] = useState('name'); const [renaming, setRenaming] = useState(false); const [deleteOpen, setDeleteOpen] = useState(false);
  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0];
  const [draft, setDraft] = useState<Profile>(structuredClone(selected));
  const requestedState = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('state') ?? 'ready';
  const supportedStates = ['ready', 'loading', 'empty', 'first-use', 'no-results', 'failure', 'forbidden', 'read-only', 'unavailable'];
  const [fixtureState, setFixtureState] = useState(supportedStates.includes(requestedState) ? requestedState : 'ready');
  const retryTimer = useRef<number | undefined>(undefined);
  useEffect(() => { setDraft(structuredClone(selected)); setRenaming(false); }, [selectedId, selected.updatedAt]);
  useEffect(() => () => { if (retryTimer.current) window.clearTimeout(retryTimer.current); }, []);
  const visible = useMemo(() => profiles.filter((profile) => `${profile.label} ${profile.modelProvider ?? ''} ${profile.modelId ?? ''}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) : sort === 'provider' ? (a.modelProvider ?? '').localeCompare(b.modelProvider ?? '') : a.label.localeCompare(b.label)), [profiles, search, sort]);
  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const toggleArray = (key: 'allowedDelegates' | 'mcps' | 'skills', value: string) => setDraft((current) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value] }));
  const toggleMcpTool = (server: string, tool: string) => {
    const map = parseMcpSelectionMap(draft.allowedMcpsJson);
    const existing = map[server] ?? [];
    const nextTools = existing.includes(tool) ? existing.filter((item) => item !== tool) : [...existing, tool];
    const next = { ...map };
    if (nextTools.length > 0) next[server] = nextTools; else delete next[server];
    set('allowedMcpsJson', JSON.stringify(next));
  };
  const toggleSkillPolicy = (name: string) => {
    const list = parseNameList(draft.allowedSkillsJson);
    set('allowedSkillsJson', JSON.stringify(list.includes(name) ? list.filter((item) => item !== name) : [...list, name]));
  };
  if (fixtureState !== 'ready' && fixtureState !== 'read-only') {
    const waiting = fixtureState === 'loading' || fixtureState === 'retrying';
    const recoverable = ['empty', 'first-use', 'no-results'].includes(fixtureState);
    const retryable = fixtureState === 'failure' || fixtureState === 'unavailable';
    return <section className="profiles-workspace profiles-state-workspace" aria-label="Agent profiles" data-testid="profiles-workspace"><button className="text-button profiles-state-back" type="button" onClick={() => navigate('/agents')}><Icon name="chevronRight" className="rotate-180" size={14} />Back to Agents</button><div className="tool-state-panel" role={fixtureState === 'failure' || fixtureState === 'forbidden' || fixtureState === 'unavailable' ? 'alert' : 'status'} aria-busy={waiting || undefined} data-testid={`tool-state-${fixtureState}`}><Icon name={waiting ? 'refresh' : fixtureState === 'forbidden' ? 'background' : 'profile'} className={waiting ? 'spin' : ''} size={26} /><h1>{waiting ? `${fixtureState === 'retrying' ? 'Retrying' : 'Loading'} Profiles` : fixtureState === 'first-use' ? 'Set up Profiles' : fixtureState === 'no-results' ? 'No matching profiles' : fixtureState === 'empty' ? 'No profiles yet' : fixtureState === 'forbidden' ? 'Access denied' : 'Profiles unavailable'}</h1><p>{fixtureState === 'forbidden' ? 'This workspace cannot manage profile policy.' : retryable ? 'The profile service did not return usable data.' : waiting ? 'Waiting for profile data.' : 'No profiles match this view.'}</p>{recoverable && <button className="secondary-button" type="button" onClick={() => setFixtureState('ready')} data-testid="tool-state-restore">Load profiles</button>}{retryable && <button className="primary-button" type="button" onClick={() => { setFixtureState('retrying'); retryTimer.current = window.setTimeout(() => setFixtureState('ready'), 240); }} data-testid="tool-state-retry">Retry</button>}</div></section>;
  }
  return (
    <section className="profiles-workspace" aria-label="Agent profiles" aria-describedby={fixtureState === 'read-only' ? 'profiles-readonly' : undefined} data-od-id="profiles-workspace" data-testid="profiles-workspace">
      {fixtureState === 'read-only' && <div className="tool-readonly-banner profiles-readonly-banner" role="status" id="profiles-readonly" data-testid="tool-state-read-only"><Icon name="background" size={15} /><span><strong>Read-only</strong> · Profiles remain inspectable, but policy changes are disabled.</span></div>}
      <aside className="profile-rail" aria-label="Profile list">
        <header><button className="icon-button small" type="button" onClick={() => navigate('/agents')} aria-label="Back to Agents" data-testid="profiles-back"><Icon name="chevronRight" className="rotate-180" /></button><div><h1>Profiles</h1><small>Agent identity &amp; policy</small></div></header>
        <button className="primary-button full" type="button" onClick={() => { const id = createProfile(); setSelectedId(id); }} disabled={fixtureState === 'read-only'} data-testid="profile-create"><Icon name="plus" size={15} />Create profile</button>
        <label className="search-field"><Icon name="search" size={14} /><span className="sr-only">Search profiles</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search profiles" data-testid="profile-search" /></label>
        <label className="sort-label">Sort profiles<select value={sort} onChange={(event) => setSort(event.target.value)} data-testid="profile-sort"><option value="name">Name</option><option value="updated">Updated</option><option value="provider">Provider</option></select></label>
        <div className="profile-list">{visible.map((profile) => <button className={`profile-row ${selectedId === profile.id ? 'selected' : ''}`} type="button" key={profile.id} onClick={() => setSelectedId(profile.id)} data-testid={`profile-${profile.id}`}><span className="profile-avatar">{profile.icon}</span><span><strong>{profile.label}</strong><small>{profile.modelProvider ?? 'Configured'} · {profile.modelId ?? 'Configured model'}</small></span>{profile.isDefault && <em>Default</em>}{!profile.enabled && <em>Disabled</em>}</button>)}</div>
      </aside>
      <fieldset className="profile-editor profile-editor-fieldset" aria-labelledby="profile-editor-title" disabled={fixtureState === 'read-only'}>
        <header className="profile-editor-header"><div className="editor-title"><span className="profile-avatar large">{draft.icon}</span><div>{renaming ? <form onSubmit={(event) => { event.preventDefault(); updateProfile(selected.id, { label: draft.label }); setRenaming(false); }}><label className="sr-only" htmlFor="inline-profile-name">Profile name</label><input id="inline-profile-name" autoFocus value={draft.label} onChange={(event) => set('label', event.target.value)} data-testid="profile-inline-name" /><button className="icon-button small" type="submit" aria-label="Confirm rename" data-testid="profile-inline-confirm"><Icon name="check" size={14} /></button></form> : <div className="profile-title-line"><h2 id="profile-editor-title">{selected.label}</h2><button className="icon-button small" type="button" onClick={() => setRenaming(true)} aria-label="Rename profile inline" data-testid="profile-rename"><Icon name="rename" size={14} /></button></div>}<p>{selected.isDefault ? 'Default agent profile' : 'Workspace agent profile'} · updated Aug 12</p></div></div><div className="editor-header-actions"><button className="secondary-button" type="button" onClick={() => { const id = duplicateProfile(selected.id); setSelectedId(id); }} data-testid="profile-duplicate"><Icon name="copy" size={14} />Duplicate</button><button className="secondary-button" type="button" onClick={() => setDefaultProfile(selected.id)} disabled={selected.isDefault} title={selected.isDefault ? 'Already the default profile' : undefined} data-testid="profile-default"><Icon name="check" size={14} />{selected.isDefault ? 'Default' : 'Set default'}</button><button className="text-danger-button" type="button" onClick={() => selected.isDefault ? notify('Choose another default before deleting this profile') : setDeleteOpen(true)} data-testid="profile-delete"><Icon name="delete" size={14} />Delete</button></div></header>
        <form className="profile-form" onSubmit={(event) => { event.preventDefault(); void updateProfile(selected.id, draft).then(setSelectedId).then(() => notify('Profile saved')); }}>
          <section className="editor-section"><header><div><h3>Identity</h3><p>How this profile appears and guides each session.</p></div></header><div className="form-grid"><label className="field">Icon label<input value={draft.icon} maxLength={3} onChange={(event) => set('icon', event.target.value.toUpperCase())} data-testid="profile-icon" /></label><label className="field">Profile label<input value={draft.label} onChange={(event) => set('label', event.target.value)} data-testid="profile-label" /></label><label className="field span-2">System prompt<textarea rows={5} value={draft.systemPrompt} onChange={(event) => set('systemPrompt', event.target.value)} data-testid="profile-system-prompt" /></label></div></section>
          <section className="editor-section"><header><div><h3>Delegation</h3><p>Bound manager behavior and allowed delegate profiles.</p></div><label className="switch-label"><input type="checkbox" checked={draft.managerAgent} onChange={(event) => set('managerAgent', event.target.checked)} data-testid="profile-manager" /><span />Manager agent</label></header><fieldset className="option-grid"><legend>Allowed delegates</legend>{profiles.filter((profile) => profile.id !== selected.id).map((profile) => <label key={profile.id}><input type="checkbox" checked={draft.allowedDelegates.includes(profile.id)} onChange={() => toggleArray('allowedDelegates', profile.id)} data-testid={`delegate-${profile.id}`} /><span className="profile-avatar tiny">{profile.icon}</span><span><strong>{profile.label}</strong><small>{profile.model}</small></span></label>)}</fieldset></section>
          <section className="editor-section"><header><div><h3>Availability</h3><p>Control whether sessions can select and run this profile.</p></div></header><div className="switch-row"><label className="switch-label"><input type="checkbox" checked={draft.selectable} onChange={(event) => set('selectable', event.target.checked)} data-testid="profile-selectable" /><span />Session-selectable</label><label className="switch-label"><input type="checkbox" checked={draft.enabled} onChange={(event) => set('enabled', event.target.checked)} data-testid="profile-enabled" /><span />Enabled</label><label className="switch-label"><input type="checkbox" checked={draft.managedSkills} onChange={(event) => set('managedSkills', event.target.checked)} data-testid="profile-managed-skills" /><span />Managed skills</label></div></section>
          <section className="editor-section"><header><div><h3>Provider &amp; model</h3><p>Defaults used when a session begins with this profile.</p></div></header><div className="form-grid"><label className="field">Provider<select value={draft.modelProvider ?? ''} onChange={(event) => set('modelProvider', event.target.value || null)} data-testid="profile-provider"><option value="">No preference</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="local">Local provider</option></select></label><label className="field">Model<select value={draft.modelId ?? ''} onChange={(event) => set('modelId', event.target.value || null)} data-testid="profile-model"><option value="">No preference</option><option value="gpt-5.6">gpt-5.6</option><option value="gpt-5.6-codex">gpt-5.6-codex</option><option value="claude-sonnet-4">claude-sonnet-4</option><option value="claude-sonnet-4-6">claude-sonnet-4-6</option></select></label><label className="field span-2">Default account<select value={draft.defaultAccount} onChange={(event) => set('defaultAccount', event.target.value)} data-testid="profile-account"><option>Rhythm workspace</option><option>Research account</option><option>Local account</option></select></label></div></section>
          {!live && <section className="editor-section"><header><div><h3>Capabilities</h3><p>Scope MCP servers and skills to this profile.</p></div><button className="secondary-button" type="button" onClick={() => notify('MCP servers and skills refreshed')} data-testid="profile-resync"><Icon name="refresh" size={14} />Refresh capabilities</button></header><div className="capability-columns"><fieldset><legend>MCP servers</legend>{['GitNexus', 'Open Design', 'Web research'].map((item) => <label key={item}><input type="checkbox" checked={draft.mcps.includes(item)} onChange={() => toggleArray('mcps', item)} data-testid={`mcp-${item.toLowerCase().replace(' ', '-')}`} />{item}</label>)}</fieldset><fieldset><legend>Skills</legend>{['planning', 'verification', 'frontend', 'tests', 'research', 'citations'].map((item) => <label key={item}><input type="checkbox" checked={draft.skills.includes(item)} onChange={() => toggleArray('skills', item)} data-testid={`skill-${item}`} />{item}</label>)}</fieldset></div></section>}
          {live && <section className="editor-section"><header><div><h3>Capabilities</h3><p>Scope MCP servers and skills to this profile from the live engine catalog.</p></div><button className="secondary-button" type="button" onClick={() => { loadMcpCatalog(); loadSkillCatalog(); }} data-testid="profile-resync"><Icon name="refresh" size={14} />Refresh capabilities</button></header><div className="capability-columns">
            <fieldset><legend>MCP servers</legend>
              {mcpCatalogError && <p role="alert">{mcpCatalogError}</p>}
              {mcpCatalog.map((server) => {
                const selectedTools = parseMcpSelectionMap(draft.allowedMcpsJson)[server.name] ?? [];
                return <div key={server.name} className="mcp-server-group"><strong>{server.name}</strong>{server.tools.map((tool) => <label key={tool}><input type="checkbox" checked={selectedTools.includes(tool)} onChange={() => toggleMcpTool(server.name, tool)} data-testid={`mcp-${server.name}-${tool}`} />{tool}</label>)}</div>;
              })}
              {!mcpCatalogError && mcpCatalog.length === 0 && <p>No MCP servers configured.</p>}
            </fieldset>
            <fieldset><legend>Skills</legend>
              {skillCatalogError && <p role="alert">{skillCatalogError}</p>}
              {skillCatalog.map((skill) => <label key={skill.name}><input type="checkbox" checked={parseNameList(draft.allowedSkillsJson).includes(skill.name)} onChange={() => toggleSkillPolicy(skill.name)} data-testid={`skill-${skill.name}`} />{skill.name}</label>)}
              {!skillCatalogError && skillCatalog.length === 0 && <p>No skills found.</p>}
            </fieldset>
          </div></section>}
          <section className="editor-section"><header><div><h3>Core permission rules</h3><p>Ask, allow, or deny each capability by default.</p></div></header><div className="permission-table" role="table" aria-label="Core permission rules"><div role="row" className="permission-head"><span role="columnheader">Capability</span><span role="columnheader">Ask</span><span role="columnheader">Allow</span><span role="columnheader">Deny</span></div>{Object.entries(draft.permissionRules).map(([rule, value]) => <div role="row" key={rule}><strong role="cell">{rule}</strong>{(['ask', 'allow', 'deny'] as const).map((choice) => <label role="cell" key={choice}><input type="radio" name={`permission-${rule}`} checked={value === choice} onChange={() => setDraft((current) => ({ ...current, permissionRules: { ...current.permissionRules, [rule]: choice } }))} aria-label={`${rule}: ${choice}`} data-testid={`permission-${rule}-${choice}`} /></label>)}</div>)}</div></section>
          <footer className="sticky-save"><button className="secondary-button" type="button" onClick={() => setDraft(structuredClone(selected))} data-testid="profile-cancel">Cancel changes</button><button className="primary-button" type="submit" data-testid="profile-save">Save profile</button></footer>
        </form>
      </fieldset>
      <FocusDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete profile?" description={`${selected.label} will be removed from this workspace.`} testId="delete-profile-dialog"><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setDeleteOpen(false)}>Keep profile</button><button className="danger-button" type="button" onClick={() => { const fallback = profiles.find((profile) => profile.id !== selected.id)?.id || ''; void deleteProfile(selected.id).then(() => setSelectedId(fallback)); setDeleteOpen(false); }} data-testid="confirm-profile-delete">Delete profile</button></div></FocusDialog>
    </section>
  );
}
