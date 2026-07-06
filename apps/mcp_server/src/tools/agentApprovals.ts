import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';

export function registerAgentApprovalTools(server: McpServer, agentUrl: string) {
  registerTool(
    server,
    'rhythm_request_approval',
    'Request human approval before taking an irreversible, high-stakes action (scheduling a volunteer, sending an email, updating a PCO plan item). Call this BEFORE performing the action, not after. Writes a pending approval card to the Rhythm notification panel and returns immediately with status "pending" or "approved" (if the current agent profile is configured to auto-approve). Do NOT perform the action until you have confirmed approval — if this returns "pending", stop and tell the user you are waiting on their approval.',
    {
      action: z.string().max(200).describe('Short description of the action, e.g. "Schedule Jane Doe as Worship Leader for 2026-07-12".'),
      preview: z.string().max(2000).optional().describe('What exactly will happen — the concrete change/payload, in plain language.'),
      consequence: z.string().max(500).optional().describe('Why this matters / what happens if it goes wrong, e.g. "Jane will receive a scheduling email immediately."'),
      sessionId: z.string().optional().describe('The current agent session id, if known.'),
      agentConfigId: z.string().optional().describe('The current agent profile id — used to check per-profile auto-approve.'),
    },
    async ({ action, preview, consequence, sessionId, agentConfigId }: {
      action: string;
      preview?: string;
      consequence?: string;
      sessionId?: string;
      agentConfigId?: string;
    }) => {
      try {
        const res = await fetch(`${agentUrl}/agent-approvals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, preview, consequence, sessionId, agentConfigId }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          throw new Error(`Rhythm agent server returned ${res.status}: ${String(err.error ?? res.statusText)}`);
        }
        const data = (await res.json()) as { id: string; status: string };
        if (data.status === 'approved') {
          return toolResult(`Approved automatically (id=${data.id}) — this profile is configured to auto-approve. You may proceed with the action.`);
        }
        return toolResult(`Approval request created (id=${data.id}), status: pending. STOP here — do not perform the action until a human approves it in Rhythm. Check back later or wait for the user to confirm.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
