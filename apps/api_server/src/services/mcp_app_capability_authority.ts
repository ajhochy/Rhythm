import { createHash } from 'crypto';
import type { McpAppCapabilityBinding } from './mcp_app_capability_broker';
import { McpAppCapabilityDenied } from './mcp_app_capability_broker';

interface PersistedOrigin {
  sessionID: string;
  callID: string;
  serverName: string;
  cwd: string;
  resourceUri: string;
  advertisedAt: string;
  expiresAt: string;
}

const ISO_ZULU = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function deriveMcpAppCapabilityBinding(args: {
  messages: unknown[];
  sdkSessionId: string;
  callId: string;
  cwd: string;
  resourceText: string;
  now?: number;
}): McpAppCapabilityBinding & { originExpiresAt: number } {
  if (process.env.RHYTHM_MCP_APPS_MODE !== 'interactive') {
    throw new McpAppCapabilityDenied();
  }
  const origin = findOrigin(args.messages, args.callId);
  const now = args.now ?? Date.now();
  const expiresAt = Date.parse(origin.expiresAt);
  if (
    origin.sessionID !== args.sdkSessionId ||
    origin.callID !== args.callId ||
    origin.cwd !== args.cwd ||
    !origin.serverName ||
    !origin.resourceUri ||
    !ISO_ZULU.test(origin.advertisedAt) ||
    !ISO_ZULU.test(origin.expiresAt) ||
    !Number.isFinite(expiresAt) ||
    now >= expiresAt
  ) {
    throw new McpAppCapabilityDenied();
  }
  let resource: URL;
  try {
    resource = new URL(origin.resourceUri);
  } catch {
    throw new McpAppCapabilityDenied();
  }
  if (resource.protocol !== 'ui:') throw new McpAppCapabilityDenied();

  return {
    sessionId: args.sdkSessionId,
    callId: args.callId,
    serverName: origin.serverName,
    resourceUri: origin.resourceUri,
    mode: 'interactive',
    contentHash: `sha256:${createHash('sha256').update(args.resourceText, 'utf8').digest('hex')}`,
    originExpiresAt: expiresAt,
  };
}

function findOrigin(messages: unknown[], callId: string): PersistedOrigin {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex] as Record<string, unknown>;
    const parts = message?.parts;
    if (!Array.isArray(parts)) continue;
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const part = parts[partIndex] as Record<string, unknown>;
      const state = part?.state as Record<string, unknown> | undefined;
      if (
        part?.type !== 'tool' ||
        part?.callID !== callId ||
        state?.status !== 'completed' ||
        !state.mcpAppResource ||
        typeof state.mcpAppResource !== 'object'
      ) {
        continue;
      }
      return state.mcpAppResource as unknown as PersistedOrigin;
    }
  }
  throw new McpAppCapabilityDenied();
}
