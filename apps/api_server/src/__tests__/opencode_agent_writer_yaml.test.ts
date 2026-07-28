import { describe, expect, it } from 'vitest';
import { yamlQuotedString } from '../services/opencode_agent_writer';

describe('opencode agent writer YAML scalars', () => {
  it('quotes labels that YAML would otherwise parse as comments or structure', () => {
    expect(yamlQuotedString('#1134 live security harness')).toBe(
      '"#1134 live security harness"',
    );
    expect(yamlQuotedString('role: security\nsecond line')).toBe(
      '"role: security\\nsecond line"',
    );
  });
});
