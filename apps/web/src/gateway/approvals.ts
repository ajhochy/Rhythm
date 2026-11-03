import type { GatewayMode } from '.';
import { humanApprovalCapability } from '../security/humanApprovalSigner';
import { isTrustedBrowserFetcher } from './browser-transport';

// apps/api_server/src/controllers/agent_approvals_controller.ts:118-186
// apps/api_server/src/routes/agent_approvals_routes.ts:40-53
// apps/api_server/src/security/human_approval_security.ts:13-15,60-72,127-152
interface ApprovalFields {
  id: string;
  sessionId: string | null;
  action: string;
  preview: string | null;
  consequence: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  payloadDigest: string | null;
  /** Server-owned action; absent on legacy approval responses. */
  securityAction?: string | null;
}

export interface NativePendingApproval extends ApprovalFields {
  decisionMode?: undefined;
  decisionNonce: string | null;
}

export interface BrowserPendingApproval extends ApprovalFields {
  sessionId: string;
  decisionMode: 'trusted-tailnet-web';
  decisionNonce?: never;
  revision: string;
  cardHash: string;
  expiresAt: string | null;
}

export type PendingApproval = NativePendingApproval | BrowserPendingApproval;

// The P-256 decision signature over {approvalId,status,decisionNonce,payloadDigest}
// (and the desktop-Keychain `X-Rhythm-Human-Approval` capability header the server also
// requires) is produced by the native signer when Electron exposes it, or by the
// deliberate Web Crypto fallback used by isolated browser fixtures. `decide` takes
// that material verbatim; the gateway never creates or relaxes a signature.
export interface HumanApprovalMaterial {
  capability: string;
  signature: string;
}

export interface BrowserApprovalMaterial {
  revision: string;
  cardHash: string;
}

export interface BrowserApprovalDecision {
  id: string;
  status: 'approved' | 'rejected';
  decidedAt: string;
  audit: Record<string, unknown>;
}

export interface ApprovalGateway {
  readonly mode: GatewayMode;
  listPending(): Promise<PendingApproval[]>;
  decide(approvalId: string, status: 'approved' | 'rejected', material: HumanApprovalMaterial | BrowserApprovalMaterial): Promise<PendingApproval | BrowserApprovalDecision>;
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
    if (!result.ok) {
      // An expired card's 403 is not an access problem; show the server's reason instead.
      const reason = result.status === 403 ? await result.json().then((b) => b?.error?.message, () => undefined) : undefined;
      throw new ApprovalGatewayError(result.status, typeof reason === 'string' && /expired/i.test(reason) ? reason : failureText(result.status));
    }
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
          || !(row.decisionNonce === null || (typeof row.decisionNonce === 'string' && row.decisionNonce.trim())) || !nullableText(row.payloadDigest)
          || !(row.securityAction === undefined || nullableText(row.securityAction));
      })) throw new ApprovalGatewayError(502, 'Invalid approval response. Pending cards were not replaced. Retry or check the desktop API configuration.');
      return rows as PendingApproval[];
    },
    decide: async (approvalId, status, material) => {
      if (!('signature' in material) || !('capability' in material)) throw new ApprovalGatewayError(403, failureText(403));
      return response<PendingApproval>(request(`/agent-approvals/${encodeURIComponent(approvalId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, signature: material.signature }),
      }, material.capability));
    },
  };
}

const approvalHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nullableText = (value: unknown) => value === null || typeof value === 'string';

export function isBrowserApproval(value: unknown): value is BrowserPendingApproval {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.decisionMode === 'trusted-tailnet-web' && !Object.hasOwn(row, 'decisionNonce')
    && typeof row.id === 'string' && Boolean(row.id.trim())
    && typeof row.sessionId === 'string' && Boolean(row.sessionId.trim())
    && typeof row.action === 'string' && Boolean(row.action.trim())
    && nullableText(row.preview) && nullableText(row.consequence) && row.status === 'pending'
    && typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt))
    && nullableText(row.payloadDigest) && nullableText(row.securityAction)
    && (row.expiresAt === null || typeof row.expiresAt === 'string' && Number.isFinite(Date.parse(row.expiresAt)))
    && approvalHash(row.revision) && approvalHash(row.cardHash);
}

export function createBrowserApprovalGateway(apiBase: string, fetcher: typeof fetch): ApprovalGateway {
  if (!isTrustedBrowserFetcher(fetcher)) throw new Error('Browser approvals require trusted same-origin transport');
  const request = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    try {
      const result = await fetcher(`${apiBase}/web/approvals${path}`, {
        ...init, signal: AbortSignal.timeout(10_000),
        headers: init.body ? { 'Content-Type': 'application/json' } : {},
      });
      if (!result.ok) {
        const body = await result.json().catch(() => undefined);
        const expired = result.status === 403 && /expired/i.test(String(body?.error?.code ?? '') + ' ' + String(body?.error?.message ?? ''));
        const labels: Record<number, string> = {
          400: 'Approval details could not be confirmed. Refresh approvals and retry.',
          401: 'The web host could not confirm its owner. Reconnect to the web host and retry.',
          403: expired ? 'Approval expired. Ask the agent to request approval again.' : 'The web host refused this approval. Refresh approvals and retry.',
          404: 'Approval is no longer available. Refresh approvals.',
          409: 'Approval changed or was already decided. Refresh approvals before deciding again.',
          503: 'Web approval service unavailable. Check the web host and retry.',
        };
        throw new ApprovalGatewayError(result.status, labels[result.status] ?? `Web approval request failed (${result.status}). Refresh approvals and retry.`);
      }
      return await result.json();
    } catch (error) {
      if (error instanceof ApprovalGatewayError) throw error;
      throw new ApprovalGatewayError(0, 'Web approval service unavailable. Check the connection and retry.');
    }
  };
  return {
    mode: 'live',
    listPending: async () => {
      const rows = await request('?status=pending');
      const ids = new Set<string>();
      if (!Array.isArray(rows) || rows.some(row => {
        if (!isBrowserApproval(row) || ids.has(row.id)) return true;
        ids.add(row.id);
        return false;
      })) throw new ApprovalGatewayError(502, 'Invalid web approval response. Pending cards were not replaced. Refresh approvals and retry.');
      return rows as BrowserPendingApproval[];
    },
    decide: async (approvalId, status, material) => {
      if (!('revision' in material) || !('cardHash' in material) || !approvalHash(material.revision) || !approvalHash(material.cardHash)) {
        throw new ApprovalGatewayError(400, 'Approval details could not be confirmed. Refresh approvals and retry.');
      }
      const result = await request(`/${encodeURIComponent(approvalId)}`, {
        method: 'PATCH', body: JSON.stringify({ status, revision: material.revision, cardHash: material.cardHash }),
      }) as Partial<BrowserApprovalDecision> | null;
      if (!result || result.id !== approvalId || result.status !== status
        || typeof result.decidedAt !== 'string' || !Number.isFinite(Date.parse(result.decidedAt))
        || !result.audit || typeof result.audit !== 'object' || Array.isArray(result.audit)) {
        throw new ApprovalGatewayError(502, 'The web host did not confirm the decision. Refresh approvals before retrying.');
      }
      return result as BrowserApprovalDecision;
    },
  };
}
