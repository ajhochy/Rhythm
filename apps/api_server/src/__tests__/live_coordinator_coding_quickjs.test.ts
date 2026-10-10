import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureCodingSnapshot, codingEvaluatorPins, codingDockerPins, codingDockerRuntimeDigest, verifyCodingSnapshot } from '../services/coordinator_coding_artifact_verifier';

const good = `export function selectTasks(tasks,status){if(status===undefined)return tasks.slice();if(status!=='open'&&status!=='done')throw Error('unsupported');return tasks.filter(t=>t.status===status)}`;
const live = process.env.RHYTHM_LIVE_CODING_DOCKER === '1';
async function run(source: string) {
  const root=mkdtempSync('/private/tmp/rhythm-quickjs-adversarial-'),workspace=join(root,'workspace'),artifacts=join(root,'artifacts');
  mkdirSync(join(workspace,'src'),{recursive:true});mkdirSync(artifacts);
  writeFileSync(join(workspace,'src/selectTasks.ts'),source);
  const snapshot=await captureCodingSnapshot(workspace,['src/selectTasks.ts'],artifacts);
  const receipt=await verifyCodingSnapshot(snapshot,codingEvaluatorPins(),{docker:{pins:codingDockerPins(codingDockerRuntimeDigest),
    context:{rootSessionId:'adversarial-test-owned',operationKey:root}}});
  return {receipt,snapshot}; // Inputs/receipts retained for independent review, never original user files.
}

describe.skipIf(!live)('actual Docker restricted QuickJS boundary',()=>{
  it('evaluates seven independent criteria through actual immutable source',async()=>{
    const {receipt}=await run(good);
    expect(receipt.qualified).toBe(true);expect(receipt.verdict).toBe('passed');
    expect(receipt.checks).toHaveLength(7);expect(receipt.checks.every(c=>c.passed)).toBe(true);
  },30000);
  it.each([
    ['wrong function',`export const selectTasks=(tasks)=>tasks;`],
    ['stdout forgery',`process.stdout.write(JSON.stringify({schemaVersion:1,observations:[],runtime:{}}));process.exit(0);export const selectTasks=()=>[];`],
    ['early exit',`export function selectTasks(){process.exit(0)}`],
    ['filesystem import',`import fs from 'node:fs';fs.writeFileSync('/tmp/forged','yes');export const selectTasks=()=>[];`],
    ['proc fd forgery',`import fs from 'node:fs';fs.writeFileSync('/proc/self/fd/1','forged');export const selectTasks=()=>[];`],
    ['host constructor access',`export function selectTasks(){return globalThis.constructor.constructor('return process')().stdout.write('forged')}`],
    ['intrinsics mutation',`JSON.stringify=()=> 'forged';Object.keys=()=>[];export const selectTasks=()=>[];`],
    ['toJSON forgery',`export function selectTasks(){return {toJSON(){return [{id:'a',status:'open'},{id:'c',status:'open'}]}}}`],
    ['input mutation',`export function selectTasks(tasks,status){if(status===undefined)return tasks;if(status!=='open'&&status!=='done')throw Error();const out=tasks.filter(t=>t.status===status);tasks[0].id='mutated';return out}`],
    ['unbounded CPU',`export function selectTasks(){while(true){}}`],
    ['allocation exhaustion',`export function selectTasks(){const values=[];for(;;)values.push('x'.repeat(1000000))}`],
  ])('refuses hostile %s rather than accepting a claimed result',async(_name,source)=>{
    const {receipt}=await run(source);
    expect(['failed','unverified']).toContain(receipt.verdict);
    expect(receipt.checks.some(c=>!c.passed)||receipt.checks.length===0).toBe(true);
  },30000);
  it('marks changed current source stale without blessing older capture',async()=>{
    const {snapshot}=await run(good);writeFileSync(join(snapshot.root,'src/selectTasks.ts'),'export const selectTasks=()=>[]');
    const receipt=await verifyCodingSnapshot(snapshot,codingEvaluatorPins(),{docker:{pins:codingDockerPins(codingDockerRuntimeDigest),
      context:{rootSessionId:'adversarial-test-owned',operationKey:'stale-source'}}});
    expect(receipt.verdict).toBe('stale');expect(receipt.qualified).toBe(false);
  },30000);
});
