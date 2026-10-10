import { describe, expect, it } from 'vitest';
import { defaultDecisionSettings, normaliseDecisionSettings } from './decision_settings';
import { buildConfigView, mergeConfig } from './decision_config_service';

describe('G2 acceptance contract', () => {
  it('W1: legacy is the fail-safe default; grid survives normalisation and PUT/GET projection', () => {
    // Regression: silently dropping engine makes the live first prompt use the legacy router.
    expect(defaultDecisionSettings().routing).toHaveProperty('engine', 'legacy');
    expect(normaliseDecisionSettings({ routing: { engine: 'garbled' } }).routing).toHaveProperty('engine', 'legacy');
    const settings = mergeConfig(defaultDecisionSettings(), { routing: { engine: 'grid' } });
    expect(normaliseDecisionSettings(settings).routing).toHaveProperty('engine', 'grid');
    expect(buildConfigView(settings).routing).toHaveProperty('engine', 'grid');
  });
});
