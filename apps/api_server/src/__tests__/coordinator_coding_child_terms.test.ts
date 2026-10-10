import { expect,it } from 'vitest';
import { CoordinatorCodingExecutionService } from '../services/coordinator_coding_execution_service';
import { codingTerms } from './helpers/coding_terms';
const service=Object.create(CoordinatorCodingExecutionService.prototype);
const terms=codingTerms().chain.worker;
const base={name:'Async delegation (@coding-agent subagent)',agentKind:'coding-agent',profileId:'coding-agent',mcpRole:'coding-agent',providerId:terms.providerId,modelId:terms.modelId,modelMode:'fixed',routerVariant:terms.reasoningEffort};
const current=(row:unknown)=>(service as any).childTermsCurrent(row,terms);
it('selected profile takes precedence over matching legacy scope and cannot drift to a broader child',()=>{
  expect(current(base)).toBe(true);
  expect(current({...base,profileId:'broader-profile'})).toBe(false);
  expect(current({...base,profileId:null})).toBe(true);
  expect(current({...base,profileId:null,mcpRole:'broader-profile'})).toBe(false);
});
it.each(['providerId','modelId','modelMode','routerVariant'])('current child %s override cannot retain signed role authority',field=>{
  expect(current({...base,[field]:'different'})).toBe(false);
});

it.each(['write','apply_patch'])('native %s hard deny survives its edit permission alias',nativeTool=>{
  const authority={mode:'plan',policies:[{edit:'ask',[nativeTool]:'deny'}],chain:[]};
  expect(service.operationPolicyAction(authority,{kind:'edit',path:'/private/tmp/unit/src/selectTasks.ts',cwd:'/private/tmp/unit',nativeTool})).toBe('deny');
});
it('missing persisted native identity cannot acquire a coding once reply',()=>{
  expect(service.operationPolicyAction({mode:'plan',policies:[],chain:[]},{kind:'edit',path:'/private/tmp/unit/src/selectTasks.ts',cwd:'/private/tmp/unit'})).toBe('deny');
});
