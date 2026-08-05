import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolResult, toolError } from "../api_client.js";
import { registerTool } from "./_tool.js";
import { trustedSecurityContext } from "../security/security_context.js";
import {
  SECURITY_ACTIONS,
  type SecurityAction,
} from "../security/external_content_boundary.js";

export function registerAgentApprovalTools(
  server: McpServer,
  agentUrl: string,
) {
  registerTool(
    server,
    "rhythm_request_approval",
    "Request human approval before taking an irreversible or consequential action. After external content was read, security_action and security_payload are REQUIRED and must exactly match the eventual protected mutation. Security-bound requests never auto-approve. If status is pending, stop until a human approves it.",
    {
      action: z
        .string()
        .max(200)
        .describe(
          'Short description of the action, e.g. "Schedule Jane Doe as Worship Leader for 2026-07-12".',
        ),
      preview: z
        .string()
        .max(2000)
        .optional()
        .describe(
          "What exactly will happen — the concrete change/payload, in plain language.",
        ),
      consequence: z
        .string()
        .max(500)
        .optional()
        .describe(
          'Why this matters / what happens if it goes wrong, e.g. "Jane will receive a scheduling email immediately."',
        ),
      sessionId: z
        .string()
        .optional()
        .describe("The current agent session id, if known."),
      agentConfigId: z
        .string()
        .optional()
        .describe(
          "The current agent profile id — used to check per-profile auto-approve.",
        ),
      security_action: z
        .enum(SECURITY_ACTIONS)
        .optional()
        .describe(
          "For an outbound action after external content, the exact protected action.",
        ),
      security_payload: z
        .record(z.unknown())
        .optional()
        .describe(
          "For a protected outbound action, the exact JSON payload that will be sent.",
        ),
    },
    async (
      {
        action,
        preview,
        consequence,
        sessionId,
        agentConfigId,
        security_action,
        security_payload,
      }: {
        action: string;
        preview?: string;
        consequence?: string;
        sessionId?: string;
        agentConfigId?: string;
        security_action?: SecurityAction;
        security_payload?: Record<string, unknown>;
      },
      extra,
    ) => {
      try {
        const isSecurityBound =
          security_action !== undefined || security_payload !== undefined;
        if (isSecurityBound && (!security_action || !security_payload)) {
          throw new Error(
            "security_action and security_payload must be supplied together",
          );
        }
        const context = isSecurityBound ? trustedSecurityContext(extra) : null;
        if (isSecurityBound && !context) {
          throw new Error(
            "trusted Rhythm session/turn metadata is required for protected approval requests",
          );
        }
        const res = await fetch(`${agentUrl}/agent-approvals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            preview,
            consequence,
            sessionId,
            agentConfigId,
            ...(isSecurityBound && {
              security: {
                context,
                action: security_action,
                payload: security_payload,
              },
            }),
          }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          throw new Error(
            `Rhythm agent server returned ${res.status}: ${String(err.error ?? res.statusText)}`,
          );
        }
        const data = (await res.json()) as { id: string; status: string };
        if (data.status === "not_required") {
          // The session has consumed no external content, so the outbound gate
          // will allow this action without a token. Be unambiguous that the
          // agent should carry on — the previous behavior here was a 409 that
          // read as a refusal and caused agents to abandon the work entirely.
          return toolResult(
            "No approval is required for this action — this session has not " +
              "consumed external content. Proceed with the action now, and do " +
              "NOT pass an approval_id.",
          );
        }
        if (data.status === "approved") {
          return toolResult(
            `Approved automatically (id=${data.id}) — this profile is configured to auto-approve. You may proceed with the action.`,
          );
        }
        return toolResult(
          `Approval request created (id=${data.id}), status: pending. STOP here — do not perform the action until a human approves it in Rhythm. Check back later or wait for the user to confirm.`,
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
