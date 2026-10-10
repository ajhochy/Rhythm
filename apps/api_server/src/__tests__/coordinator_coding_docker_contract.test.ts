import { expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import * as actual from '../services/coordinator_coding_artifact_verifier';

// SOURCE/UNIT ONLY. Real files/parent oracle; only the Docker process boundary
// is doubled. Any actual child/container/candidate invocation is a test error.
vi.mock('node:child_process',()=>({spawn:vi.fn(()=>{throw new Error('UNIT prohibits every real child/Docker/candidate launch');})}));
const api=actual as unknown as Record<string,any>;
const runtime='1'.repeat(64); // UNIT metadata, not a qualified Linux runtime hash.
async function fixture(){
  const base=realpathSync(mkdtempSync('/private/tmp/rhythm-C3-docker-UNIT-'));
  const root=join(base,'workspace'),artifacts=join(base,'server');
  mkdirSync(join(root,'src'),{recursive:true});mkdirSync(artifacts);
  writeFileSync(join(root,'src/selectTasks.ts'),'export const selectTasks=()=>[]; // UNIT never imported',{flag:'wx'});
  const snapshot=await actual.captureCodingSnapshot(root,['src/selectTasks.ts'],artifacts);
  const pins=typeof api.codingDockerPins==='function'?api.codingDockerPins(runtime):{
    image:'node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392',platform:'linux/arm64',runtimeDigest:runtime,
    dockerPath:'/Applications/Docker.app/Contents/Resources/bin/docker',dockerDigest:'aeb0c9beb933a73723f1653d54f91636ef4033621543eef4c2c67d45aa467eba'};
  return {base,snapshot,pins,context:{rootSessionId:'UNIT-root',operationKey:'UNIT-op'}};
}
const observations=()=>{
  const tasks=[{id:'a',status:'open'},{id:'b',status:'done'},{id:'c',status:'open'}];
  const ids=['open','done','omitted','empty_no_match','order','unsupported_status','input_preservation'];
  const results:unknown[]=[[tasks[0],tasks[2]],[tasks[1]],tasks,[[],[]],[tasks[2],tasks[0]],null,null];
  return {schemaVersion:1,observations:ids.map((id,i)=>({id,result:results[i],threw:id==='unsupported_status',
    before:JSON.stringify(id==='order'?[tasks[2],tasks[1],tasks[0]]:tasks),
    after:JSON.stringify(id==='order'?[tasks[2],tasks[1],tasks[0]]:tasks)}))};
};
function inspect(plan:any){return {Id:'a'.repeat(64),State:{Running:false},Config:{Image:plan.image,User:'1000:1000',Labels:{'rhythm.coding-evaluator':plan.owner},
  Entrypoint:['/usr/local/bin/node'],Cmd:['--frozen-intrinsics','--disable-proto=throw','/runner/observe.mjs'],
  Env:['PATH=/usr/local/bin:/usr/bin:/bin','NODE_VERSION=22.23.3','HOME=/tmp','NODE_ENV=production']},
  HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],
    PidsLimit:32,NanoCpus:1_000_000_000,Memory:268435456,MemorySwap:268435456,ShmSize:8388608,
    Ulimits:[{Name:'core',Hard:0,Soft:0}],Tmpfs:{'/tmp':'rw,size=16m,uid=1000,gid=1000,mode=0700,noexec,nosuid,nodev'}},
  Mounts:plan.mounts.map((m:any)=>({Source:m.source,Destination:m.target,RW:false,Type:'bind'}))};}
function launcher(variation:Record<string,unknown>={}){
  const calls:any[]=[];
  const launch=vi.fn(async(req:any)=>{calls.push(req);if(req.action==='create')return {exitCode:0,stdout:'a'.repeat(64),stderr:''};
    if(req.action==='inspect'){
      const value=inspect(req.plan);
      if(variation.inspectMutation==='writable')value.Mounts[0].RW=true;
      if(variation.inspectMutation==='network')value.HostConfig.NetworkMode='host';
      if(variation.inspectMutation==='user')value.Config.User='0:0';
      if(variation.inspectMutation==='env')value.Config.Env.push('HOST_SECRET=forbidden');
      return {exitCode:0,stdout:JSON.stringify(value),stderr:''};
    }
    if(req.action==='start')return {exitCode:0,stdout:JSON.stringify(observations()),stderr:'',...variation};
    if(req.action==='wait')return {exitCode:0,stdout:'0',stderr:''};
    return {exitCode:0,stdout:'',stderr:''};});
  return {launch,calls};
}

