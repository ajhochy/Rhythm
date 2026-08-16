import type { GatewayMode } from '.';

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
  decisionNonce: string;
  payloadDigest: string | null;
}

// The P-256 decision signature over {approvalId,status,decisionNonce,payloadDigest}
// (and the desktop-Keychain `X-Rhythm-Human-Approval` capability header the server also
// requires) can only be produced by the signed native app holding the private key —
// never fabricated here. `decide` takes it as a required input and transmits it
// verbatim; ponytail: this renderer has no signer to call yet, so nothing invokes
// `decide` — wire it once a native bridge (Electron main / desktop Keychain) exists.
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
  const label: Record<number, string> = { 0: 'Approval service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Approval not found' };
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

export function createLiveApprovalGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): ApprovalGateway {
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
    listPending: () => response<PendingApproval[]>(request('/agent-approvals?status=pending')),
    decide: (approvalId, status, material) => response<PendingApproval>(request(`/agent-approvals/${encodeURIComponent(approvalId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, signature: material.signature }),
    }, material.capability)),
  };
}
