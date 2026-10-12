import { createHash } from 'node:crypto'
import type { LanguageModelV3Middleware } from "@ai-sdk/provider"
import { appendFileSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
const admittedOverlays=new WeakMap<object,{text:string;sha256:string}>()
export function markQualificationDayflowOverlay(prepared:object,overlay:{text:string;sha256:string}):void {
  if(process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST)admittedOverlays.set(prepared,overlay)
}
/** Body-free attempt receipt at the actual provider handoff. Disabled without private startup authority. */
export function qualificationProviderAttempt(sdkSessionId: string, prepared: unknown): void {
  const manifest=process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST
  if(!manifest)return
  const owned=(p:string,mode:number,dir=false)=>{const s=lstatSync(p);if(realpathSync(p)!==p || s.uid!==process.getuid?.() || (!dir && s.nlink!==1) || s.isSymbolicLink() || (dir?!s.isDirectory():!s.isFile()) || (s.mode&0o777)!==mode)throw new Error('qualification counter authority changed')}
  if(!manifest.startsWith('/private/tmp/') || resolve(manifest)!==manifest)throw new Error('qualification counter scope invalid')
  owned(dirname(manifest),0o700,true);owned(manifest,0o600)
  const m=JSON.parse(readFileSync(manifest,'utf8'))
  if(m.schemaVersion!==1 || !/^[a-f0-9]{40}$/.test(m.sourceRevision) || !m.fixtureRoot?.startsWith('/private/tmp/') || m.dbPath!==join(m.fixtureRoot,'rhythm.db'))throw new Error('qualification counter manifest invalid')
  owned(m.fixtureRoot,0o700,true)
  if(!/^[a-zA-Z0-9_-]+$/.test(sdkSessionId))throw new Error('qualification counter SDK invalid')
  const file=join(m.fixtureRoot,'dispatch-bindings',sdkSessionId+'.json')
  let b
  try{owned(file,0o600);b=JSON.parse(readFileSync(file,'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e}
  if(b.sdkSessionId!==sdkSessionId || b.ownerUserId!==m.ownerUserId || b.sourceRevision!==m.sourceRevision || b.enginePid!==process.pid || !b.cwd?.startsWith(m.fixtureRoot+'/'))throw new Error('qualification provider binding changed')
  owned(join(m.fixtureRoot,'dispatch-bindings'),0o700,true)
  const target=join(m.fixtureRoot,'dispatch-bindings',sdkSessionId+'.provider.jsonl')
  try{owned(target,0o600);if(lstatSync(target).nlink!==1)throw new Error('qualification counter hardlink invalid')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
  const overlay=prepared && typeof prepared==='object'?admittedOverlays.get(prepared):undefined
  const p=prepared as {prompt?:Array<{role:string;content:unknown}>;providerOptions?:{openai?:{instructions?:string}}}
  const system=(p.prompt??[]).filter(x=>x.role==='system' && typeof x.content==='string').map(x=>x.content as string)
  if(typeof p.providerOptions?.openai?.instructions==='string')system.push(p.providerOptions.openai.instructions)
  const segment=overlay?system.find(x=>x.includes(overlay.text)):undefined
  const contextInjected=!!overlay && !!segment && typeof b.canary==='string' && b.canary.length>0 && overlay.text.includes(b.canary) && createHash('sha256').update(overlay.text).digest('hex')===overlay.sha256
  const systemSha256=segment?createHash('sha256').update(segment).digest('hex'):null
  const admittedOverlaySha256=contextInjected?overlay!.sha256:null
  appendFileSync(target,JSON.stringify({sdkSessionId,apiBootId:b.apiBootId,enginePid:process.pid,sourceRevision:m.sourceRevision,contextInjected,systemSha256,admittedOverlaySha256})+'\n',{mode:0o600})
}

export function qualificationProviderMiddleware(sdkSessionId:string):LanguageModelV3Middleware {
  return {specificationVersion:'v3',
    async wrapStream({doStream,params}){qualificationProviderAttempt(sdkSessionId,params);return doStream()},
    async wrapGenerate({doGenerate,params}){qualificationProviderAttempt(sdkSessionId,params);return doGenerate()},
  }
}
