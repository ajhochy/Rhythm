import { createHash } from 'crypto';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { adaptRouterFreeConfig } from './router_free_config';
import { RouterFreeStateStore } from './router_free_state';
import { defaultRouterGridConfig } from './router_grid_config';
import { executePublicCoding, executePublicImageDesign, validatePublicCodingTask, validatePublicImageTask, verifyPublicCode, verifyPublicImageOutput, type PublicCodingTask, type PublicImageAsset, type PublicImageDesignTask } from './router_free_public_tasks';
const SMALL='openrouter/thinkingmachines/inkling-small:free', INKLING='openrouter/thinkingmachines/inkling:free', ULTRA='openrouter/nvidia/nemotron-3-ultra-550b-a55b:free', NANO='openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';
const config=()=>{const c=defaultRouterGridConfig();c.free_mode={...c.free_mode,enabled:true};return c};
const store=(c=config())=>new RouterFreeStateStore({statePath:join(mkdtempSync(join(tmpdir(),'free-public-')),'state.json'),clock:Date.now,config:adaptRouterFreeConfig(c).state});
const coding:PublicCodingTask={id:'sum_numbers',kind:'coding',label:'Synthetic public coding task',prompt:'Implement sumNumbers(values), returning the sum of a public array of finite numbers.',classification:{tier:2,category:'coding',canQueue:false},exportName:'sumNumbers',tests:[{args:[[1,2,3]],expected:6},{args:[[-4,4,10]],expected:10},{args:[[]],expected:0}]};
const good=JSON.stringify({code:'module.exports.sumNumbers = (values) => values.reduce((a, b) => a + b, 0);'});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=','base64');
const asset:PublicImageAsset={id:'blue_card',label:'Synthetic public blue card',mime:'image/png',base64:png.toString('base64'),sha256:createHash('sha256').update(png).digest('hex')};
const design:PublicImageDesignTask={id:'design_card',kind:'image_design',label:'Synthetic public image design task',prompt:'Return the independently specified layout fields for this public image.',imageId:asset.id,classification:{tier:3,category:'design',canQueue:false},helperRequiredTerms:['blue','square'],expected:{layout:'single square',primaryColor:'blue',headline:'none'}};
const deps=(s=store(), fetchImpl:typeof fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:good}}]}),{status:200})))=>({config:config(),store:s,verifiedFreeModels:new Set([SMALL,INKLING,ULTRA,NANO]),baseUrl:'http://127.0.0.1:1/v1',apiKey:'synthetic',fetchImpl});
describe('original Free positive public task classes',()=>{
 it('coding fails closed: provider code is never executed or fetched',async()=>{
  expect(validatePublicCodingTask(coding)).toBe(true);
  expect(verifyPublicCode(coding,good)).toEqual({pass:false,checks:['untrusted_code_execution_unsupported']});
  const f=vi.fn();const s=store();
  expect(await executePublicCoding(coding,deps(s,f as never))).toEqual({kind:'held',reason:'untrusted_code_execution_unsupported'});
  expect(f).not.toHaveBeenCalled();expect(s.usage()).toMatchObject({dailyCount:0,reservedCalls:0});
 });
 it('image asset validation checks actual bytes/hash and output oracle rejects mismatch',()=>{
  expect(validatePublicImageTask(design,asset)).toBe(true);expect(validatePublicImageTask(design,{...asset,sha256:'0'.repeat(64)})).toBe(false);
  expect(verifyPublicImageOutput(design,JSON.stringify(design.expected)).pass).toBe(true);expect(verifyPublicImageOutput(design,JSON.stringify({...design.expected,primaryColor:'red'}))).toMatchObject({pass:false});
 });
 it('case 8: T3 design with small circuit-open consumes registered image in Nano helper then Ultra medium',async()=>{
  const s=store();for(let i=0;i<3;i++)s.recordFailure(SMALL,'5xx');
  const f=vi.fn(async(_u:unknown,init?:RequestInit)=>{const b=JSON.parse(init?.body as string);const content=b.model.includes('nano-omni')?'A blue square with no text.':JSON.stringify(design.expected);return new Response(JSON.stringify({choices:[{message:{content}}]}),{status:200})});
  expect(await executePublicImageDesign(design,asset,deps(s,f))).toMatchObject({kind:'released',model:ULTRA,effort:'medium',helper:{model:NANO,verified:true},values:design.expected});
  expect(f).toHaveBeenCalledTimes(2);const h=JSON.parse((f.mock.calls[0] as unknown as [string,RequestInit])[1].body as string),a=JSON.parse((f.mock.calls[1] as unknown as [string,RequestInit])[1].body as string);
  expect(h.model).toBe('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');expect(JSON.stringify(h.messages)).toContain(`data:image/png;base64,${asset.base64}`);
  expect(a).toMatchObject({model:'nvidia/nemotron-3-ultra-550b-a55b:free',reasoning:{effort:'medium'}});expect(JSON.stringify(a.messages)).toContain('A blue square with no text.');expect(JSON.stringify(a.messages)).not.toContain(asset.base64);
 });
});
