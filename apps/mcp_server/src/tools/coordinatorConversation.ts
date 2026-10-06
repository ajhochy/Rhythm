import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Buffer } from 'node:buffer';
import { z } from 'zod';

import { apiPost } from '../api_client.js';
import { currentTrustedSecurityCall } from '../security/security_context.js';
import { registerTool } from './_tool.js';

type CoordinatorStatusResponse =
  | { schemaVersion: 1; status: 'available'; text: string }
  | { schemaVersion: 1; status: 'unavailable'; text: '' };

const unavailable = () => ({
  content: [{ type: 'text' as const, text: 'Coordinator status is unavailable.' }],
  isError: true as const,
});

type CoordinatorGoalResponse = {
  schemaVersion: 1;
  status: 'started' | 'held' | 'unavailable';
  text: string;
};

function goalResponse(value: unknown): CoordinatorGoalResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 || Object.keys(record).length !== 3 ||
    (record.status !== 'started' && record.status !== 'held' && record.status !== 'unavailable') ||
    typeof record.text !== 'string' || Buffer.byteLength(record.text, 'utf8') > 600 ||
    record.text.length === 0
  ) throw new Error('invalid');
  return record as CoordinatorGoalResponse;
}

function response(value: unknown): CoordinatorStatusResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || Object.keys(record).length !== 3 ||
      (record.status !== 'available' && record.status !== 'unavailable') || typeof record.text !== 'string' ||
      Buffer.byteLength(record.text, 'utf8') > 3_800 ||
      (record.status === 'available' && record.text.length === 0) ||
      (record.status === 'unavailable' && record.text.length !== 0)) {
    throw new Error('invalid');
  }
  return record.status === 'available'
    ? { schemaVersion: 1, status: 'available', text: record.text }
    : { schemaVersion: 1, status: 'unavailable', text: '' };
}

/**
 * Current coordinator/attention data for the exact signed foreground turn.
 * The server resolves the owner/root/project/native-user-message binding; the
 * model supplies no selector and this tool cannot create work or an approval.
 */
export function registerCoordinatorConversationTools(server: McpServer, apiUrl: string, apiToken: string): void {
  registerTool(
    server,
    'rhythm_get_coordinator_status',
    'Read current authoritative Rhythm Secretary attention, finite-work, and receipt status for this signed coordinator chat turn. Read-only.',
    {},
    async () => {
      try {
        const trustedCall = currentTrustedSecurityCall();
        if (!trustedCall) return unavailable();
        const value = response(await apiPost(
          apiUrl,
          apiToken,
          '/coordinator-agent/status',
          { trustedCall },
        ));
        return value.status === 'available'
          ? { content: [{ type: 'text' as const, text: value.text }] }
          : unavailable();
      } catch {
        return unavailable();
      }
    },
  );

  registerTool(
    server,
    'rhythm_start_coordinator_goal',
    'Start exactly one previously captured Rhythm Secretary goal through the existing allowed Coding Workflow. Read rhythm_get_coordinator_status first to obtain the goal id. The server derives the target/profile/workspace and returns only a bounded dispatch acknowledgement; a child result is reviewed later in this same chat.',
    {
      goalId: z.string().describe('An existing captured goal id from rhythm_get_coordinator_status.'),
      approval_id: z.string().optional().describe('Approval id returned by rhythm_request_approval when untrusted content requires approval. If approval is needed, the held response states the exact security_action and security_payload to request it with.'),
    },
    async () => {
      try {
        // The signed envelope carries the exact `{goalId, approval_id?}` the
        // engine signed. The API's goal action endpoint proves the native
        // binding first and then consumes the approval token in the same
        // transaction as the goal reservation; there is deliberately no
        // separate consume preflight here that could burn the token early.
        const trustedCall = currentTrustedSecurityCall();
        if (!trustedCall) return unavailable();
        const result = goalResponse(await apiPost(
          apiUrl,
          apiToken,
          '/coordinator-agent/start-goal',
          { trustedCall },
        ));
        if (result.status === 'unavailable') return unavailable();
        return result.status === 'held'
          ? { content: [{ type: 'text' as const, text: result.text }], isError: true as const }
          : { content: [{ type: 'text' as const, text: result.text }] };
      } catch {
        return unavailable();
      }
    },
  );
  const boundedResponse = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid bounded response');
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 3 || record.schemaVersion !== 1 ||
        !['approval_pending','started','held'].includes(record.status as string) || typeof record.text !== 'string' ||
        !record.text || Buffer.byteLength(record.text, 'utf8') > 12_000) throw new Error('invalid bounded response');
    return { content: [{ type: 'text' as const, text: record.text }], ...(record.status === 'held' ? { isError: true as const } : {}) };
  };
  const boundedCall = async (route: string) => {
    try {
      const trustedCall = currentTrustedSecurityCall();
      if (!trustedCall) return unavailable();
      return boundedResponse(await apiPost(apiUrl, apiToken, route, { trustedCall }));
    } catch { return unavailable(); }
  };
  registerTool(server, 'rhythm_propose_bounded_coding_workflow',
    'Propose an exact finite selected-reference Coding Workflow in this primary-root chat. Discover the human-named current reference with rhythm_search_memory, carry its sourceId/version, estimate task-specific limits and explain them. Adjust requested terms with a new proposal; wait for the signed same-chat human approval card. No authority or child is created by proposing.',
    {
      goalSelector: z.string().max(4000).describe('Existing captured goal id or its exact objective from current coordinator status.'),
      referenceSelector: z.string().max(4000).describe('Human-readable discovered reference label; the server authors the canonical display.'),
      referenceSourceId: z.string().describe('Existing indexed memory:<UUID> selector from rhythm_search_memory.'),
      referenceVersion: z.string().describe('Current sha256:<file hash> version from reference discovery.'),
      estimate: z.object({ totalSoftTokens: z.number().int().min(1).max(2_000_000), workerWallSeconds: z.number().int().min(30).max(300),
        expirySeconds: z.number().int().min(30).max(3600), outerTurns: z.literal(2), rationale: z.string().min(1).max(1000) }).strict(),
    }, async () => boundedCall('/coordinator-agent/propose-workflow'));
  registerTool(server, 'rhythm_start_bounded_coding_workflow',
    'Start only the exact signed human-approved bounded workflow proposal on its dedicated native approval wake. Use approval_id and proposal_digest from that server-authored wake exactly once. Foreground, generic approval, callback, changed terms and replay hold; never treat prose as approval.',
    { approval_id: z.string().min(1).max(256), proposal_digest: z.string().regex(/^[a-f0-9]{64}$/) },
    async () => boundedCall('/coordinator-agent/start-workflow'));

}