it('C3-D01 fixes image/platform/nonroot/mount/network/resources and concrete Docker entry plan',async()=>{
  const f=await fixture(),mock=launcher();
  await (actual.verifyCodingSnapshot as any)(f.snapshot,actual.codingEvaluatorPins(),{docker:{pins:f.pins,context:f.context,launcher:mock.launch,unitOnly:true}});
  expect(mock.calls.filter(c=>c.action==='create')).toHaveLength(1);
  const plan=mock.calls.find(c=>c.action==='create').plan;
  expect(plan.image).toBe('node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392');
  expect(plan.createArgs).toContain('--pull=never');expect(plan.createArgs).toContain('linux/arm64');
  expect(plan.createArgs).toContain('1000:1000');expect(plan.createArgs).toContain('--network=none');
  expect(plan.createArgs).toContain('--read-only');expect(plan.createArgs).toContain('--pids-limit=32');
  expect(plan.createArgs).toContain('--memory=256m');expect(plan.createArgs).toContain('--memory-swap=256m');
  expect(plan.createArgs).toContain('--cpus=1');expect(plan.createArgs).toContain('--cap-drop=ALL');
  expect(plan.mounts.map((m:any)=>m.target)).toEqual(['/capture','/runner']);
  expect(plan.mounts.every((m:any)=>m.readonly)).toBe(true);
  expect(plan.createArgs).toContain('/usr/local/bin/node');expect(plan.createArgs).not.toContain('--privileged');
});

it('C3-D02 refuses unowned/symlink/escape and every context/image/env/argv/mount override',async()=>{
  const f=await fixture();expect(typeof api.buildCodingDockerPlan).toBe('function');
  for(const extra of [{image:'node:latest'},{env:{KEY:'x'}},{argv:['unsafe']},{mounts:[{readonly:false}]},{unknown:true}])
    expect(()=>api.buildCodingDockerPlan(f.snapshot,f.pins,{...f.context,...extra})).toThrow();
  expect(()=>api.buildCodingDockerPlan(f.snapshot,{...f.pins,image:'node:latest'},f.context)).toThrow();
  expect(()=>api.buildCodingDockerPlan({...f.snapshot,directory:'/bin'},f.pins,f.context)).toThrow();
  const link=join(f.base,'capture-link');symlinkSync(f.snapshot.directory,link);
  expect(()=>api.buildCodingDockerPlan({...f.snapshot,directory:link},f.pins,f.context)).toThrow();
  expect(()=>api.buildCodingDockerPlan({...f.snapshot,files:[{...f.snapshot.files[0],path:'../outside'}]},f.pins,f.context)).toThrow();
  for(const inspectMutation of ['writable','network','user','env']){
    const mock=launcher({inspectMutation});
    const result=await (actual.verifyCodingSnapshot as any)(f.snapshot,actual.codingEvaluatorPins(),
      {docker:{pins:f.pins,context:f.context,launcher:mock.launch,unitOnly:true}});
    expect(result.verdict).toBe('unverified');expect(mock.calls.filter(c=>c.action==='start')).toHaveLength(0);
  }
});

it('C3-D03 parent independently computes seven checks and private signer never enters plan/candidate',async()=>{
  const f=await fixture();expect(typeof api.codingDockerChecks).toBe('function');
  const checks=api.codingDockerChecks(JSON.stringify(observations()));
  expect(checks.map((c:any)=>c.id)).toEqual(['open','done','omitted','empty_no_match','order','unsupported_status','input_preservation']);
  expect(checks.every((c:any)=>c.passed)).toBe(true);
  const wrong=observations();wrong.observations[0].result=['b'];
  expect(api.codingDockerChecks(JSON.stringify(wrong))[0].passed).toBe(false);
  const plan=api.buildCodingDockerPlan(f.snapshot,f.pins,f.context);
  expect(JSON.stringify(plan)).not.toMatch(/challenge|hmacKey|privateKey/);
  expect(plan.workerSource).not.toMatch(/createHmac|challenge|privateKey/);
});

