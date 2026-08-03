import { describe, expect, it } from 'vitest';

import { canUpdateMobileSessionState } from '../routes/mobile_gateway_routes';

describe('issue #1285 projectless desktop chat execution state', () => {
  const ownerUserId = 41;
  const routingProjectId = 'project-routing';

  it('issue-1285-c16: exact owner can update projectless state before sending', () => {
    expect(canUpdateMobileSessionState(
      { ownerUserId, projectId: null },
      ownerUserId,
      routingProjectId,
    )).toBe(true);
    expect(canUpdateMobileSessionState(
      { ownerUserId, projectId: '' },
      ownerUserId,
      routingProjectId,
    )).toBe(true);
  });

  it('keeps owner and non-null project boundaries strict', () => {
    expect(canUpdateMobileSessionState(
      { ownerUserId: ownerUserId + 1, projectId: null },
      ownerUserId,
      routingProjectId,
    )).toBe(false);
    expect(canUpdateMobileSessionState(
      { ownerUserId, projectId: 'project-other' },
      ownerUserId,
      routingProjectId,
    )).toBe(false);
    expect(canUpdateMobileSessionState(
      { ownerUserId, projectId: routingProjectId },
      ownerUserId,
      routingProjectId,
    )).toBe(true);
  });
});
