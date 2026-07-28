/**
 * Compile-only #1132 contract. Every name below must come from the fork's
 * generated package—never from an ambient declaration in api_server.
 */
import type {
  EventMessagePartDelta,
  EventPermissionAsked,
  EventQuestionAsked,
  EventQuestionRejected,
  EventQuestionReplied,
  SessionUpdateData,
} from '@opencode-ai/sdk/v2/client';
import type {
  McpLocalConfigInput,
  McpRemoteConfigInput,
  McpStatusEntry,
  PartInput,
  RhythmEvent,
  SdkAgent,
} from '@opencode-ai/sdk/rhythm';

type RequiredForkEvent =
  | EventMessagePartDelta
  | EventPermissionAsked
  | EventQuestionAsked
  | EventQuestionReplied
  | EventQuestionRejected;

const eventIsComplete: RequiredForkEvent extends RhythmEvent ? true : never = true;
const localConfig: McpLocalConfigInput = { type: 'local', command: ['node', 'server.js'] };
const remoteConfig: McpRemoteConfigInput = { type: 'remote', url: 'https://example.invalid/mcp' };
const status: McpStatusEntry = { status: 'connected' };
const part: PartInput = { type: 'text', text: 'hello' };
const clearAllowlists: SessionUpdateData['body'] = {
  mcpAllowlist: null,
  skillAllowlist: null,
};

const agent = {
  name: 'build',
  mode: 'primary',
  builtIn: true,
  permission: {
    edit: 'allow',
    bash: {},
  },
  tools: {},
  options: {},
} satisfies SdkAgent;

void [eventIsComplete, localConfig, remoteConfig, status, part, clearAllowlists, agent];
