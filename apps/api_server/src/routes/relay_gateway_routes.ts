import { Router } from 'express';

/**
 * Phone-facing surface of the Synology relay container (RHYTHM_ROLE=relay),
 * mounted at `/relay` (docs/ai/plan-synology-relay.md). Phase 0 is the
 * deploy-verification skeleton: just enough to prove the Cloudflare path rule
 * and the LAN port route here and nowhere else.
 *
 * Phase 1 adds the uplink server, device auth against replicated verifiers,
 * the event hub SSE, and the RPC tunnel catch-all.
 */
export function createRelayGatewayRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      role: 'relay',
      // ponytail: hard false until Phase 1 wires the uplink registry.
      macOnline: false,
    });
  });

  return router;
}
