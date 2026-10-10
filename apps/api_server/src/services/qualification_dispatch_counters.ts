import { appendFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { loadQualificationFixtureAuthority, qualificationApiBootId } from './qualification_fixture_authority';
interface DispatchBinding {fixtureId:string;sessionId:string;sdkSessionId:string;ownerUserId:number;projectId:string;cwd:string;sourceRevision:string;apiBootId:string;enginePid:number;engineBootId:string;canary:string|null}
const bound=new Map<string,DispatchBinding>();
const counts=new Map<string,number>();
export function bindQualificationDispatch(input: Omit<DispatchBinding,'sourceRevision'|'apiBootId'|'ownerUserId'>): void {
  const m=loadQualificationFixtureAuthority();if(!m)throw new Error('fixture authority absent');
  const row=new AgentSessionsRepository().findById(input.sessionId);
  if(!row || row.ownerUserId!==m.ownerUserId || row.projectId!==input.projectId || row.cwd!==input.cwd || row.sdkSessionId!==input.sdkSessionId || !input.cwd.startsWith(m.fixtureRoot+'/'))throw new Error('fixture dispatch binding differs');
  const binding={...input,ownerUserId:m.ownerUserId,sourceRevision:m.sourceRevision,apiBootId:qualificationApiBootId};
  if(!/^[a-zA-Z0-9_-]+$/.test(input.sdkSessionId))throw new Error('fixture SDK identity invalid');
  const existing=bound.get(input.sdkSessionId);if(existing){if(JSON.stringify(existing)!==JSON.stringify(binding))throw new Error('fixture rebinding forbidden');return;}
  const dir=join(m.fixtureRoot,'dispatch-bindings');mkdirSync(dir,{recursive:true,mode:0o700});
  const st=lstatSync(dir);if(realpathSync(dir)!==dir || !st.isDirectory() || st.isSymbolicLink() || st.uid!==process.getuid?.() || (st.mode&0o777)!==0o700)throw new Error('fixture dispatch directory invalid');
  const target=join(dir,input.sdkSessionId+'.json');
  writeFileSync(target,JSON.stringify(binding),{mode:0o600,flag:'wx'});
  bound.set(input.sdkSessionId,binding);counts.set(input.sdkSessionId,0);
}
export function qualificationSdkAttempt(sdkSessionId:string):void {
  const b=bound.get(sdkSessionId),m=loadQualificationFixtureAuthority();if(!b || !m)return;
  const row=new AgentSessionsRepository().findById(b.sessionId);
  if(!row || row.sdkSessionId!==sdkSessionId || row.ownerUserId!==b.ownerUserId || row.cwd!==b.cwd || row.projectId!==b.projectId)throw new Error('qualification dispatch scope changed');
  counts.set(sdkSessionId,(counts.get(sdkSessionId)??0)+1);
}
export function qualificationDispatchSnapshot(sdkSessionId:string):{sdk:number;provider:number;contextInjected:boolean} {
  const m=loadQualificationFixtureAuthority(),b=bound.get(sdkSessionId);if(!m || !b)throw new Error('fixture dispatch unbound');
  let rows:Array<{sdkSessionId:string;apiBootId:string;enginePid:number;sourceRevision:string;contextInjected:boolean}>=[];
  const file=join(m.fixtureRoot,'dispatch-bindings',sdkSessionId+'.provider.jsonl');
  try {const st=lstatSync(file);if(realpathSync(file)!==file || st.uid!==process.getuid?.() || !st.isFile() || st.isSymbolicLink() || st.nlink!==1 || (st.mode&0o777)!==0o600 || st.size>1_048_576)throw new Error('invalid provider counter');rows=readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const current=rows.filter(x=>x.sdkSessionId===sdkSessionId && x.apiBootId===b.apiBootId && x.enginePid===b.enginePid && x.sourceRevision===b.sourceRevision);
  return {sdk:counts.get(sdkSessionId)??0,provider:current.length,contextInjected:current.some(x=>x.contextInjected)};
}
