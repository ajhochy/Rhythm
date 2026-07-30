export type PendingInteractionKind = 'permission' | 'question';
export type PendingInteractionStatus = 'pending' | 'resolved' | 'failed';
export type PendingInteractionSource = 'desktop' | 'mobile' | 'engine';
export type PendingInteractionAction =
  | 'once'
  | 'always'
  | 'reject'
  | 'reply';

/**
 * Canonical wire/state shape shared by bridge snapshots, desktop WebSocket
 * updates, desktop REST acknowledgements, and the paired-mobile proxy.
 *
 * `id` is always the engine request id (`per_*` / `que_*`). Tool call ids are
 * correlation metadata only and are never used as the authoritative identity.
 */
export interface PendingInteraction {
  id: string;
  kind: PendingInteractionKind;
  status: PendingInteractionStatus;
  /** Rhythm/local session id used by the desktop client. */
  sessionId: string;
  /** OpenCode SDK session id used by the mobile client and engine. */
  sdkSessionId: string;
  /** Optional tool call correlation id; never the authoritative id. */
  callId: string | null;
  payload: {
    permission?: string;
    patterns?: string[];
    metadata?: Record<string, unknown>;
    always?: string[];
    questions?: unknown[];
  };
  resolution: {
    action: PendingInteractionAction;
    source: PendingInteractionSource;
    answers?: string[][];
  } | null;
  error: {
    message: string;
    retryable: boolean;
  } | null;
}

export interface PendingInteractionResolutionRequest {
  action: PendingInteractionAction;
  source: PendingInteractionSource;
  answers?: string[][];
  message?: string;
}
