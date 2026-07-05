import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { toolResult, toolError } from '../api_client.js';
import { apiGet } from '../api_client.js';
import { registerTool } from './_tool.js';

/**
 * #897 — feedback sensors. An agent calls one of these AFTER taking a
 * high-stakes action to confirm it actually landed, instead of trusting a
 * 200 response alone. Each returns a pass/fail verdict in plain text so the
 * calling agent can retry or surface an alert.
 *
 * Reuses existing read endpoints (no new backend routes) — a sensor is a
 * read + an interpretation, not new data.
 */
export function registerFeedbackSensorTools(server: McpServer, apiUrl: string, apiToken: string) {
  registerTool(
    server,
    'rhythm_verify_pco_staffing',
    'Verify that all needed positions on a Planning Center plan are filled. Call this after scheduling people to confirm the schedule actually landed. Returns pass/fail plus the list of any unfilled positions.',
    {
      service_type_id: z.string().describe('Planning Center service type id.'),
      plan_id: z.string().describe('Planning Center plan id.'),
    },
    async ({ service_type_id, plan_id }: { service_type_id: string; plan_id: string }) => {
      try {
        const unfilled = await apiGet<Array<{ teamPositionName?: string; quantity?: number }>>(
          apiUrl,
          apiToken,
          `/integrations/planning-center/api/service-types/${service_type_id}/plans/${plan_id}/needed-positions`,
        );
        if (!Array.isArray(unfilled) || unfilled.length === 0) {
          return toolResult('PASS: all needed positions for this plan are filled.');
        }
        const names = unfilled.map((p) => p.teamPositionName ?? 'unnamed position').join(', ');
        return toolResult(`FAIL: ${unfilled.length} unfilled position(s) remain: ${names}`);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    'rhythm_verify_email_sent',
    'Verify that an email actually appears in the Sent folder. Call this after rhythm_send_email to confirm delivery, not just that the API call returned 200. Matches by a query fragment (subject text or recipient).',
    {
      query: z.string().describe('Text to match, e.g. the subject line or recipient address you just sent to.'),
    },
    async ({ query }: { query: string }) => {
      try {
        const res = await apiGet<{ messages?: unknown[] } | unknown[]>(
          apiUrl,
          apiToken,
          `/integrations/google/gmail/search?q=${encodeURIComponent(`in:sent ${query}`)}`,
        );
        const messages = Array.isArray(res) ? res : (res as { messages?: unknown[] }).messages ?? [];
        if (messages.length > 0) {
          return toolResult(`PASS: found ${messages.length} matching message(s) in Sent.`);
        }
        return toolResult(`FAIL: no message matching "${query}" found in Sent — the email may not have gone out.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  registerTool(
    server,
    'rhythm_verify_task_complete',
    'Verify that a Rhythm task is actually in the completed (done) state. Call this after marking a task complete to confirm it took effect.',
    {
      task_id: z.string().describe('The Rhythm task id.'),
    },
    async ({ task_id }: { task_id: string }) => {
      try {
        const task = await apiGet<{ status?: string; title?: string }>(apiUrl, apiToken, `/tasks/${task_id}`);
        if (task.status === 'done') {
          return toolResult(`PASS: task "${task.title ?? task_id}" is done.`);
        }
        return toolResult(`FAIL: task "${task.title ?? task_id}" is in status "${task.status ?? 'unknown'}", not done.`);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  // #897 — rhythm_verify_propresenter_loaded is intentionally NOT implemented
  // here: this repo has no ProPresenter backend integration to query (no
  // route, no data source — `propresenter` is only referenced generically as
  // an external MCP server name elsewhere). Building it would mean building
  // the ProPresenter integration from scratch, which is a separate, larger
  // piece of work — left as a follow-up rather than faked with no real signal.
}
