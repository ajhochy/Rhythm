import { describe, expect, it } from 'vitest';

import { blankSlateConfig } from '../../config/rhythm_config';
import { checkCapabilityStatus } from './capability_status';

describe('checkCapabilityStatus', () => {
  it('labels an explicitly disabled capability as "Disabled (intentional)" and does not count it as a failure', () => {
    const results = checkCapabilityStatus(blankSlateConfig());
    const webSearch = results.find((r) => r.label.includes('Web search'));
    expect(webSearch?.pass).toBe(true);
    expect(webSearch?.status).toBe('disabled');
  });

  it('labels an enabled core capability as ok', () => {
    const results = checkCapabilityStatus(blankSlateConfig());
    const fileOps = results.find((r) => r.label.includes('File Ops'));
    expect(fileOps?.pass).toBe(true);
    expect(fileOps?.status).toBe('ok');
  });

  it('labels an unconfigured capability distinctly from a disabled one', () => {
    const results = checkCapabilityStatus({ capabilities: {}, disabledMcpServers: [], enabledSkills: null });
    const webSearch = results.find((r) => r.label.includes('Web search'));
    expect(webSearch?.status).toBe('unconfigured');
  });
});
