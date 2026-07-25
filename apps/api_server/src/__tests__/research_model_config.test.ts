import { describe, expect, it } from 'vitest';
import { parseResearchModel } from '../config/env';

describe('RHYTHM_RESEARCH_MODEL', () => {
  it('defaults to no override when absent', () => {
    expect(parseResearchModel(undefined)).toBeNull();
    expect(parseResearchModel('   ')).toBeNull();
  });

  it('splits OpenRouter nested model IDs at only the first slash', () => {
    expect(parseResearchModel('openrouter/openrouter/free')).toEqual({
      providerID: 'openrouter', modelID: 'openrouter/free',
    });
  });

  it('rejects malformed values without echoing their value', () => {
    expect(() => parseResearchModel('openrouter')).toThrow(
      'Invalid RHYTHM_RESEARCH_MODEL. Expected a non-empty provider/modelId',
    );
    expect(() => parseResearchModel('/free')).toThrow(/Invalid RHYTHM_RESEARCH_MODEL/);
    expect(() => parseResearchModel('openrouter/')).toThrow(/Invalid RHYTHM_RESEARCH_MODEL/);
  });
});
