import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../database/db';
import { AgentConfigsRepository, type AgentConfigInput } from '../repositories/agent_configs_repository';
import { loadQualificationFixtureAuthority, qualificationSyntheticActorToken } from './qualification_fixture_authority';
import { projectAgentProfileAfterWrite } from './agent_profile_projection_service';
/** Public identity/profile configuration, plus an opt-in disposable ordinary auth session. */
export function bootstrapQualificationFixture(phase:'seed'|'project'='seed'):void {
  const m=loadQualificationFixtureAuthority();if(!m)return;
  const db=getDb(),user=m.publicUserSeed;
  if(phase==='project'){
    if(!m.profileSeedPath)return;
    const profiles=JSON.parse(readFileSync(m.profileSeedPath,'utf8')).profiles as Array<{id:string}>;
    if(!Array.isArray(profiles) || profiles.length>16)throw new Error('qualification profiles invalid');
    const repo=new AgentConfigsRepository();
    // Reconcile current rows after boot backfills, including recovery boots.
    // Never restore the older seed body/revision over an operator's current row.
    for(const profile of profiles){
      const current=typeof profile.id==='string'?repo.getById(profile.id):null;
      if(!current)throw new Error('qualification profile projection missing');
      const outcome=projectAgentProfileAfterWrite(current,'recovery');
      const durable=db.prepare('SELECT projection_state,file_projected_revision FROM agent_profile_projections WHERE profile_id=?').get(current.id) as {projection_state:string;file_projected_revision:number}|undefined;
      if(outcome.kind!=='projected' || durable?.projection_state!=='projected' || durable.file_projected_revision!==current.revision)throw new Error('qualification profile projection unavailable');
    }
    return;
  }
  const prior=db.prepare('SELECT id,email,google_sub FROM users WHERE id=?').get(m.ownerUserId) as {id:number;email:string;google_sub:string}|undefined;
  if(prior && (prior.email!==user.email || prior.google_sub!==user.googleSub))throw new Error('qualification public identity differs');
  if(m.syntheticActor && db.prepare('SELECT 1 FROM users WHERE id<>? LIMIT 1').get(m.ownerUserId))
    throw new Error('qualification synthetic actor found foreign user');
  db.prepare('INSERT OR IGNORE INTO users(id,name,email,google_sub,timezone) VALUES (?,?,?,?,?)').run(user.id,user.name,user.email,user.googleSub,user.timezone);
  chmodSync(m.dbPath,0o600);
  db.exec('CREATE TABLE IF NOT EXISTS qualification_fixture_bootstrap(source_revision TEXT PRIMARY KEY, profile_seed_digest TEXT)');
  if(!db.prepare('SELECT 1 FROM qualification_fixture_bootstrap WHERE source_revision=?').get(m.sourceRevision)){
    if(db.prepare('SELECT 1 FROM agent_sessions LIMIT 1').get())throw new Error('qualification bootstrap requires fresh session store');
    if(m.profileSeedPath){
      const profiles=JSON.parse(readFileSync(m.profileSeedPath,'utf8')).profiles as Array<AgentConfigInput & {revision:number}>;
      const keys=['label','icon','enabled','isAgent','isManager','systemPrompt','allowedMcpsJson','allowedSkillsJson','corePermissionsJson','allowedDelegatesJson','modelProvider','modelId','ocAgent','sessionSelectable','schedulable','reasoningEffort','autoApproveActions'] as const;
      if(!Array.isArray(profiles) || profiles.length>16)throw new Error('qualification profiles invalid');
      const repo=new AgentConfigsRepository();
      for(const profile of profiles){
        if(!profile.id || !Number.isSafeInteger(profile.revision) || profile.revision<1)throw new Error('qualification profile revision invalid');
        const input=Object.fromEntries(keys.filter(k=>profile[k]!==undefined).map(k=>[k,profile[k]])) as unknown as AgentConfigInput;
        if(repo.getById(profile.id))repo.update(profile.id,input);else repo.insert({...input,id:profile.id});
        db.prepare('UPDATE agent_configs SET revision=? WHERE id=?').run(profile.revision,profile.id);
      }
    }
    db.prepare('INSERT INTO qualification_fixture_bootstrap(source_revision) VALUES (?)').run(m.sourceRevision);
  }
  if(m.syntheticActor){
    const token=qualificationSyntheticActorToken(m);
    const rows=db.prepare('SELECT token,user_id,expires_at FROM sessions').all() as Array<{token:string;user_id:number;expires_at:string|null}>;
    if(rows.some(row=>row.token!==token || row.user_id!==m.ownerUserId || row.expires_at!==m.syntheticActor!.expiresAt))
      throw new Error('qualification synthetic actor found foreign auth session');
    if(rows.length===0)db.prepare('INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)')
      .run(token,m.ownerUserId,new Date().toISOString(),m.syntheticActor.expiresAt);
  }
}
