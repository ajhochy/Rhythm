import { createHash } from 'node:crypto';
import type { InjectionMatch } from './context_scanner.js';
import type { TrustedSecurityContext } from './security_context.js';

export type SecurityAction = 'email.send' | 'message.send' | 'message-thread.create';

interface BoundaryResult {
  allowed: boolean;
  refusalMessage?: string;
}

function sanitizedDiagnostics(matches: InjectionMatch[]) {
  return matches.map(({ patternId, class: patternClass, description }) => ({
    patternId,
    class: patternClass,
    description,
  }));
}

export async function recordExternalContentTaint(args: {
  agentUrl: string;
  context: TrustedSecurityContext;
  source: 'gmail.search' | 'gmail.message';
  rawContent: string;
  blocked: boolean;
  matches: InjectionMatch[];
}): Promise<void> {
  const res = await fetch(`${args.agentUrl}/agent-approvals/external-content/taint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: args.context,
      source: args.source,
      contentDigest: createHash('sha256').update(args.rawContent).digest('hex'),
      blocked: args.blocked,
      diagnostics: sanitizedDiagnostics(args.matches),
    }),
  });
  if (!res.ok) {
    throw new Error(`agent server refused external-content taint (${res.status})`);
  }
}

export async function authorizeOutboundAction(args: {
  agentUrl: string;
  context: TrustedSecurityContext | null;
  approvalId?: string;
  action: SecurityAction;
  payload: Record<string, unknown>;
}): Promise<BoundaryResult> {
  if (!args.context) {
    return {
      allowed: false,
      refusalMessage:
        'Blocked: trusted Rhythm session/turn metadata is unavailable. Outbound actions fail closed.',
    };
  }

  try {
    const res = await fetch(`${args.agentUrl}/agent-approvals/consume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: args.context,
        approvalId: args.approvalId,
        action: args.action,
        payload: args.payload,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && body.allowed === true) return { allowed: true };
    return {
      allowed: false,
      refusalMessage:
        typeof body.error === 'string'
          ? `Blocked: ${body.error}`
          : `Blocked: outbound approval authorization failed (${res.status}).`,
    };
  } catch (err) {
    return {
      allowed: false,
      refusalMessage:
        `Blocked: outbound approval authorization failed ` +
        `(${err instanceof Error ? err.message : String(err)}). Failing closed.`,
    };
  }
}
