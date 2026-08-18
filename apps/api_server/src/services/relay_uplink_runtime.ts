import type { RelayUplinkClient } from './relay_uplink_client';

/**
 * Holder for the Mac's singleton uplink client
 * (docs/ai/plan-synology-relay.md). server.ts sets it at startup when
 * RHYTHM_RELAY_URLS is configured; the pairing service and stream bridge read
 * it through the getter so neither imports server wiring (no cycles). Null on
 * relay/cloud roles and whenever no relay is configured.
 */
let client: RelayUplinkClient | null = null;

export function setRelayUplinkClient(value: RelayUplinkClient | null): void {
  client = value;
}

export function getRelayUplinkClient(): RelayUplinkClient | null {
  return client;
}
