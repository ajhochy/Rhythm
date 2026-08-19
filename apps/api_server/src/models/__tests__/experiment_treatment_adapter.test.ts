/**
 * C2 — the closed ExperimentTreatmentAdapter registry (contract
 * docs/ai/contracts/issue-causal-runtime-v2.json, phase C2).
 *
 * First slice: `system-prompt-v1` is the only shipped adapter, and it accepts
 * only its exact strict spec shape — an extra/smuggled key must be refused,
 * never silently ignored.
 */

import { describe, expect, it } from 'vitest';

import { TREATMENT_ADAPTERS, validateStrictRefineConfigChange } from '../experiment_treatment_adapter';

describe('TREATMENT_ADAPTERS (system-prompt-v1)', () => {
  it('rejects a spec carrying an extra/smuggled key', () => {
    const adapter = TREATMENT_ADAPTERS['system-prompt-v1'];
    const result = adapter.validate({
      agentConfigId: 'agent-1',
      field: 'system_prompt',
      priorValue: 'you are a helpful assistant',
      currentValue: 'you are a helpful assistant',
      candidateValue: 'you are a careful, precise assistant',
      evidenceTarget: { ref: 'agent_configs/agent-1', hash: 'sha256:abc' },
      extraSmuggledKey: 'nope',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasons.join(' ')).toContain('extraSmuggledKey');
    }
  });
});

/**
 * C2-B — the strict `refine-config` changeJson binding a reservable/preparable
 * system-prompt-v1 treatment must be backed by. Closed shape: outer object
 * carries ONLY `configPatch`; `configPatch` carries EXACTLY
 * `{ agentConfigId, field, value }`. No unsupported/smuggled keys anywhere.
 */
describe('validateStrictRefineConfigChange', () => {
  function validPatch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      configPatch: {
        agentConfigId: 'agent-1',
        field: 'system_prompt',
        value: 'you are the refined candidate assistant',
        ...overrides,
      },
    };
  }

  it('accepts the exact strict shape', () => {
    const result = validateStrictRefineConfigChange(validPatch());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.patch).toEqual({
        agentConfigId: 'agent-1',
        field: 'system_prompt',
        value: 'you are the refined candidate assistant',
      });
    }
  });

  it('rejects a non-object payload', () => {
    expect(validateStrictRefineConfigChange('not-an-object').valid).toBe(false);
    expect(validateStrictRefineConfigChange(null).valid).toBe(false);
    expect(validateStrictRefineConfigChange([]).valid).toBe(false);
  });

  it('rejects an outer object carrying an extra/smuggled key alongside configPatch', () => {
    const result = validateStrictRefineConfigChange({
      ...validPatch(),
      diagnosis: 'root cause prose the LLM produced',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reasons.join(' ')).toContain('diagnosis');
  });

  it('rejects a missing configPatch', () => {
    const result = validateStrictRefineConfigChange({});
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reasons.join(' ')).toMatch(/configPatch/);
  });

  it('rejects a configPatch carrying an extra/smuggled key', () => {
    const result = validateStrictRefineConfigChange(validPatch({ concreteFix: 'do the thing' }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reasons.join(' ')).toContain('concreteFix');
  });

  it('rejects a field other than system_prompt', () => {
    const result = validateStrictRefineConfigChange(validPatch({ field: 'model' }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reasons.join(' ')).toMatch(/system_prompt/);
  });

  it('rejects a non-string value', () => {
    const result = validateStrictRefineConfigChange(validPatch({ value: 42 }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reasons.join(' ')).toMatch(/value/);
  });

  it('rejects an empty agentConfigId', () => {
    const result = validateStrictRefineConfigChange(validPatch({ agentConfigId: '' }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reasons.join(' ')).toMatch(/agentConfigId/);
  });
});