it('C3-D04 complete closed ordered bounded observations only, never claimed pass/MAC',()=>{
  expect(typeof api.codingDockerChecks).toBe('function');
  const good=observations();
  const bad=[{verdict:'passed',checks:[],mac:'fake'}, {...good,verdict:'passed'},
    {...good,observations:[...good.observations,good.observations[0]]},
    {...good,observations:good.observations.slice(1)},
    {...good,observations:good.observations.slice().reverse()},
    {...good,observations:good.observations.map((o,i)=>i?o:{...o,passed:true})}];
  for(const value of bad)expect(()=>api.codingDockerChecks(JSON.stringify(value))).toThrow();
  expect(()=>api.codingDockerChecks(JSON.stringify(good)+'\n'+JSON.stringify(good))).toThrow();
  expect(()=>api.codingDockerChecks('x'.repeat(16385))).toThrow();
});

it('C3-D05 parent custody authenticates all bindings and rejects altered/replayed signed receipts',async()=>{
  const f=await fixture();expect(typeof api.createCodingDockerCustody).toBe('function');
  const binding={...f.context,snapshot:f.snapshot.digest,target:'2'.repeat(64),evaluator:'3'.repeat(64),runner:'4'.repeat(64),
    image:f.pins.image,runtime,containerId:'a'.repeat(64)};
  const custody=api.createCodingDockerCustody(binding);const receipt=custody.seal({checks:api.codingDockerChecks(JSON.stringify(observations()))});
  for(const key of Object.keys(binding))expect(custody.consume({...receipt,binding:{...receipt.binding,[key]:'foreign'}})).toBe(false);
  expect(custody.consume({...receipt,nonce:'foreign'})).toBe(false);
  expect(custody.consume(receipt)).toBe(true);expect(custody.consume(receipt)).toBe(false);
});

it('C3-D06 fake launcher failures stay unverified and control ONLY owned exact inspected container; stale stays stale',async()=>{
  const f=await fixture();
  for(const failure of [{timedOut:true},{overflow:true},{exitCode:1},{stdout:'{malformed'}, {stdout:JSON.stringify({verdict:'passed'})}]){
    const mock=launcher(failure);
    const result=await (actual.verifyCodingSnapshot as any)(f.snapshot,actual.codingEvaluatorPins(),
      {docker:{pins:f.pins,context:f.context,launcher:mock.launch,unitOnly:true}} as any);
    expect(result.verdict).toBe('unverified');
    expect(mock.calls.filter(c=>['stop','remove'].includes(c.action)).every(c=>c.containerId==='a'.repeat(64))).toBe(true);
    expect(mock.calls.filter(c=>c.action==='stop')).toHaveLength(1);
    expect(result.qualified).toBe(false);
  }
  const mock=launcher();const result=await (actual.verifyCodingSnapshot as any)(f.snapshot,actual.codingEvaluatorPins(),
    {docker:{pins:f.pins,context:f.context,launcher:mock.launch,unitOnly:true}} as any);
  expect(result.verdict).toBe('passed');expect(result.qualification).toBe('unit_mock_only');expect(result.qualified).toBe(false);
  writeFileSync(join(f.snapshot.root,'src/selectTasks.ts'),'// actual post-capture mutation');
  const stale=await (actual.verifyCodingSnapshot as any)(f.snapshot,actual.codingEvaluatorPins(),
    {docker:{pins:f.pins,context:f.context,launcher:launcher().launch,unitOnly:true}} as any);
  expect(stale.verdict).toBe('stale');
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try {
    const blocked=launcher();
    const result=await (actual.verifyCodingSnapshot as any)(f.snapshot,actual.codingEvaluatorPins(),
      {docker:{pins:f.pins,context:f.context,launcher:blocked.launch,unitOnly:true}});
    expect(result.verdict).toBe('unverified');expect(blocked.calls).toHaveLength(0);
  } finally {process.env.NODE_ENV=previous;}
});
