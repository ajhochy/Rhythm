import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, apiDelete, toolResult, toolError } from "../api_client.js";
import { registerTool } from "./_tool.js";
import {
  authorizeOutboundAction,
  scanContextContentAndRecordExternalContentTaint,
} from "../security/external_content_boundary.js";
import { trustedSecurityContext } from "../security/security_context.js";

export function registerClaudeTriggerTools(
  server: McpServer,
  apiUrl: string,
  apiToken: string,
  agentUrl = process.env.RHYTHM_AGENT_URL ?? "http://127.0.0.1:4001",
) {
  registerTool(
    server,
    "rhythm_list_pending_triggers",
    `List pending agent triggers — both human-assigned tasks and scheduler/webhook-originated jobs.
Returns an array of objects with:
  id              — trigger row ID (use with rhythm_clear_pending_trigger)
  taskId          — task UUID when triggered from the Agents tab; null for scheduled/webhook/research jobs
  taskTitle       — task title (null for non-task triggers)
  taskNotes       — task notes (null for non-task triggers)
  taskOwnerId     — owner user ID (null for non-task triggers)
  prompt          — structured prompt for scheduled/webhook/research triggers; null for task triggers
  scheduledTaskId — ID of the agent_scheduled_tasks row that fired this trigger (if scheduled)
  webhookEndpointId — ID of the agent_webhook_endpoints row (if webhook-triggered)
  allowedMcps     — array of MCP server names this run may use, or null = unrestricted
  allowedSkills   — array of skill names this run may use, or null = unrestricted
  triggeredByUserId
  createdAt`,
    {},
    async (_args, extra) => {
      try {
        const triggers = await apiGet<unknown[]>(
          apiUrl,
          apiToken,
          "/claude-triggers",
        );
        const ingress = await scanContextContentAndRecordExternalContentTaint({
          agentUrl,
          context: trustedSecurityContext(extra),
          source: "trigger.list",
          label: "user and webhook-authored pending triggers",
          rawContent: JSON.stringify(triggers, null, 2),
        });
        return ingress.blocked
          ? {
              content: [{ type: "text" as const, text: ingress.text }],
              isError: true as const,
            }
          : toolResult(ingress.text);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    "rhythm_clear_pending_trigger",
    "Remove a pending trigger from the queue (call after completing the task or job).",
    {
      id: z
        .number()
        .describe(
          "The trigger row ID returned by rhythm_list_pending_triggers.",
        ),
      approval_id: z
        .string()
        .optional()
        .describe(
          "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
        ),
    },
    async (
      { id, approval_id }: { id: number; approval_id?: string },
      extra,
    ) => {
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: "trigger.clear",
        payload: { id },
      });
      if (!gate.allowed) {
        return {
          content: [
            { type: "text" as const, text: gate.refusalMessage as string },
          ],
          isError: true as const,
        };
      }
      try {
        await apiDelete(apiUrl, apiToken, `/claude-triggers/${id}`);
        return toolResult(`Trigger ${id} cleared.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
