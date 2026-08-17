/**
 * C2 — the closed ExperimentTreatmentAdapter registry (contract
 * docs/ai/contracts/issue-causal-runtime-v2.json, phase C2).
 *
 * First slice: `system-prompt-v1` is the only shipped adapter, and it accepts
 * only its exact strict spec shape — an extra/smuggled key must be refused,
 * never silently ignored.
 */

import { describe, expect, it } from 'vitest';

import { TREATMENT_ADAPTERS } from '../experiment_treatment_adapter';

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
