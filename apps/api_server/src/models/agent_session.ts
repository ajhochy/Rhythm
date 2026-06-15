export type AgentKind = 'claude-code' | 'codex';
export type AgentSessionStatus = 'starting' | 'working' | 'idle' | 'resumable' | 'closed' | 'error';

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];

export interface AgentSession {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  agentKind: AgentKind;
  status: AgentSessionStatus;
  /** Human-readable error message when status='error'. Null otherwise. */
  statusMessage: string | null;
  /**
   * @deprecated Use sdkSessionId for resume continuity (OPC-M1-5).
   * Retained for backward compatibility — do not remove the column.
   */
  sessionToken: string | null;
  /**
   * OPC-M1-5 — The Opencode SDK session id (e.g. "ses_abc123").
   * Set at session create time; used by resume() to re-attach to the existing
   * SDK conversation rather than creating a fresh session. Null for sessions
   * created before this migration.
   */
  sdkSessionId: string | null;
  cwd: string;
  name: string;
  projectId: string | null;
  providerId: string | null;
  modelId: string | null;
  agentMode: string | null;
  permissionMode: PermissionMode;
  /** Reasoning budget in tokens (null = off). Only applied when the model supports extended thinking. */
  thinkingBudget: number | null;
  /** When true, ask the SDK to use fast-mode (lower latency, less thorough). */
  fastMode: boolean;
  lastPreview: string | null;
  lastActivityAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateAgentSessionDto {
  name?: string;
  providerId?: string | null;
  modelId?: string | null;
  agentMode?: string | null;
}

export interface AgentSessionMessage {
  id: number;
  sessionId: string;
  role: 'output' | 'input' | 'system';
  rawText: string;
  strippedText: string;
  createdAt: string;
  /** SDK message id (null for legacy rows). */
  sdkMessageId: string | null;
  /** Raw JSON string of ordered part array (null for legacy rows). */
  partsJson: string | null;
  /** Raw JSON string of token usage object (null for legacy rows). */
  tokensJson: string | null;
  /** Message cost in USD (null for legacy rows). */
  cost: number | null;
}

/**
 * AgentSessionMessage with parts/tokens deserialized.
 * Returned by listBySessionStructured() — what the GET /messages endpoint sends.
 */
export interface StructuredAgentSessionMessage extends Omit<AgentSessionMessage, 'partsJson' | 'tokensJson'> {
  /** Parsed part array. Legacy rows get a synthetic [{type:'text', text:rawText}]. */
  parts: unknown[];
  /** Parsed token usage object, or null for legacy rows. */
  tokens: Record<string, unknown> | null;
}

export interface CreateAgentSessionDto {
  agentKind: AgentKind;
  taskId: string | null;
  taskTitle?: string | null;
  cwd: string;
  name: string;
  projectId?: string | null;
}
