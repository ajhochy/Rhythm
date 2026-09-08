/**
 * Pre-implementation red contract for the new route's authentication boundary.
 * No database fixture, mock authentication, or application process is involved.
 * The required live suite repeats these assertions against the sandbox engine.
 */
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startTestServer } from './helpers/real_server';

describe('Org Reviewer authentication route contract', () => {
  let baseUrl = '';
  let close: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    vi.stubEnv('AGENT_LOCAL', 'true');
    const { default: router } = await import('../routes/org_proposals_routes');
    const { errorHandler } = await import('../middleware/error_handler');
    const app = express();
    app.use(express.json());
    app.use('/agent-org-proposals', router);
    app.use(errorHandler);
    ({ baseUrl, close } = await startTestServer(app));
  });

  afterAll(async () => {
    await close?.();
    vi.unstubAllEnvs();
  });

  it('org-reviewer-c12: proposal submission requires authenticated reviewer authority', async () => {
    // Regression: carrying the existing router's AGENT_LOCAL bypass into this
    // seam lets any localhost caller manufacture suggestions. A missing route
    // also fails (404 is not successful authentication enforcement).
    const bodies = [
      {},
      { trustedCall: null },
      {
        trustedCall: {
          context: { sdkSessionId: 'forged', agentName: 'org-reviewer', turnId: 'forged', toolCallId: 'forged' },
          proof: { algorithm: 'Ed25519', signature: 'forged', toolName: 'rhythm_submit_org_review_proposal' },
          arguments: { status: 'approved', ownerUserId: 1 },
        },
      },
    ];
    for (const body of bodies) {
      const response = await fetch(`${baseUrl}/agent-org-proposals/reviewer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer fabricated-reviewer-token' },
        body: JSON.stringify(body),
      });
      expect([401, 403], await response.text()).toContain(response.status);
    }
  });

  it('org-reviewer-c13: review context requires authenticated reviewer authority', async () => {
    // Regression: transcript/config reads using the local operator bypass
    // disclose organizational evidence to an unrelated agent or local caller.
    const response = await fetch(`${baseUrl}/agent-org-proposals/reviewer/context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ windowDays: 7, sessionLimit: 40 }),
    });
    expect([401, 403], await response.text()).toContain(response.status);
  });
});
