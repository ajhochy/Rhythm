import { afterEach,expect,it,vi } from 'vitest';
import { codingEffortVariant } from '../services/coordinator_coding_effort';
import { OpencodeClientService } from '../services/opencode_client_service';
import { codingTerms } from './helpers/coding_terms';
const terms=codingTerms().chain.worker;
const snapshot=(provider=terms.providerId,variants=[terms.reasoningEffort])=>({providers:[{id:provider,connected:true,digest:'unit',models:[{id:terms.modelId,variants,apiNpm:provider==='anthropic'?'@ai-sdk/anthropic':'@ai-sdk/openai',variantEffects:Object.fromEntries(variants.map(v=>[v,provider==='anthropic'?{effort:v,thinkingType:'adaptive'}:{reasoningEffort:v}]))}]}],defaults:{}});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it.each(['openai','anthropic'])('selects advertised %s engine variant instead of assuming profile effort projection',provider=>{
  expect(codingEffortVariant({...terms,providerId:provider},snapshot(provider))).toBe(terms.reasoningEffort);
  expect(codingEffortVariant({...terms,providerId:provider},snapshot(provider,['low']))).toBeNull();
});
it('unsupported provider and ambiguous model projection hold exact coding effort',()=>{
  expect(codingEffortVariant({...terms,providerId:'custom'},snapshot('custom'))).toBeNull();
  const duplicate=snapshot();duplicate.providers.push(duplicate.providers[0]);
  expect(codingEffortVariant(terms,duplicate)).toBeNull();
});
it.each([null,[],{bad:true},{ses_worker_unit:null},{ses_worker_unit:{type:'unknown'}},{ses_worker_unit:{type:3}},{error:{type:'busy'}},{ses_worker_unit:{type:'retry'}},{ses_worker_unit:{type:'retry',attempt:-1,next:5,message:'x'}},{ses_worker_unit:{type:'retry',attempt:1,next:'soon',message:'x'}}])('strict native status rejects malformed envelope/entries %j',async data=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>data})));
  await expect(OpencodeClientService.prototype.getSessionStatuses.call({serverUrl:'http://unit.invalid'} as any,'/private/tmp/unit',true)).rejects.toThrow('owned session status invalid');
  vi.unstubAllGlobals();
});
it('complete status map permits omitted bound idle while retaining other native busy/retry rows',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({ses_other_unit:{type:'busy'},ses_retry_unit:{type:'retry',attempt:1,next:5,message:'UNIT retry'}})})));
  const map=await OpencodeClientService.prototype.getSessionStatuses.call({serverUrl:'http://unit.invalid'} as any,'/private/tmp/unit',true);
  expect(map.ses_worker_unit).toBeUndefined();expect(map.ses_other_unit.type).toBe('busy');
  vi.unstubAllGlobals();
});

it.each(['openai','anthropic'])('variant-name %s override cannot substitute a lower effective effort',provider=>{
  const lower=snapshot(provider);const effect=lower.providers[0].models[0].variantEffects[terms.reasoningEffort];
  if(provider==='openai')(effect as any).reasoningEffort='low';else (effect as any).effort='low';
  expect(codingEffortVariant({...terms,providerId:provider},lower)).toBeNull();
});
it('foreign SDK adapter and nonadaptive Anthropic mapping cannot qualify exact effort',()=>{
  const wrong=snapshot();wrong.providers[0].models[0].apiNpm='@ai-sdk/custom';expect(codingEffortVariant(terms,wrong)).toBeNull();
  const anthro=snapshot('anthropic');(anthro.providers[0].models[0].variantEffects[terms.reasoningEffort] as any).thinkingType='enabled';
  expect(codingEffortVariant({...terms,providerId:'anthropic'},anthro)).toBeNull();
});

it.each([terms.reasoningEffort,'low'])('actual provider metadata projection preserves effective effort %s and strips unrelated options',async actualEffort=>{
  const client=Object.create(OpencodeClientService.prototype);
  client.authStore={listAuthedProviders:()=>['openai']};
  client.client={config:{providers:async()=>({data:{providers:[{id:'openai',models:{[terms.modelId]:{id:terms.modelId,api:{id:terms.modelId,npm:'@ai-sdk/openai'},variants:{[terms.reasoningEffort]:{reasoningEffort:actualEffort,arbitraryPrivateOption:'UNIT_NOT_PUBLIC'}}}}}]}})}};
  const projected=await client.providerSnapshot();
  expect(projected.providers[0].models[0].variantEffects[terms.reasoningEffort]).toEqual({reasoningEffort:actualEffort});
  expect(JSON.stringify(projected)).not.toContain('UNIT_NOT_PUBLIC');
  expect(codingEffortVariant(terms,projected)).toBe(actualEffort===terms.reasoningEffort?terms.reasoningEffort:null);
});
