import type { AppSkillsResponse } from '@opencode-ai/sdk/v2/client';
import type { SnapshotFileDiff } from '@opencode-ai/sdk/v2/client';

export type {
  Agent,
  Command,
  Config,
  File,
  FileContent,
  FileNode,
  FormatterStatus,
  LspStatus,
  McpLocalConfig,
  McpOAuthConfig,
  McpRemoteConfig,
  McpResource,
  McpStatus,
  Message,
  Model,
  Part,
  PermissionRuleset,
  Project,
  Provider,
  ProviderAuthMethod,
  Pty,
  PtyShellsResponse,
  Session,
  SessionStatus,
  Symbol,
  Todo,
  ToolIds,
  ToolList,
  ToolListItem,
  ToolPart,
  VcsApplyError,
  VcsFileDiff,
  VcsFileStatus,
  VcsInfo,
  Worktree,
  WorktreeCreateInput,
  WorktreeRemoveInput,
  WorktreeResetInput,
  AppSkillsResponse as Skills,
  GlobalSession,
} from '@opencode-ai/sdk/v2/client';

export type FileDiff = SnapshotFileDiff & { patchOmitted?: string };

export type Skill = AppSkillsResponse[number];

export default {};
