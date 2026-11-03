import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiPost, toolResult, toolError } from '../api_client.js';
import { registerTool } from './_tool.js';

export function registerUpdateSubscriptionTools(server: McpServer, agentUrl: string, token: string): void {
  const source = {sourceKind:z.enum(['agent_session','workflow_run']),sourceId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)};
  registerTool(server,'rhythm_subscribe_updates',
    'Subscribe to updates from an existing owned Rhythm agent session or canonical workflow run, linked to a saved Hermes conversation. Does not dispatch agents, grant actions, or approve cards. Agent-session runId is compatibility identity, not verified workflow success.',
    {...source,hermesSessionId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),profile:z.literal('default').default('default')},
    async (body: {sourceKind:'agent_session'|'workflow_run';sourceId:string;hermesSessionId:string;profile:string}) => {
      try { return toolResult(JSON.stringify(await apiPost(agentUrl,token,'/hermes-notify/subscriptions',body))); }
      catch(error){return toolError(error);}
    });
  registerTool(server,'rhythm_unsubscribe_updates','Disable only the owner’s existing source subscription. Durable events and immutable conversation binding remain; no source is cancelled.',source,
    async (body: {sourceKind:'agent_session'|'workflow_run';sourceId:string}) => {
      try { return toolResult(JSON.stringify(await apiPost(agentUrl,token,'/hermes-notify/subscriptions/disable',body))); }
      catch(error){return toolError(error);}
    });
}
