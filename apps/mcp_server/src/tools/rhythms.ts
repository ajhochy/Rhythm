import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
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

const DAY_OF_WEEK_MAP: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

export function parseDayOfWeek(
  input: string | undefined,
): number | null | undefined {
  if (input === undefined) return undefined;
  const normalized = input.trim().toLowerCase();
  if (normalized in DAY_OF_WEEK_MAP) {
    return DAY_OF_WEEK_MAP[normalized];
  }
  throw new Error(
    'Invalid day_of_week: "' + input + '". Expected Sunday..Saturday.',
  );
}

export function registerRhythmTools(
  server: McpServer,
  apiUrl: string,
  apiToken: string,
  agentUrl = process.env.RHYTHM_AGENT_URL ?? "http://127.0.0.1:4001",
) {
  registerTool(
    server,
    "rhythm_list_rhythms",
    "List all recurring rules (rhythms).",
    {
      enabled_only: z
        .boolean()
        .optional()
        .describe("If true, return only enabled rhythms."),
    },
    async ({ enabled_only }: { enabled_only?: boolean }, extra) => {
      try {
        const qs = enabled_only ? "?enabled=true" : "";
        const rhythms = await apiGet<unknown[]>(
          apiUrl,
          apiToken,
          `/recurring-rules${qs}`,
        );
        const ingress = await scanContextContentAndRecordExternalContentTaint({
          agentUrl,
          context: trustedSecurityContext(extra),
          source: "rhythm.list",
          label: "user-authored recurring rules",
          rawContent: JSON.stringify(rhythms, null, 2),
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
    "rhythm_create_rhythm",
    "Create a new recurring rule. Use frequency 'annual' (not 'yearly').",
    {
      title: z.string().describe("Rhythm name."),
      frequency: z
        .enum(["weekly", "monthly", "annual"])
        .describe("Recurrence frequency: 'weekly', 'monthly', or 'annual'."),
      day_of_week: z
        .string()
        .optional()
        .describe("Day for weekly rhythms (e.g. 'Sunday', 'Monday')."),
      day_of_month: z
        .number()
        .int()
        .min(1)
        .max(31)
        .optional()
        .describe("Day of month for monthly/annual rhythms."),
      month: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe("Month (1–12) for annual rhythms only."),
      approval_id: z
        .string()
        .optional()
        .describe(
          "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
        ),
    },
    async (
      {
        title,
        frequency,
        day_of_week,
        day_of_month,
        month,
        approval_id,
      }: {
        title: string;
        frequency: string;
        day_of_week?: string;
        day_of_month?: number;
        month?: number;
        approval_id?: string;
      },
      extra,
    ) => {
      const payload = {
        title: decodeHtml(title),
        frequency,
        ...(day_of_week !== undefined && { dayOfWeek: day_of_week }),
        ...(day_of_month !== undefined && { dayOfMonth: day_of_month }),
        ...(month !== undefined && { month }),
      };
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: "rhythm.create",
        payload,
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
        const rhythm = await apiPost<unknown>(
          apiUrl,
          apiToken,
          "/recurring-rules",
          payload,
        );
        return toolResult(JSON.stringify(rhythm, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    "rhythm_update_rhythm",
    "Update an existing recurring rule.",
    {
      id: z.string().describe("Rhythm ID."),
      title: z.string().optional().describe("New title."),
      frequency: z
        .enum(["weekly", "monthly", "annual"])
        .optional()
        .describe("New frequency."),
      day_of_week: z.string().optional().describe("New day of week."),
      day_of_month: z
        .number()
        .int()
        .nullable()
        .optional()
        .describe("New day of month, or null to clear."),
      month: z
        .number()
        .int()
        .nullable()
        .optional()
        .describe("New month, or null to clear."),
      enabled: z.boolean().optional().describe("Enable or disable the rhythm."),
      approval_id: z
        .string()
        .optional()
        .describe(
          "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
        ),
    },
    async (
      {
        id,
        title,
        frequency,
        day_of_week,
        day_of_month,
        month,
        enabled,
        approval_id,
      }: {
        id: string;
        title?: string;
        frequency?: string;
        day_of_week?: string;
        day_of_month?: number | null;
        month?: number | null;
        enabled?: boolean;
        approval_id?: string;
      },
      extra,
    ) => {
      const body: Record<string, unknown> = {};
      if (title !== undefined) body.title = decodeHtml(title);
      if (frequency !== undefined) body.frequency = frequency;
      if (day_of_week !== undefined) body.dayOfWeek = day_of_week;
      if (day_of_month !== undefined) body.dayOfMonth = day_of_month;
      if (month !== undefined) body.month = month;
      if (enabled !== undefined) body.enabled = enabled;
      const payload = { id, ...body };
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: "rhythm.update",
        payload,
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
        const rhythm = await apiPatch<unknown>(
          apiUrl,
          apiToken,
          `/recurring-rules/${id}`,
          body,
        );
        return toolResult(JSON.stringify(rhythm, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    "rhythm_delete_rhythm",
    "Permanently delete a recurring rule.",
    {
      id: z.string().describe("Rhythm ID to delete."),
      approval_id: z
        .string()
        .optional()
        .describe(
          "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
        ),
    },
    async ({ id, approval_id }: { id: string; approval_id?: string }, extra) => {
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: "rhythm.delete",
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
        await apiDelete(apiUrl, apiToken, `/recurring-rules/${id}`);
        return toolResult(`Rhythm ${id} deleted.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    "rhythm_add_rhythm_step",
    "Add a step to an existing rhythm (recurring rule). Steps surface on their assigned day_of_week for weekly rhythms.",
    {
      rhythm_id: z.string().describe("Rhythm (recurring rule) ID."),
      title: z.string().describe("Step label."),
      day_of_week: z
        .string()
        .optional()
        .describe(
          "Day this step surfaces, e.g. 'Monday' (required for weekly rhythms).",
        ),
      day_of_month: z
        .number()
        .int()
        .min(1)
        .max(31)
        .optional()
        .describe("Day of month for monthly/annual rhythms."),
      month: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe("Month (1–12) for annual rhythms only."),
      sort_order: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "0-based insertion index in the steps array. Defaults to append.",
        ),
      approval_id: z
        .string()
        .optional()
        .describe(
          "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
        ),
    },
    async (
      {
        rhythm_id,
        title,
        day_of_week,
        day_of_month,
        month,
        sort_order,
        approval_id,
      }: {
        rhythm_id: string;
        title: string;
        day_of_week?: string;
        day_of_month?: number;
        month?: number;
        sort_order?: number;
        approval_id?: string;
      },
      extra,
    ) => {
      const body: Record<string, unknown> = { title: decodeHtml(title) };
      if (day_of_week !== undefined) body.day_of_week = day_of_week;
      if (day_of_month !== undefined) body.day_of_month = day_of_month;
      if (month !== undefined) body.month = month;
      if (sort_order !== undefined) body.sort_order = sort_order;
      const payload = { rhythmId: rhythm_id, ...body };
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: "rhythm-step.create",
        payload,
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
        const result = await apiPost(
          apiUrl,
          apiToken,
          `/recurring-rules/${rhythm_id}/steps`,
          body,
        );
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    "rhythm_delete_rhythm_step",
    "Delete a step from an existing rhythm by step ID.",
    {
      rhythm_id: z.string().describe("Rhythm (recurring rule) ID."),
      step_id: z.string().describe("Step ID to remove from the rhythm."),
      approval_id: z
        .string()
        .optional()
        .describe(
          "Approval id returned by rhythm_request_approval — required after reading untrusted content.",
        ),
    },
    async (
      {
        rhythm_id,
        step_id,
        approval_id,
      }: { rhythm_id: string; step_id: string; approval_id?: string },
      extra,
    ) => {
      const gate = await authorizeOutboundAction({
        agentUrl,
        context: trustedSecurityContext(extra),
        approvalId: approval_id,
        action: "rhythm-step.delete",
        payload: { rhythmId: rhythm_id, stepId: step_id },
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
        const rhythm = await apiGet<{
          id: string;
          steps?: Array<{
            id: string;
            title: string;
            assigneeId: number | null;
            dayOfWeek: number | null;
            dayOfMonth: number | null;
            month: number | null;
          }>;
          [k: string]: unknown;
        }>(apiUrl, apiToken, `/recurring-rules/${rhythm_id}`);
        const filtered = (rhythm.steps ?? []).filter((s) => s.id !== step_id);
        if (filtered.length === (rhythm.steps?.length ?? 0)) {
          return toolError(
            new Error(`Step ${step_id} not found on rhythm ${rhythm_id}.`),
          );
        }
        await apiPatch(apiUrl, apiToken, `/recurring-rules/${rhythm_id}`, {
          steps: filtered,
        });
        return toolResult(`Step ${step_id} removed from rhythm ${rhythm_id}.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
