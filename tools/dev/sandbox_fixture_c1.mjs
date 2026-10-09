// Opt-in synthetic C1 fixtures, invoked by sandbox_fixture.mjs BEFORE runtime.
export function seedC1Guards(db) {
  for (const kind of ['DISABLED', 'LOCKED', 'RETIRED']) {
    const id = `synthetic-c1-guard-${kind.toLowerCase()}`;
    const grants = kind === 'RETIRED' ? '["rhythm_run_org_optimizer"]' : '[]';
    db.prepare(`INSERT INTO agent_configs
      (id,label,icon,command,enabled,is_agent,locked,session_selectable,schedulable,
       model_provider,model_id,allowed_mcps_json,allowed_skills_json,allowed_delegates_json,core_permissions_json)
      VALUES (?,?,?,'',?,1,?,1,1,'synthetic-c1','text',?,'[]','[]','{"*":"deny"}')`)
      .run(id, `Synthetic C1 ${kind}`, 'flask', kind === 'DISABLED' ? 0 : 1, kind === 'LOCKED' ? 1 : 0, grants);
    db.prepare(`INSERT INTO agent_scheduled_tasks
      (id,name,schedule_type,run_at,prompt,agent_kind,agent_config_id,enabled,allowed_mcps_json,created_by_user_id)
      VALUES (?,?,'once','2099-01-01T00:00:00.000Z','Synthetic blocked guard only','opencode',?,0,?,1)`)
      .run(id, `synthetic-C1-guard-${kind}`, id, grants);
  }
}
