import type { CodingExecutionProfile } from '../contracts/coordinator_coding_execution_contract';
import type { ProviderSnapshot } from './opencode_client_service';

/** The engine's advertised variant drives its provider-native effort transform. No silent fallback. */
export function codingEffortVariant(expected:CodingExecutionProfile,snapshot:ProviderSnapshot):string|null {
  if(!['openai','anthropic'].includes(expected.providerId))return null;
  const models=snapshot.providers.filter(provider=>provider.id===expected.providerId)
    .flatMap(provider=>provider.models.filter(model=>model.id===expected.modelId));
  if(models.length!==1 || !models[0].variants?.includes(expected.reasoningEffort))return null;
  const model=models[0],effect=model.variantEffects?.[expected.reasoningEffort];
  const exact=expected.providerId==='openai'?model.apiNpm==='@ai-sdk/openai' && effect?.reasoningEffort===expected.reasoningEffort
    :model.apiNpm==='@ai-sdk/anthropic' && effect?.effort===expected.reasoningEffort && effect.thinkingType==='adaptive';
  return exact?expected.reasoningEffort:null;
}
