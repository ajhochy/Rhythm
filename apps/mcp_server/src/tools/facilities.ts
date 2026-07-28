import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  apiGet,
  apiPost,
  toolResult,
  toolError,
  decodeHtml,
} from "../api_client.js";
import { registerTool } from "./_tool.js";
import {
  authorizeOutboundAction,
  scanContextContentAndRecordExternalContentTaint,
} from "../security/external_content_boundary.js";
import { trustedSecurityContext } from "../security/security_context.js";

export function registerFacilityTools(
  server: McpServer,
  apiUrl: string,
  apiToken: string,
  agentUrl = process.env.RHYTHM_AGENT_URL ?? "http://127.0.0.1:4001",
) {
  registerTool(
    server,
    "rhythm_list_facilities",
    "List all facilities.",
    {},
    async (_args, extra) => {
      try {
        const facilities = await apiGet<unknown[]>(
          apiUrl,
          apiToken,
          "/facilities",
        );
        const ingress = await scanContextContentAndRecordExternalContentTaint({
          agentUrl,
          context: trustedSecurityContext(extra),
          source: "facility.list",
          label: "user-authored facilities",
          rawContent: JSON.stringify(facilities, null, 2),
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
    "rhythm_create_reservation",
    "Reserve a facility for a specific time window.",
    {
      facility_id: z
        .number()
        .int()
        .describe("Facility ID (integer) to reserve."),
      title: z.string().describe("Purpose or name of the reservation."),
      requester_name: z
        .string()
        .describe("Name of the person making the reservation."),
      start_time: z
        .string()
        .describe(
          'Start time in ISO 8601 format (e.g. "2026-04-19T09:00:00").',
        ),
      end_time: z
        .string()
        .describe('End time in ISO 8601 format (e.g. "2026-04-19T12:00:00").'),
      notes: z.string().optional().describe("Optional notes."),
      approval_id: z
        .string()
        .optional()
        .describe(
          "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
        ),
    },
    async (
      {
        facility_id,
        title,
        requester_name,
        start_time,
        end_time,
        notes,
        approval_id,
      }: {
        facility_id: number;
        title: string;
        requester_name: string;
        start_time: string;
        end_time: string;
        notes?: string;
        approval_id?: string;
      },
      extra,
    ) => {
      const body = {
        title: decodeHtml(title),
        requesterName: decodeHtml(requester_name),
        startTime: start_time,
        endTime: end_time,
        ...(notes !== undefined && { notes: decodeHtml(notes) }),
      };
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: "facility-reservation.create",
        payload: { facilityId: facility_id, ...body },
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
        const reservation = await apiPost<unknown>(
          apiUrl,
          apiToken,
          `/facilities/${facility_id}/reservations`,
          body,
        );
        return toolResult(JSON.stringify(reservation, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
