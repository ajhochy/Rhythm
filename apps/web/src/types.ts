export type SessionStatus =
  | 'starting'
  | 'working'
  | 'idle'
  | 'resumable'
  | 'closed'
  | 'error';

export type SessionScope = 'chats' | 'scheduled' | 'background';
export type SessionGroup = 'active' | 'resumable' | 'archived';
export type InspectorTab = 'context' | 'changes' | 'terminal' | 'files' | 'artifacts';
export type Theme = 'light' | 'dark';
export type DemoState =
  | 'running'
  | 'permission'
  | 'question'
  | 'offline'
  | 'completed'
  | 'connecting'
  | 'retrying'
  | 'resumable'
  | 'empty'
  | 'loading'
  | 'error'
  | 'no-provider';

export interface TranscriptBlock {
  id: string;
  kind: 'markdown' | 'reasoning' | 'tool' | 'diff' | 'terminal' | 'todos' | 'children' | 'cost' | 'step-start' | 'step-finish' | 'compaction' | 'file' | 'agent';
  title?: string;
  content: string;
  meta?: string;
  childSessionId?: string;
}

export interface ComposerAttachment {
  id: string;
  type: 'text' | 'file';
  path: string;
  filename: string;
  mime: string;
  size: number;
  truncated?: boolean;
  fileUrl?: string;
  // Live-mode only: resolved at submit time from a real `<input type="file">` selection
  // (post-m1-phase-4 capability 4). `content` carries UTF-8 text (already truncated to
  // 100 KB); `dataUrl` carries an image/PDF data: URL. Fixture attachments set neither.
  content?: string;
  dataUrl?: string;
}

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  createdAt: string;
  blocks: TranscriptBlock[];
  attachments?: ComposerAttachment[];
  reverted?: boolean;
}

export interface PermissionRequest {
  id: string;
  operation: string;
  command: string;
  cwd: string;
  status: 'pending' | 'once' | 'always' | 'denied';
  reason?: string;
}

export interface QuestionRequest {
  id: string;
  prompt: string;
  options: string[];
  status: 'pending' | 'answered' | 'rejected';
  answer?: string;
}

// post-m1-phase-5: canonical TRANSLATED live boundary shapes — never the fixture
// PermissionRequest/QuestionRequest shape above, and never a raw engine literal.
// apps/api_server/src/services/opencode_stream_bridge.ts:359-391,535-556.
export interface LivePermissionRequest {
  permissionID: string;
  directory: string;
  tool: string;
  patterns: string[];
  title: string;
  createdAt: string;
}

export interface LiveQuestionOption { label: string; description?: string }
export interface LiveQuestionItem { header: string; question: string; options: LiveQuestionOption[]; multiple?: boolean; custom?: boolean }
export interface LiveQuestionRequest {
  requestId: string;
  callId: string;
  questions: LiveQuestionItem[];
}

export interface Session {
  id: string;
  name: string;
  scope: SessionScope;
  group: SessionGroup;
  status: SessionStatus;
  connectionState?: 'online' | 'offline' | 'unavailable';
  completedAt?: string;
  stuckSince?: string;
  profileId: string;
  projectId: string;
  projectName: string;
  cwd: string;
  branch: string;
  dirtyCount: number;
  isolateWorktree: boolean;
  account?: string;
  model: string;
  thinkingBudget: string;
  permissionMode: string;
  fastMode: boolean;
  createdAt: string;
  updatedAt: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalBudget: number;
  parentId?: string;
  childIds: string[];
  messages: TranscriptMessage[];
  permission?: PermissionRequest;
  question?: QuestionRequest;
  // post-m1-phase-5: live-only, canonical-shaped counterparts of the fixture fields above.
  livePermission?: LivePermissionRequest;
  liveQuestion?: LiveQuestionRequest;
  // post-m1-phase-5 c2d: canonical delegation identity from the API — distinct from the
  // fixture-only `parentId` above. A non-empty parentSessionId means this is a live child.
  parentSessionId?: string;
  opencodeAgentId?: string;
  delegationDepth?: number;
  queuedDraft?: string;
  queuedAttachments?: ComposerAttachment[];
  pendingAttachments?: ComposerAttachment[];
  revertedMessageId?: string;
  artifacts: { id: string; name: string; type: string; href: string; status?: 'ready' | 'unavailable'; updatedAt?: string; html?: string }[];
  sdkSessionId?: string;
  providerId?: string;
  modelId?: string;
  // Live-mode transcript pagination cursor (post-m1-phase-4 capability 4/c2f). Populated from
  // the API's `transcriptPage`/`pageInfo` at apps/api_server/src/controllers/agent_sessions_controller.ts:614-616,2389-2391.
  transcriptCursor?: string | null;
  transcriptHasMore?: boolean;
  /** Transient provider-retry state from a `session.status` frame with `status:'retrying'`
   * (post-m1-phase-4 capability c3e). Not persisted — cleared on the next part or non-retry status. */
  retry?: { attempt: number; reason: string };
}

export interface Profile {
  id: string;
  icon: string;
  label: string;
  systemPrompt: string;
  managerAgent: boolean;
  allowedDelegates: string[];
  selectable: boolean;
  enabled: boolean;
  modelProvider: string | null;
  modelId: string | null;
  provider: string;
  model: string;
  defaultAccount: string;
  mcps: string[];
  skills: string[];
  permissionRules: Record<string, 'ask' | 'allow' | 'deny'>;
  managedSkills: boolean;
  isDefault: boolean;
  updatedAt: string;
  isAgent?: boolean;
  isManager?: boolean;
  allowedMcpsJson?: string | null;
  allowedSkillsJson?: string | null;
  corePermissionsJson?: string | null;
  allowedDelegatesJson?: string | null;
  presetId?: string | null;
  sortOrder?: number;
  ocAgent?: string | null;
  sessionSelectable?: boolean;
  modelTierHint?: string | null;
  defaultAnthropicAccountId?: string | null;
}

export interface TodoItem { id: string; label: string; done: boolean; }
export interface FixtureFile {
  path: string;
  language: string;
  content: string;
  kind?: 'text' | 'image' | 'binary';
  mimeType?: string;
  size?: number;
  previewUrl?: string;
  gitStatus?: 'M' | 'A' | 'D';
}

export interface EndpointContract {
  id: string;
  control: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'WS';
  route: string;
  handler: string;
  flutterSource: string;
  test: string;
  payload?: string;
}
