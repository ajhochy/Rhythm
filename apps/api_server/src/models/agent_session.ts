export type AgentKind = 'claude-code' | 'codex';
export type AgentSessionStatus = 'starting' | 'working' | 'idle' | 'resumable' | 'closed';

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];

export interface AgentSession {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  agentKind: AgentKind;
  status: AgentSessionStatus;
  sessionToken: string | null;
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
}

export interface CreateAgentSessionDto {
  agentKind: AgentKind;
  taskId: string | null;
  taskTitle?: string | null;
  cwd: string;
  name: string;
  projectId?: string | null;
}
