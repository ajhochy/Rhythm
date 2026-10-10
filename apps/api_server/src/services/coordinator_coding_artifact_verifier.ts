import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, cpSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { codingQuickJsWorker } from './coordinator_coding_quickjs_worker';

const digest = (v: string|Buffer) => createHash('sha256').update(v).digest('hex');
const allowed = ['src/selectTasks.ts','tests/selectTasks.test.mjs','package.json','tsconfig.json'];
const criteria = ['open','done','omitted','empty_no_match','order','unsupported_status','input_preservation'];
const evaluator = `import { isDeepStrictEqual } from 'node:util';
const equal=isDeepStrictEqual;
export function evaluate(selectTasks) {
 const tasks=[{id:'a',status:'open'},{id:'b',status:'done'},{id:'c',status:'open'}];
 const before=JSON.stringify(tasks);
 const checks=[];
 const check=(id,fn)=>{let passed=false;try{passed=fn()===true;}catch{}checks.push({id,passed});};
 check('open',()=>equal(selectTasks(tasks,'open'),[tasks[0],tasks[2]]));
 check('done',()=>equal(selectTasks(tasks,'done'),[tasks[1]]));
 check('omitted',()=>equal(selectTasks(tasks),tasks));
 check('empty_no_match',()=>equal(selectTasks([],'open'),[])&&equal(selectTasks([tasks[1]],'open'),[]));
 check('order',()=>equal(selectTasks([tasks[2],tasks[1],tasks[0]],'open'),[tasks[2],tasks[0]]));
 check('unsupported_status',()=>{try{selectTasks(tasks,'blocked');return false;}catch{return true;}});
 check('input_preservation',()=>JSON.stringify(tasks)===before);
 return checks;
}
`;


export interface CodingSnapshot {
  kind:'immutable_allowed_bytes_v1'; root:string; directory:string; digest:string;
  files:Array<{path:string;present:boolean;mode:number|null;sha256:string|null;size:number}>;
}
export interface CodingVerificationReceipt {
  kind:'coding_verification_v1'; verdict:'passed'|'failed'|'unverified'|'stale';
  snapshot:CodingSnapshot; evaluatorDigest:string; runnerDigest:string;
  checks:Array<{id:string;passed:boolean}>; reason:string|null;
  qualified?:boolean;
  qualification?:'unit_mock_only'|'integration_pending'|'protected_runtime_v1'|'unverified';
  authentication?:unknown;
}

export function codingEvaluatorPins() {
  return {evaluatorDigest:digest(evaluator),runnerDigest:digest(codingQuickJsWorker),nodePath:realpathSync(process.execPath),nodeDigest:digest(readFileSync(process.execPath))};
}

