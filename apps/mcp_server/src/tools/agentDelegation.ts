import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiPost, toolError, toolResult } from '../api_client.js';
import { registerTool } from './_tool.js';

type FetchLike = typeof fetch;

async function postDelegation(
  apiUrl: string,
  apiToken: string,
  body: unknown,
  fetchImpl?: FetchLike,
): Promise<unknown> {
  if (!fetchImpl) return apiPost(apiUrl, apiToken, '/agent-delegation/delegate', body);

  const res = await fetchImpl(`${apiUrl}/agent-delegation/delegate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Rhythm API error ${res.status}: ${text}`);
  }
  return res.json();
}

export function registerAgentDelegationTools(
  server: McpServer,
  apiUrl: string,
  apiToken: string,
  fetchImpl?: FetchLike,
) {
  registerTool(
    server,
    'rhythm_delegate',
    'Delegate a focused task from a manager profile to an allowed specialist profile. The target run is re-scoped to the target profile.',
    {
      callerAgentConfigId: z
        .string()
        .describe('The manager profile id making the delegation request.'),
      targetAgentConfigId: z
        .string()
        .describe('The specialist profile id to run. Must be in the manager allowedDelegates list.'),
      prompt: z.string().describe('The focused task prompt for the specialist.'),
      callerSessionId: z.string().optional().describe('The current manager session id, when available.'),
      depth: z.number().optional().describe('Current delegation depth. Omit for direct manager calls.'),
      context: z.string().optional().describe('Optional manager context to prepend to the delegated prompt.'),
    },
    async ({
      callerAgentConfigId,
      targetAgentConfigId,
      prompt,
      callerSessionId,
      depth = 0,
      context,
    }) => {
      try {
        const result = await postDelegation(
          apiUrl,
          apiToken,
          {
            callerAgentConfigId,
            targetAgentConfigId,
            prompt,
            callerSessionId,
            depth,
            context,
          },
          fetchImpl,
        );
        return toolResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
