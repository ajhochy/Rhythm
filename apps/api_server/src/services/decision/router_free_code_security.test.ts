import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { adaptRouterFreeConfig } from './router_free_config';
import { RouterFreeStateStore } from './router_free_state';
import { defaultRouterGridConfig } from './router_grid_config';
import { executePublicCoding, verifyPublicCode, type PublicCodingTask } from './router_free_public_tasks';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os';
const task: PublicCodingTask={id:'public_code',kind:'coding',label:'Public code',prompt:'Return a sum function.',classification:{tier:2,category:'coding',canQueue:false},exportName:'sum',tests:[{args:[[1,2]],expected:3}]};
const config=()=>{const c=defaultRouterGridConfig();c.free_mode={...c.free_mode,enabled:true};return c};
const store=(c=config())=>new RouterFreeStateStore({statePath:join(mkdtempSync(join(tmpdir(),'code-closed-')),'state.json'),clock:Date.now,config:adaptRouterFreeConfig(c).state});
describe('public coding fails closed without an approved OS-isolated executor',()=>{
 it('production source has no Node VM executor or dynamic provider-code execution seam',()=>{const s=readFileSync(join(__dirname,'router_free_public_tasks.ts'),'utf8');expect(s).not.toMatch(/from ['"]vm['"]|new Script\(|runInContext\(|createContext\(/);});
 it('verifier rejects code as unsupported without evaluating even a benign body',()=>{expect(verifyPublicCode(task,JSON.stringify({code:'module.exports.sum=()=>3'}))).toEqual({pass:false,checks:['untrusted_code_execution_unsupported']});});
 it('coding endpoint fails closed before any provider call or budget attempt',async()=>{const fetchImpl=vi.fn();const s=store();expect(await executePublicCoding(task,{config:config(),store:s,verifiedFreeModels:new Set(defaultRouterGridConfig().free_mode.grid.coding['2'].map(x=>x.model)),baseUrl:'http://127.0.0.1:1/v1',apiKey:'synthetic',fetchImpl:fetchImpl as never})).toEqual({kind:'held',reason:'untrusted_code_execution_unsupported'});expect(fetchImpl).not.toHaveBeenCalled();expect(s.usage()).toMatchObject({dailyCount:0,reservedCalls:0});});
});
