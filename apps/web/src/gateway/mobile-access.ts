import type { GatewayMode } from '.';

// Canonical desktop access states — apps/api_server/src/services/tailscale_serve_service.ts:8-13.
// Never a display string: the page must switch on `state`, not on `message`.
export type MobileAccessState = 'missing' | 'loggedOut' | 'wrongTarget' | 'healthy';

// apps/api_server/src/services/tailscale_serve_service.ts:15-19; returned verbatim by
// GET /mobile-gateway/access and POST /mobile-gateway/access/enable
// (apps/api_server/src/routes/mobile_gateway_routes.ts:158-181).
export interface MobileAccessDiagnostic {
  state: MobileAccessState;
  gatewayUrl: string | null;
  message: string;
  canConfigure: boolean;
}

// apps/api_server/src/services/mobile_pairing_service.ts:68-94 (createPairingCode); `relayUrl` is
// appended by apps/api_server/src/controllers/mobile_gateway_controller.ts:41-55 only when
// env.relayPublicUrl is set. The QR payload itself is exactly {gatewayUrl, pairingCode, relayUrl?}
// per apps/mobile/lib/pairing/paired-host-store.ts:61 — gatewayUrl comes from the access
// diagnostic, never from this offer response.
export interface MobilePairingOffer {
  id: string;
  hostId: string;
  pairingCode: string;
  expiresAt: string;
  relayUrl?: string;
}

// MobileDevice = Omit<MobileDeviceRecord, 'tokenVerifier'> —
// apps/api_server/src/services/mobile_pairing_service.ts:41-46; field shapes from
// apps/api_server/src/repositories/mobile_devices_repository.ts:13-21. Returned by
// GET /mobile-gateway/devices (apps/api_server/src/routes/mobile_gateway_routes.ts:107-113).
export interface MobilePairedDevice {
  id: string;
  hostId: string;
  userId: number;
  name: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface MobileAccessGateway {
  readonly mode: GatewayMode;
  diagnose(capability?: string): Promise<MobileAccessDiagnostic>;
  enable(capability?: string): Promise<MobileAccessDiagnostic>;
  createPairingCode(capability?: string): Promise<MobilePairingOffer>;
  listDevices(capability?: string): Promise<MobilePairedDevice[]>;
  revokeDevice(deviceId: string, capability?: string): Promise<void>;
}

export class MobileAccessGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const failureText = (status: number): string => ({
  0: 'Mobile access service unavailable',
  401: 'Authentication required',
  403: 'Desktop approval is required',
  404: 'Paired device not found',
} as Record<number, string>)[status] ?? `Mobile access request failed (${status})`;

async function response<T>(pending: Promise<Response>): Promise<T> {
  try {
    const result = await pending;
    if (!result.ok) throw new MobileAccessGatewayError(result.status, failureText(result.status));
    return result.status === 204 ? undefined as T : await result.json() as T;
  } catch (error) {
    if (error instanceof MobileAccessGatewayError) throw error;
    throw new MobileAccessGatewayError(0, failureText(0));
  }
}

export function createFixtureMobileAccessGateway(): MobileAccessGateway {
  const unsupported = async (): Promise<never> => {
    throw new MobileAccessGatewayError(0, 'Fixture mobile access gateway is unsupported');
  };
  return {
    mode: 'fixture',
    diagnose: unsupported,
    enable: unsupported,
    createPairingCode: unsupported,
    listDevices: unsupported,
    revokeDevice: unsupported,
  };
}

export function createLiveMobileAccessGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): MobileAccessGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit live token is required');
  // requireDesktopHumanCapability (apps/api_server/src/security/human_approval_security.ts:89-125)
  // gates every one of these routes behind the signed desktop app's Keychain capability digest. Same
  // precedent as apps/web/src/gateway/approvals.ts's HumanApprovalMaterial: no signer exists in this
  // renderer yet, so the capability is an explicit, optional caller-supplied parameter — never
  // fabricated or cached here. Until a native bridge exists, calls made without it legitimately 403,
  // and the page must render that as a bounded error rather than crash.
  const request = (path: string, init: RequestInit = {}, capability?: string) => fetcher(`${apiBase}/mobile-gateway${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(capability ? { 'X-Rhythm-Human-Approval': capability } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  return {
    mode: 'live',
    diagnose: (capability) => response<MobileAccessDiagnostic>(request('/access', {}, capability)),
    enable: (capability) => response<MobileAccessDiagnostic>(request('/access/enable', { method: 'POST' }, capability)),
    createPairingCode: (capability) => response<MobilePairingOffer>(request('/pairing-codes', { method: 'POST' }, capability)),
    listDevices: (capability) => response<MobilePairedDevice[]>(request('/devices', {}, capability)),
    revokeDevice: (deviceId, capability) => response<void>(request(`/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' }, capability)),
  };
}
