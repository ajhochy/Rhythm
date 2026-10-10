import { describe, expect, it } from 'vitest';
import { defaultDecisionSettings, defaultTimeoutFor, normaliseDecisionSettings } from './decision_settings';

describe('Slice E acceptance: OpenAI Decisions settings', () => {
  it.each(['local', 'jev', 'custom', 'systemone'] as const)('E1 compatibility: %s saved settings round-trip unchanged with and without keys', (backend) => {
    for (const apiKey of ['', 'synthetic-old-key']) {
      const saved = defaultDecisionSettings();
      saved.backend = backend;
      saved.jev = { baseUrl: 'https://example.com', model: 'jev-saved', apiKey };
      saved.custom = { baseUrl: 'http://127.0.0.1:1', model: 'custom-saved', scoreScale: 'logit', apiKey };
      saved.systemone = { baseUrl: 'http://localhost:1', model: 'kev-saved', apiKey };
      saved.local = { baseUrl: 'http://127.0.0.1:2', model: 'local-saved', scoreScale: 'probability' };
      saved.timeoutMs = 2456; saved.remoteDataConsent = true;
      saved.features = { model_routing: 'on', memory_ranking: 'shadow', tool_ranking: 'off', capacity_routing: 'default' };
      saved.routing = { engine: 'legacy', scope: 'escalate_only', minConfidence: 0.8, escalateMinConfidence: 0.9, lowConfidenceTier: 'standard' };
      saved.tiers = { mode: 'manual', cheapMaxOutputUsd: 3, frontierMinOutputUsd: 30 };
      saved.tierOverrides = { 'openai/saved': 'frontier' }; saved.excludedModels = ['openai/excluded'];
      // Legacy files predate the additive section; all their existing fields must survive.
      const { openaiDecisions: _newSection, ...legacy } = saved;
      expect(normaliseDecisionSettings(JSON.parse(JSON.stringify(legacy)))).toEqual(saved);
    }
  });
  it('E1: preserves the new backend instead of silently normalizing it to local', () => {
    const settings = normaliseDecisionSettings({ backend: 'openai_decisions' });
    expect(settings.backend).toBe('openai_decisions');
    expect(settings).toHaveProperty('openaiDecisions', {
      baseUrl: 'https://api.openai.com', model: 'gpt-6-luna', apiKey: '',
    });
    expect(defaultTimeoutFor(settings.backend)).toBe(1000);
  });

  it('E1: tolerantly defaults malformed fields while preserving an explicitly cleared key', () => {
    const settings = normaliseDecisionSettings({
      backend: 'openai_decisions',
      openaiDecisions: { baseUrl: 123, model: null, apiKey: '' },
    });
    expect(settings).toHaveProperty('openaiDecisions', {
      baseUrl: 'https://api.openai.com', model: 'gpt-6-luna', apiKey: '',
    });
  });
});
