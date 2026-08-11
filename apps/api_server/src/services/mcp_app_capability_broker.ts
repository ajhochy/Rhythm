import { randomUUID } from 'crypto';

export type McpAppCapabilityMode = 'off' | 'readonly' | 'interactive';

export interface McpAppCapabilityBinding {
  sessionId: string;
  callId: string;
  serverName: string;
  resourceUri: string;
  mode: McpAppCapabilityMode;
  contentHash: string;
}

export interface McpAppCapabilityRequest<T = unknown> {
  capabilityId: string;
  binding: McpAppCapabilityBinding;
  correlationId: string;
  payload: T;
}

interface StoredCapability {
  binding: McpAppCapabilityBinding;
  expiresAt: number;
  correlations: Set<string>;
}

const MAX_CAPABILITY_LIFETIME_MS = 5 * 60 * 1000;
const MAX_CORRELATION_BYTES = 256;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const SHA256 = /^sha256:[a-f0-9]{64}$/;

export class McpAppCapabilityDenied extends Error {
  constructor() {
    super('capability_denied');
  }
}

/**
 * Process-local, opaque, one-correlation capability broker.
 *
 * Authority is retained only on the trusted API side. The iframe sees the
 * random identifier and expiry, never the session/server/resource binding.
 */
export class McpAppCapabilityBroker {
  private readonly capabilities = new Map<string, StoredCapability>();

  constructor(
    private readonly options: {
      now?: () => number;
      randomId?: () => string;
    } = {},
  ) {}

  issue(
    binding: McpAppCapabilityBinding & { expiresAt: number },
  ): { id: string; expiresAt: string } {
    const now = this.now();
    if (
      !this.validBinding(binding) ||
      !Number.isFinite(binding.expiresAt) ||
      binding.expiresAt <= now ||
      binding.expiresAt - now > MAX_CAPABILITY_LIFETIME_MS
    ) {
      throw new McpAppCapabilityDenied();
    }
    const id = this.options.randomId?.() ?? randomUUID();
    if (!id || Buffer.byteLength(id, 'utf8') > MAX_CORRELATION_BYTES) {
      throw new McpAppCapabilityDenied();
    }
    this.capabilities.set(id, {
      binding: this.copyBinding(binding),
      expiresAt: binding.expiresAt,
      correlations: new Set(),
    });
    return { id, expiresAt: new Date(binding.expiresAt).toISOString() };
  }

  async consume<T, R>(
    request: McpAppCapabilityRequest<T>,
    forward: (request: McpAppCapabilityRequest<T>) => Promise<R>,
  ): Promise<R> {
    const stored = this.capabilities.get(request.capabilityId);
    if (
      !stored ||
      this.now() >= stored.expiresAt ||
      !this.validCorrelation(request.correlationId) ||
      stored.correlations.has(request.correlationId) ||
      !this.sameBinding(stored.binding, request.binding) ||
      !this.validPayload(request.payload)
    ) {
      throw new McpAppCapabilityDenied();
    }

    // Mark before forwarding so concurrent duplicates cannot both pass.
    stored.correlations.add(request.correlationId);
    return forward(request);
  }

  /** Validate cheap caller-controlled fields before any engine/resource read. */
  preflight(
    capabilityId: string,
    correlationId: string,
    sessionId: string,
    callId: string,
  ): McpAppCapabilityBinding {
    const stored = this.capabilities.get(capabilityId);
    if (
      !stored ||
      this.now() >= stored.expiresAt ||
      !this.validCorrelation(correlationId) ||
      stored.correlations.has(correlationId) ||
      stored.binding.sessionId !== sessionId ||
      stored.binding.callId !== callId
    ) {
      throw new McpAppCapabilityDenied();
    }
    return this.copyBinding(stored.binding);
  }

  revoke(id: string): void {
    this.capabilities.delete(id);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private validBinding(binding: McpAppCapabilityBinding): boolean {
    if (
      binding.mode !== 'interactive' ||
      !binding.sessionId ||
      !binding.callId ||
      !binding.serverName ||
      !binding.resourceUri ||
      !SHA256.test(binding.contentHash)
    ) {
      return false;
    }
    const values = [
      binding.sessionId,
      binding.callId,
      binding.serverName,
      binding.resourceUri,
    ];
    if (values.some((value) => Buffer.byteLength(value, 'utf8') > 2048)) {
      return false;
    }
    try {
      return new URL(binding.resourceUri).protocol === 'ui:';
    } catch {
      return false;
    }
  }

  private validCorrelation(value: string): boolean {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      Buffer.byteLength(value, 'utf8') <= MAX_CORRELATION_BYTES
    );
  }

  private validPayload(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
      return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_PAYLOAD_BYTES;
    } catch {
      return false;
    }
  }

  private sameBinding(
    left: McpAppCapabilityBinding,
    right: McpAppCapabilityBinding,
  ): boolean {
    return (
      this.validBinding(right) &&
      left.sessionId === right.sessionId &&
      left.callId === right.callId &&
      left.serverName === right.serverName &&
      left.resourceUri === right.resourceUri &&
      left.mode === right.mode &&
      left.contentHash === right.contentHash
    );
  }

  private copyBinding(
    binding: McpAppCapabilityBinding,
  ): McpAppCapabilityBinding {
    return {
      sessionId: binding.sessionId,
      callId: binding.callId,
      serverName: binding.serverName,
      resourceUri: binding.resourceUri,
      mode: binding.mode,
      contentHash: binding.contentHash,
    };
  }
}
