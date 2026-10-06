import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Buffer } from 'node:buffer';
import { z } from 'zod';

import { apiPost } from '../api_client.js';
import { authorizeOutboundAction } from '../security/external_content_boundary.js';
import { currentTrustedSecurityCall, trustedSecurityContext } from '../security/security_context.js';
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
      approval_id: z.string().optional().describe('Approval id returned by rhythm_request_approval when untrusted content requires approval.'),
    },
    async ({ goalId, approval_id }, extra) => {
      try {
        const trustedCall = currentTrustedSecurityCall();
        const gate = await authorizeOutboundAction({
          agentUrl: apiUrl,
          context: trustedSecurityContext(extra),
          approvalId: typeof approval_id === 'string' ? approval_id : undefined,
          // This is an existing async delegation action; unlike the generic
          // tool, the server derives its target and exact user goal.
          action: 'delegation.start-async',
          payload: { goalId },
        });
        if (!trustedCall || !gate.allowed) {
          return {
            content: [{ type: 'text' as const, text: gate.refusalMessage ?? 'Coordinator goal action is unavailable.' }],
            isError: true as const,
          };
        }
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
}