function inventory(root: string, paths: readonly string[]) {
  if (realpathSync(root)!==root || !lstatSync(root).isDirectory() || paths.length===0 ||
      paths.length>allowed.length || new Set(paths).size!==paths.length || paths.some(p=>!allowed.includes(p))) throw new Error('coding capture scope held');
  return paths.slice().sort().map(path => {
    const target=join(root,path);
    if (!existsSync(target)) {
      try { if (lstatSync(target).isSymbolicLink()) throw new Error('coding capture symlink'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
      return {path,present:false,mode:null,sha256:null,size:0};
    }
    const before=lstatSync(target,{bigint:true});
    if (!before.isFile() || before.isSymbolicLink() || realpathSync(target)!==target || before.size>1_048_576n) throw new Error('coding capture escaped/unsupported');
    const bytes=readFileSync(target),after=lstatSync(target,{bigint:true});
    if (before.ino!==after.ino || before.dev!==after.dev || before.mtimeNs!==after.mtimeNs || before.ctimeNs!==after.ctimeNs || before.size!==after.size) throw new Error('coding writer not quiescent');
    return {path,present:true,mode:Number(before.mode&0o777n),sha256:digest(bytes),size:bytes.length};
  });
}

export async function captureCodingSnapshot(root: string, paths: readonly string[], artifactRoot: string): Promise<CodingSnapshot> {
  root=resolve(root); artifactRoot=resolve(artifactRoot);
  if (realpathSync(artifactRoot)!==artifactRoot || !relative(root,artifactRoot).startsWith('..')) throw new Error('capture must be server-owned outside workspace');
  const files=inventory(root,paths),directory=mkdtempSync(join(artifactRoot,'coding-capture-'));
  for (const file of files) {
    if (!file.present) continue;
    const target=join(directory,file.path);mkdirSync(dirname(target),{recursive:true,mode:0o700});
    const bytes=readFileSync(join(root,file.path));
    if (digest(bytes)!==file.sha256) throw new Error('coding source changed during capture');
    writeFileSync(target,bytes,{flag:'wx',mode:0o400});
  }
  if (JSON.stringify(inventory(root,paths))!==JSON.stringify(files)) throw new Error('coding source changed during capture');
  const snapshot:CodingSnapshot={kind:'immutable_allowed_bytes_v1',root,directory,digest:digest(JSON.stringify(files)),files};
  writeFileSync(join(directory,'capture.json'),JSON.stringify(snapshot),{flag:'wx',mode:0o400});
  return snapshot;
}

export function codingSnapshotCurrent(snapshot:CodingSnapshot): boolean {
  try { return digest(JSON.stringify(inventory(snapshot.root,snapshot.files.map(f=>f.path))))===snapshot.digest; } catch { return false; }
}

export async function verifyCodingSnapshot(snapshot:CodingSnapshot, pins:ReturnType<typeof codingEvaluatorPins>, options?:{docker:CodingDockerOptions}): Promise<CodingVerificationReceipt> {
  const receipt:CodingVerificationReceipt={kind:'coding_verification_v1',verdict:'unverified',snapshot,
    evaluatorDigest:pins.evaluatorDigest,runnerDigest:pins.runnerDigest,checks:[],reason:'protected evaluator unavailable'};
  if (options?.docker) return verifyCodingDockerSnapshot(snapshot,pins,options.docker,receipt);
  // The legacy shared Node realm was not a security boundary. Only the restricted Docker/WASM path can execute candidate bytes.
  return receipt;
}

const approvedDockerImage='node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392';
const dockerBinary='/Applications/Docker.app/Contents/Resources/bin/docker';
const dockerBinaryDigest='aeb0c9beb933a73723f1653d54f91636ef4033621543eef4c2c67d45aa467eba';
interface CodingDockerPins {image:string;platform:string;runtimeDigest:string;dockerPath:string;dockerDigest:string}
interface CodingDockerContext {rootSessionId:string;operationKey:string}
interface CodingDockerResult {exitCode:number;stdout:string;stderr:string;timedOut?:boolean;overflow?:boolean}
interface CodingDockerRequest {action:'create'|'inspect'|'start'|'wait'|'stop'|'remove';args:string[];plan:CodingDockerPlan;containerId?:string}
type CodingDockerLauncher=(request:CodingDockerRequest)=>Promise<CodingDockerResult>;
interface CodingDockerOptions {pins:CodingDockerPins;context:CodingDockerContext;launcher?:CodingDockerLauncher;unitOnly?:boolean}
interface CodingDockerPlan {
  image:string;owner:string;createArgs:string[];mounts:Array<{source:string;target:string;readonly:true}>;
  workerSource:string;targetDigest:string;workerDigest:string;runtimeDigest:string;
}

export function codingDockerPins(runtimeDigest:string):CodingDockerPins {
  return {image:approvedDockerImage,platform:'linux/arm64',runtimeDigest,dockerPath:dockerBinary,dockerDigest:dockerBinaryDigest};
}
const strictKeys=(value:object,keys:string[])=>{
  if (Object.keys(value).sort().join(',')!==keys.slice().sort().join(',')) throw new Error('coding Docker closed schema');
};
function ownedDockerPath(path:string,directory:boolean):void {
  const info=lstatSync(path);
  if (info.uid!==process.getuid?.() || info.isSymbolicLink() || realpathSync(path)!==path ||
      (directory?!info.isDirectory():!info.isFile())) throw new Error('coding Docker unowned/noncanonical input');
}

// No signer or nonce in this worker. It records bounded observations only.
// Correctness of hostile in-process instrumentation requires actual D08/D10;
// private parent signing authenticates custody, never substitutes that proof.
const dockerWorker=codingQuickJsWorker;
export const codingDockerRuntimeDigest='d09e299258c24f7cdf6f5d5ec185e3a56512b27a697113735dac909f1cac7b8d';
const quickjsDigest='916b9d5d5e95e26e12e4be58ccdd667120011174fb9f4aadff6f97bfb28c49a5';
const quickjsPackages=['quickjs-emscripten','quickjs-emscripten-core','@jitl/quickjs-ffi-types','@jitl/quickjs-wasmfile-debug-asyncify','@jitl/quickjs-wasmfile-debug-sync','@jitl/quickjs-wasmfile-release-asyncify','@jitl/quickjs-wasmfile-release-sync'];
function runtimeTree(root:string,prefix=''):Array<[string,string]> {
 return readdirSync(root).sort().flatMap(name=>{const path=join(root,name),info=lstatSync(path);
  if(info.isSymbolicLink())throw new Error('QuickJS dependency symlink');
  return info.isDirectory()?runtimeTree(path,prefix+name+'/'):[[prefix+name,digest(readFileSync(path))] as [string,string]];});
}

export function buildCodingDockerPlan(snapshot:CodingSnapshot,pins:CodingDockerPins,context:CodingDockerContext):CodingDockerPlan {
  strictKeys(pins,['image','platform','runtimeDigest','dockerPath','dockerDigest']);
  strictKeys(context,['rootSessionId','operationKey']);
  if (pins.image!==approvedDockerImage || pins.platform!=='linux/arm64' || pins.dockerPath!==dockerBinary ||
      pins.dockerDigest!==dockerBinaryDigest || digest(readFileSync(dockerBinary))!==dockerBinaryDigest ||
      !/^[a-f0-9]{64}$/.test(pins.runtimeDigest) ||
      [context.rootSessionId,context.operationKey].some(v=>typeof v!=='string' || !v || v.length>256)) throw new Error('coding Docker pin/context mismatch');
  ownedDockerPath(snapshot.directory,true);
  ownedDockerPath(join(snapshot.directory,'capture.json'),false);
  if (JSON.stringify(JSON.parse(readFileSync(join(snapshot.directory,'capture.json'),'utf8')))!==JSON.stringify(snapshot) ||
      snapshot.kind!=='immutable_allowed_bytes_v1' || digest(JSON.stringify(snapshot.files))!==snapshot.digest) throw new Error('coding Docker capture binding mismatch');
  for(const file of snapshot.files){
    if (!allowed.includes(file.path)) throw new Error('coding Docker path escape');
    if (!file.present) continue;
    const target=join(snapshot.directory,file.path);ownedDockerPath(target,false);
    if (digest(readFileSync(target))!==file.sha256 || (lstatSync(target).mode&0o222)!==0) throw new Error('coding Docker writable/changed input');
  }
  const original=snapshot.files.find(f=>f.path==='src/selectTasks.ts');
  if (!original?.present) throw new Error('coding Docker target missing');
  const input=mkdtempSync(join(dirname(snapshot.directory),'coding-docker-input-'));
  const worker=mkdtempSync(join(dirname(snapshot.directory),'coding-docker-worker-'));
  const output=ts.transpileModule(readFileSync(join(snapshot.directory,original.path),'utf8'),
    {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  writeFileSync(join(input,'candidate.mjs'),output,{flag:'wx',mode:0o444});
  writeFileSync(join(worker,'observe.mjs'),dockerWorker,{flag:'wx',mode:0o444});
  const dependencyRoot=join(worker,'node_modules');mkdirSync(dependencyRoot,{mode:0o755});
  for(const name of quickjsPackages){
    const source=dirname(dirname(require.resolve(name)));
    cpSync(source,join(dependencyRoot,name),{recursive:true,dereference:false});
  }
  if(digest(JSON.stringify(runtimeTree(dependencyRoot)))!==quickjsDigest)throw new Error('QuickJS packaged runtime differs from pinned closure');
  chmodSync(input,0o555);chmodSync(worker,0o555); // Only isolated derived inputs; never originals.
  const owner=randomBytes(16).toString('hex');
  const mounts:Array<{source:string;target:string;readonly:true}>=[{source:input,target:'/capture',readonly:true},{source:worker,target:'/runner',readonly:true}];
  const createArgs=['create','--pull=never','--platform','linux/arm64','--name','rhythm-coding-evaluator-'+owner,
    '--label','rhythm.coding-evaluator='+owner,'--user','1000:1000','--network=none','--read-only',
    '--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=32','--cpus=1','--memory=256m','--memory-swap=256m',
    '--ulimit','core=0:0','--shm-size=8m','--tmpfs','/tmp:rw,size=16m,uid=1000,gid=1000,mode=0700,noexec,nosuid,nodev',
    '--env','HOME=/tmp','--env','NODE_ENV=production'];
  for(const mount of mounts)createArgs.push('--mount',`type=bind,src=${mount.source},dst=${mount.target},readonly`);
  createArgs.push('--entrypoint','/usr/local/bin/node',approvedDockerImage,'--frozen-intrinsics','--disable-proto=throw','/runner/observe.mjs');
  return {image:approvedDockerImage,owner,createArgs,mounts,workerSource:dockerWorker,targetDigest:digest(output),workerDigest:digest(dockerWorker),runtimeDigest:pins.runtimeDigest};
}

/** Closed raw observations, not worker claimed verdict/checks/MAC. */
export function codingDockerChecks(stdout:string):Array<{id:string;passed:boolean}> {
  if (Buffer.byteLength(stdout)>16384) throw new Error('coding Docker output overflow');
  const data=JSON.parse(stdout);
  if (!data || typeof data!=='object' || Array.isArray(data)) throw new Error('coding Docker result shape');
  strictKeys(data,Object.hasOwn(data,'runtime')?['schemaVersion','observations','runtime']:['schemaVersion','observations']);
  if (data.schemaVersion!==1 || !Array.isArray(data.observations) || data.observations.length!==criteria.length) throw new Error('coding Docker incomplete sequence');
  const tasks=[{id:'a',status:'open'},{id:'b',status:'done'},{id:'c',status:'open'}];
  const inputs=criteria.map(id=>id==='order'?[tasks[2],tasks[1],tasks[0]]:tasks);
  const expected:unknown[]=[[tasks[0],tasks[2]],[tasks[1]],tasks,[[],[]],[tasks[2],tasks[0]],null,null];
  return data.observations.map((row:Record<string,unknown>,index:number)=>{
    if (!row || typeof row!=='object' || Array.isArray(row)) throw new Error('coding Docker observation shape');
    strictKeys(row,['id','result','threw','before','after']);
    if (row.id!==criteria[index] || typeof row.threw!=='boolean' || typeof row.before!=='string' || typeof row.after!=='string' ||
        row.before.length>4096 || row.after.length>4096 || row.before!==JSON.stringify(inputs[index])) throw new Error('coding Docker unexpected observation');
    return {id:criteria[index],passed:row.threw===(criteria[index]==='unsupported_status') && row.after===row.before &&
      JSON.stringify(row.result)===JSON.stringify(expected[index])};
  });
}

export function createCodingDockerCustody(binding:Record<string,string>) {
  const required=['rootSessionId','operationKey','snapshot','target','evaluator','runner','image','runtime','containerId'];
  strictKeys(binding,required);
  if (required.some(key=>typeof binding[key]!=='string' || !binding[key])) throw new Error('coding Docker receipt binding absent');
  const fixed={...binding},key=randomBytes(32),nonce=randomBytes(32).toString('hex');let consumed=false;
  const sign=(body:string)=>createHmac('sha256',key).update(body).digest('hex');
  return {
    seal(payload:unknown){const body=JSON.stringify({binding:fixed,nonce,payload});return {binding:{...fixed},nonce,payload,mac:sign(body)};},
    consume(receipt:{binding:Record<string,string>;nonce:string;payload:unknown;mac:string}){
      if (consumed || !receipt || Object.keys(receipt).sort().join(',')!=='binding,mac,nonce,payload' || receipt.nonce!==nonce ||
          JSON.stringify(receipt.binding)!==JSON.stringify(fixed) || !/^[a-f0-9]{64}$/.test(receipt.mac)) return false;
      const expected=sign(JSON.stringify({binding:fixed,nonce,payload:receipt.payload}));
      if (!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(receipt.mac,'hex'))) return false;
      consumed=true;return true;
    },
  };
}

async function launchCodingDocker(request:CodingDockerRequest):Promise<CodingDockerResult> {
  // Exact fixed executable and owned container; no inherited context or credentials.
  // Candidate code executes only in the pinned QuickJS WASM realm.
  if (request.action==='stop' && request.containerId) {
    const info=await launchCodingDocker({...request,action:'inspect',args:['inspect',request.containerId]});
    if (info.exitCode!==0 || info.timedOut || info.overflow) return {...info,exitCode:1};
    const parsed=JSON.parse(info.stdout),row=Array.isArray(parsed)?parsed[0]:parsed;
    if (row?.Id!==request.containerId || row?.Config?.Labels?.['rhythm.coding-evaluator']!==request.plan.owner) return {...info,exitCode:1};
    if (row?.State?.Running===false) return {exitCode:0,stdout:'',stderr:''}; // already exited, no spurious kill
  }
  return await new Promise((resolve,reject)=>{
    const isolatedConfig=request.plan.mounts.find(m=>m.target==='/runner')!.source;
    const child=spawn(dockerBinary,request.args,{env:{PATH:'/usr/bin:/bin',HOME:isolatedConfig,DOCKER_CONFIG:isolatedConfig},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',overflow=false,timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},10000);
    child.stdout.on('data',b=>{stdout+=b;if(Buffer.byteLength(stdout)>16384){overflow=true;child.kill();}});
    child.stderr.on('data',b=>{stderr=(stderr+b).slice(0,2048);});
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',code=>{clearTimeout(timer);resolve({exitCode:code??-1,stdout,stderr,overflow,timedOut});});
  });
}

async function verifyCodingDockerSnapshot(snapshot:CodingSnapshot,pins:ReturnType<typeof codingEvaluatorPins>,options:CodingDockerOptions,receipt:CodingVerificationReceipt):Promise<CodingVerificationReceipt> {
  receipt.qualified=false;receipt.qualification='unverified';
  const unit=options.unitOnly===true && process.env.NODE_ENV==='test' && options.launcher!==undefined;
  if (!unit && (options.launcher || options.pins.runtimeDigest!==codingDockerRuntimeDigest)) return receipt;
  if (!codingSnapshotCurrent(snapshot)){receipt.verdict='stale';receipt.reason='workspace differs from capture';return receipt;}
  let plan:CodingDockerPlan|undefined,containerId:string|undefined,owned=false;
  const launcher=unit?options.launcher!:launchCodingDocker;
  const invoke=async(action:CodingDockerRequest['action'],args:string[])=>{
    const result=await launcher({action,args,plan:plan!,...(containerId?{containerId}: {})});
    if (result.timedOut || result.overflow || Buffer.byteLength(result.stdout)>16384 || Buffer.byteLength(result.stderr)>2048 || result.exitCode!==0) throw new Error('coding Docker '+action+' incomplete/failure');
    return result.stdout;
  };
  try {
    if (pins.evaluatorDigest!==digest(evaluator) || pins.runnerDigest!==digest(dockerWorker)) throw new Error('existing protected evaluator pin changed');
    plan=buildCodingDockerPlan(snapshot,options.pins,options.context);
    containerId=(await invoke('create',plan.createArgs)).trim();
    if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error('coding Docker invalid create identity');
    const response=JSON.parse(await invoke('inspect',['inspect',containerId]));
    const inspection=Array.isArray(response)?response.length===1?response[0]:null:response;
    if (inspection?.Id!==containerId || inspection?.Config?.Labels?.['rhythm.coding-evaluator']!==plan.owner) throw new Error('coding Docker owner identity unresolved');
    owned=true;
    const host=inspection.HostConfig;
    const env=inspection.Config.Env;
    if (inspection.Config.Image!==plan.image || inspection.Config.User!=='1000:1000' ||
        JSON.stringify(inspection.Config.Entrypoint)!=='["/usr/local/bin/node"]' ||
        JSON.stringify(inspection.Config.Cmd)!=='["--frozen-intrinsics","--disable-proto=throw","/runner/observe.mjs"]' ||
        !Array.isArray(env) || env.some((v:unknown)=>typeof v!=='string' || !['PATH','NODE_VERSION','YARN_VERSION','HOME','NODE_ENV'].includes(v.split('=')[0])) ||
        env.filter((v:string)=>v.startsWith('HOME=')).join()!=='HOME=/tmp' || env.filter((v:string)=>v.startsWith('NODE_ENV=')).join()!=='NODE_ENV=production' ||
        env.filter((v:string)=>v.startsWith('NODE_VERSION=')).join()!=='NODE_VERSION=22.23.3' ||
        host.NetworkMode!=='none' || host.ReadonlyRootfs!==true || host.Privileged!==false ||
        JSON.stringify(host.CapDrop)!=='["ALL"]' || !['no-new-privileges','no-new-privileges:true'].includes(host.SecurityOpt?.[0]) || host.SecurityOpt.length!==1 ||
        host.PidsLimit!==32 || host.NanoCpus!==1_000_000_000 || host.Memory!==268435456 || host.MemorySwap!==268435456 || host.ShmSize!==8388608 ||
        !Array.isArray(host.Ulimits) || host.Ulimits.length!==1 || host.Ulimits[0].Name!=='core' || host.Ulimits[0].Hard!==0 || host.Ulimits[0].Soft!==0 ||
        Object.keys(host.Tmpfs??{}).join()!=='/tmp' || host.Tmpfs['/tmp']!=='rw,size=16m,uid=1000,gid=1000,mode=0700,noexec,nosuid,nodev' ||
        host.Devices?.length || host.DeviceRequests?.length || host.Binds?.length || host.VolumesFrom?.length ||
        !Array.isArray(inspection.Mounts) || inspection.Mounts.length!==2 ||
        plan.mounts.some(m=>!inspection.Mounts.some((v:{Source:string;Destination:string;RW:boolean;Type:string})=>v.Source===m.source && v.Destination===m.target && !v.RW && v.Type==='bind')) ||
        ['host','container'].some(mode=>String(host.PidMode??'').startsWith(mode) || String(host.IpcMode??'').startsWith(mode)) ||
        inspection.Config.Volumes && Object.keys(inspection.Config.Volumes).length) throw new Error('coding Docker inspected boundary differs');
    const stdout=await invoke('start',['start','--attach',containerId]);
    const status=(await invoke('wait',['wait',containerId])).trim();
    if (status!=='0') throw new Error('coding Docker container exit failure');
    const checks=codingDockerChecks(stdout);
    const report=JSON.parse(stdout);
    if(!unit && (report.runtime?.node!==codingDockerRuntimeDigest || report.runtime?.quickjs!==quickjsDigest))throw new Error('protected runtime self identity mismatch');
    if (plan.mounts.some(m=>digest(readFileSync(join(m.source,m.target==='/capture'?'candidate.mjs':'observe.mjs')))!==(m.target==='/capture'?plan!.targetDigest:plan!.workerDigest))) throw new Error('coding Docker derived input changed');
    const custody=createCodingDockerCustody({...options.context,snapshot:snapshot.digest,target:plan.targetDigest,evaluator:pins.evaluatorDigest,
      runner:plan.workerDigest,image:plan.image,runtime:plan.runtimeDigest,containerId});
    receipt.authentication=custody.seal({checks});
    receipt.checks=checks;receipt.verdict=checks.every(c=>c.passed)?'passed':'failed';
    receipt.qualification=unit?'unit_mock_only':'protected_runtime_v1';
    receipt.qualified=!unit;
    receipt.reason=unit?'UNIT mocked launcher; no protected integration/candidate proof':
      null;
    if (!codingSnapshotCurrent(snapshot)){receipt.verdict='stale';receipt.qualified=false;receipt.reason='current workspace differs';}
  } catch(error){receipt.verdict='unverified';receipt.qualified=false;receipt.reason=String(error).slice(0,512);}
  finally {
    if (owned && containerId && plan) {
      try {
        await invoke('stop',['kill',containerId]);
        const ended=JSON.parse(await invoke('inspect',['inspect',containerId]));
        const stopped=Array.isArray(ended)?ended.length===1?ended[0]:null:ended;
        if (stopped?.Id!==containerId || stopped?.Config?.Labels?.['rhythm.coding-evaluator']!==plan.owner || stopped?.State?.Running!==false) {
          throw new Error('coding Docker exact owned stop not confirmed');
        }
        await invoke('remove',['rm',containerId]); // exact owned container only; captured files retained
      } catch {receipt.verdict='unverified';receipt.qualified=false;receipt.reason='exact owned container custody unresolved';}
    }
  }
  return receipt;
}
