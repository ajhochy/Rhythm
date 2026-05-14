export type AgentKind = 'claude-code' | 'codex';
export type AgentSessionStatus = 'starting' | 'working' | 'idle' | 'resumable' | 'closed';

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
  lastPreview: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
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
