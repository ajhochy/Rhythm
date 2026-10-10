import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../database/db';
import { AgentConfigsRepository, type AgentConfigInput } from '../repositories/agent_configs_repository';
import { loadQualificationFixtureAuthority } from './qualification_fixture_authority';
/** Public identity/profile configuration only. Never creates authentication sessions or signed decisions. */
export function bootstrapQualificationFixture():void {
  const m=loadQualificationFixtureAuthority();if(!m)return;
  const db=getDb(),user=m.publicUserSeed;
  const prior=db.prepare('SELECT id,email,google_sub FROM users WHERE id=?').get(m.ownerUserId) as {id:number;email:string;google_sub:string}|undefined;
  if(prior && (prior.email!==user.email || prior.google_sub!==user.googleSub))throw new Error('qualification public identity differs');
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
}
