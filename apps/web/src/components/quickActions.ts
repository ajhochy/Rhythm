import type { SessionGateway } from '../gateway/sessions';

// Shared by Dashboard, Planner, and Tasks (docs/ai/coverage/react-electron/
// phase-3-operational-workspace-inventory.md gap 10): "operational agent quick actions" is one
// capability, not three fixture-only copies. Built once here so all three pages create the same
// real Secretary session instead of each inventing its own local-only handoff.
export type QuickActionPresetId = 'help-finish' | 'draft-next-steps' | 'summarize' | 'follow-up-tasks';

export const quickActionPresets: Array<{ id: QuickActionPresetId; label: string; prompt: string }> = [
  { id: 'help-finish', label: 'Help me finish this', prompt: 'Help me finish this task.' },
  { id: 'draft-next-steps', label: 'Draft next steps', prompt: 'Draft the next steps for this task.' },
  { id: 'summarize', label: 'Summarize', prompt: 'Summarize this task and its current context.' },
  { id: 'follow-up-tasks', label: 'Create follow-up tasks', prompt: 'Create the follow-up tasks this work implies.' },
];

export interface QuickActionTaskContext {
  id: string;
  title: string;
}

export interface QuickActionResult {
  sessionId: string;
  createdTaskId?: string;
}

// apps/api_server/src/controllers/agent_sessions_controller.ts:662-666 resolves the Rhythm
// profile from `profileId`; the same controller (~line 785-810) scopes the connected MCP
// surface from `mcpRole`. 'secretary' is the canonical Secretary profile/role id already used
// across the agent-session contract suite, e.g.
// apps/api_server/src/__tests__/issue_818_contract.test.ts:243.
const SECRETARY_PROFILE_ID = 'secretary';
const QUICK_ACTION_CWD = '/workspace/rhythm';

export async function launchQuickActionSession(
  sessions: SessionGateway,
  actionId: QuickActionPresetId,
  task: QuickActionTaskContext | null,
  createFollowUpTask?: () => Promise<QuickActionTaskContext>,
): Promise<QuickActionResult> {
  const preset = quickActionPresets.find((item) => item.id === actionId) ?? quickActionPresets[0];

  // Follow-up must exist server-side before the session ever launches — otherwise the agent
  // would be handed a taskId nothing can resolve.
  const boundTask = actionId === 'follow-up-tasks' && createFollowUpTask ? await createFollowUpTask() : task;

  const input = {
    profileId: SECRETARY_PROFILE_ID,
    mcpRole: SECRETARY_PROFILE_ID,
    cwd: QUICK_ACTION_CWD,
    name: boundTask ? `${boundTask.title} · ${preset.label}` : preset.label,
    isolateWorktree: false,
    ...(boundTask ? { taskId: boundTask.id } : {}),
  };
  const created = await sessions.create(input);

  const socket = sessions.connect(() => undefined, () => undefined);
  // ponytail: fire-and-leave-open. connect()'s close() clears any not-yet-flushed queued frame,
  // so closing right after send risks dropping the prompt while the socket is still CONNECTING.
  // Upgrade to an open-ack callback on SessionGateway if a page needs the socket reclaimed sooner.
  socket.send({ v: 1, type: 'session.input', id: created.id, data: preset.prompt });

  return { sessionId: created.id, createdTaskId: actionId === 'follow-up-tasks' ? boundTask?.id : undefined };
}
