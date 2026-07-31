/**
 * MSP-003 c3 contract.
 *
 * Regression caught: a desktop that attached after permission.asked or
 * question.asked only received sessions.list, so already-pending asks were
 * invisible until a new live event happened.
 */
import { describe, expect, it } from 'vitest';

import * as wsGateway from '../services/ws_gateway';

describe('MSP-003 desktop attach snapshot', () => {
  it('issue-3-c3: late desktop attach receives already-registered interactions', () => {
    const buildSnapshot = (
      wsGateway as unknown as {
        buildDesktopAttachSnapshot?: (
          sessions: unknown[],
          resumable: unknown[],
          pendingInteractions: unknown[],
        ) => Record<string, unknown>;
      }
    ).buildDesktopAttachSnapshot;

    expect(typeof buildSnapshot).toBe('function');
    const pending = [
      {
        id: 'per_late',
        kind: 'permission',
        status: 'pending',
        sessionId: 'local_late',
        sdkSessionId: 'sdk_late',
        callId: 'call_late',
        payload: { permission: 'edit' },
        resolution: null,
        error: null,
      },
    ];
    expect(buildSnapshot!([], [], pending)).toEqual({
      v: 1,
      type: 'sessions.list',
      sessions: [],
      resumable: [],
      pendingInteractions: pending,
    });
  });
});
