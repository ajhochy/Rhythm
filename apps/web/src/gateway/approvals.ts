import type { GatewayMode } from '.';
import { humanApprovalCapability } from '../security/humanApprovalSigner';

// apps/api_server/src/controllers/agent_approvals_controller.ts:118-186
// apps/api_server/src/routes/agent_approvals_routes.ts:40-53
// apps/api_server/src/security/human_approval_security.ts:13-15,60-72,127-152
export interface PendingApproval {
  id: string;
  sessionId: string | null;
  action: string;
  preview: string | null;
  consequence: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decisionNonce: string | null;
  payloadDigest: string | null;
}

// The P-256 decision signature over {approvalId,status,decisionNonce,payloadDigest}
// (and the desktop-Keychain `X-Rhythm-Human-Approval` capability header the server also
// requires) is produced by the native signer when Electron exposes it, or by the
// deliberate Web Crypto fallback used by isolated browser fixtures. `decide` takes
// that material verbatim; the gateway never creates or relaxes a signature.
export interface HumanApprovalMaterial {
  capability: string;
  signature: string;
}

export interface ApprovalGateway {
  readonly mode: GatewayMode;
  listPending(): Promise<PendingApproval[]>;
  decide(approvalId: string, status: 'approved' | 'rejected', material: HumanApprovalMaterial): Promise<PendingApproval>;
}

export class ApprovalGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number): string => {
  const label: Record<number, string> = {
    0: 'Approval service unavailable. Check the connection and retry.',
    401: 'Approval authentication required. Sign in again and retry.',
    403: 'Approval access denied. Open the signed Rhythm desktop queue with the correct account and retry; embedded permissions are separate.',
    404: 'Approval not found',
    503: 'Native approval service unavailable. Reopen the signed Rhythm desktop app and retry.',
  };
  return label[status] ?? `Approval request failed (${status})`;
};

async function response<T>(pending: Promise<Response>): Promise<T> {
  try {
    const result = await pending;
    if (!result.ok) throw new ApprovalGatewayError(result.status, failureText(result.status));
    return result.status === 204 ? undefined as T : await result.json() as T;
  } catch (error) {
    if (error instanceof ApprovalGatewayError) throw error;
    throw new ApprovalGatewayError(0, failureText(0));
  }
}

export function createFixtureApprovalGateway(): ApprovalGateway {
  const unsupported = async (): Promise<never> => { throw new ApprovalGatewayError(0, 'Fixture approval gateway is unsupported'); };
  return { mode: 'fixture', listPending: unsupported, decide: unsupported };
}

export function createLiveApprovalGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch, capability: () => Promise<string> = humanApprovalCapability): ApprovalGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit live token is required');
  const request = (path: string, init: RequestInit = {}, capability?: string) => fetcher(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(capability ? { 'X-Rhythm-Human-Approval': capability } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  return {
    mode: 'live',
    listPending: async () => {
      let nativeCapability: string;
      try {
        nativeCapability = await capability();
        if (!nativeCapability?.trim()) throw new Error('Missing capability');
      } catch {
        throw new ApprovalGatewayError(503, failureText(503));
      }
      const rows = await response<unknown>(request('/agent-approvals?status=pending', { signal: AbortSignal.timeout(10_000) }, nativeCapability));
      const nullableText = (value: unknown) => value === null || typeof value === 'string';
      const ids = new Set<string>();
      if (!Array.isArray(rows) || rows.some((row) => {
        if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id)) return true;
        ids.add(row.id);
        return !nullableText(row.sessionId) || typeof row.action !== 'string' || !row.action.trim()
          || !nullableText(row.preview) || !nullableText(row.consequence) || row.status !== 'pending'
          || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))
          || !(row.decisionNonce === null || (typeof row.decisionNonce === 'string' && row.decisionNonce.trim())) || !nullableText(row.payloadDigest);
      })) throw new ApprovalGatewayError(502, 'Invalid approval response. Pending cards were not replaced. Retry or check the desktop API configuration.');
      return rows as PendingApproval[];
    },
    decide: (approvalId, status, material) => response<PendingApproval>(request(`/agent-approvals/${encodeURIComponent(approvalId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, signature: material.signature }),
    }, material.capability)),
  };
}
