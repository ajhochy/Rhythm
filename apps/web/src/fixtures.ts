import type { FixtureFile, Profile, Session, TodoItem } from './types';

export const FIXED_NOW = '2026-08-12T15:48:00-07:00';

export const seedProfiles: Profile[] = [
  {
    id: 'profile-coordinator', icon: 'RC', label: 'Rhythm Coordinator',
    systemPrompt: 'Coordinate work calmly, delegate bounded tasks, and report decisions with source-backed context.',
    managerAgent: true, allowedDelegates: ['profile-builder', 'profile-researcher'], selectable: true, enabled: true,
    modelProvider: 'openai', modelId: 'gpt-5.6', provider: 'OpenAI', model: 'gpt-5.6', defaultAccount: 'Rhythm workspace', mcps: ['GitNexus', 'Open Design'],
    skills: ['planning', 'verification'], permissionRules: { shell: 'ask', files: 'allow', network: 'deny' },
    managedSkills: true, isDefault: true, updatedAt: FIXED_NOW,
  },
  {
    id: 'profile-builder', icon: 'IB', label: 'Implementation Partner',
    systemPrompt: 'Implement scoped product work, preserve surrounding behavior, and verify before handoff.',
    managerAgent: false, allowedDelegates: [], selectable: true, enabled: true,
    modelProvider: 'openai', modelId: 'gpt-5.6-codex', provider: 'OpenAI', model: 'gpt-5.6-codex', defaultAccount: 'Rhythm workspace', mcps: ['GitNexus'],
    skills: ['frontend', 'tests'], permissionRules: { shell: 'ask', files: 'allow', network: 'ask' },
    managedSkills: false, isDefault: false, updatedAt: '2026-08-12T14:12:00-07:00',
  },
  {
    id: 'profile-researcher', icon: 'RL', label: 'Research Librarian',
    systemPrompt: 'Find and synthesize verified evidence. Separate source facts from inference.',
    managerAgent: false, allowedDelegates: [], selectable: true, enabled: true,
    modelProvider: 'anthropic', modelId: 'claude-sonnet-4', provider: 'Anthropic', model: 'claude-sonnet-4', defaultAccount: 'Research account', mcps: ['Web research'],
    skills: ['research', 'citations'], permissionRules: { shell: 'deny', files: 'ask', network: 'allow' },
    managedSkills: true, isDefault: false, updatedAt: '2026-08-11T16:44:00-07:00',
  },
];

const richMessages = [
  {
    id: 'msg-user-handoff', role: 'user' as const, createdAt: '2026-08-12T14:01:00-07:00',
    blocks: [{ id: 'b-user', kind: 'markdown' as const, content: 'Prepare the **Sunday service handoff**. Verify the run sheet, note unresolved owners, and keep changes in this worktree.' }],
  },
  {
    id: 'msg-assistant-handoff', role: 'assistant' as const, createdAt: '2026-08-12T14:03:24-07:00',
    blocks: [
      { id: 'b-reasoning', kind: 'reasoning' as const, title: 'Reasoning · 18s', content: 'I will compare the service plan, volunteer roster, and current project notes before changing the handoff.' },
      { id: 'b-tool', kind: 'tool' as const, title: 'read', content: 'services/2026-08-16/run-sheet.md', meta: 'completed · 420 ms' },
      { id: 'b-diff', kind: 'diff' as const, title: 'Updated handoff checklist', content: '+ Confirm acoustic guitar coverage\n+ Add livestream fallback owner\n- Placeholder: hospitality lead', meta: '1 file · +2 −1' },
      { id: 'b-terminal', kind: 'terminal' as const, title: 'Verification', content: '$ npm run validate:service\n8 checks passed\n0 unresolved file references', meta: 'exit 0 · 3.2s' },
      { id: 'b-todos', kind: 'todos' as const, title: 'Plan', content: 'Read service context\nConfirm owner gaps\nUpdate handoff\nValidate references', meta: '3 of 4 complete' },
      { id: 'b-children', kind: 'children' as const, title: 'Delegated agent', content: 'Volunteer coverage audit', meta: 'working · 1m 42s', childSessionId: 'session-coverage-child' },
      { id: 'b-markdown', kind: 'markdown' as const, content: 'The run sheet is consistent. I added the two unresolved handoff items and delegated a bounded coverage check. No schedule or owner was invented.' },
      { id: 'b-cost', kind: 'cost' as const, content: '$0.084 · 18.4k input · 3.1k output · 8.2k cached', meta: 'gpt-5.6 · high thinking' },
    ],
  },
];

const childMessages = [
  {
    id: 'msg-child-coverage', role: 'assistant' as const, createdAt: '2026-08-12T14:06:00-07:00',
    blocks: [
      { id: 'b-child-context', kind: 'markdown' as const, content: 'I checked the volunteer roster against the handoff. Acoustic guitar is still unassigned; the livestream fallback has one confirmed reply.' },
      { id: 'b-child-tool', kind: 'tool' as const, title: 'read', content: 'services/2026-08-16/volunteers.md', meta: 'completed · 310 ms' },
      { id: 'b-child-nested', kind: 'children' as const, title: 'Delegated agent', content: 'Livestream reply verification', meta: 'completed · 38s', childSessionId: 'session-coverage-grandchild' },
    ],
  },
];

const grandchildMessages = [
  {
    id: 'msg-grandchild-livestream', role: 'assistant' as const, createdAt: '2026-08-12T14:07:00-07:00',
    blocks: [{ id: 'b-grandchild-result', kind: 'markdown' as const, content: 'Morgan Lee confirmed the livestream fallback in the seeded Gmail signal. No schedule or assignment was changed.' }],
  },
];

export const seedSessions: Session[] = [
  {
    id: 'session-sunday-handoff', name: 'Sunday service handoff', scope: 'chats', group: 'active', status: 'working',
    profileId: 'profile-coordinator', projectId: 'project-ministry-ops', projectName: 'Ministry operations', cwd: '/workspace/rhythm',
    branch: 'agents/sunday-handoff', dirtyCount: 2, isolateWorktree: true, account: 'Rhythm workspace', model: 'gpt-5.6',
    thinkingBudget: 'High', permissionMode: 'Default', fastMode: false, createdAt: '2026-08-12T14:01:00-07:00', updatedAt: FIXED_NOW,
    cost: 0.084, inputTokens: 18420, outputTokens: 3120, cachedTokens: 8210, totalBudget: 100000,
    childIds: ['session-coverage-child'], messages: richMessages, artifacts: [],
  },
  {
    id: 'session-coverage-child', name: 'Volunteer coverage audit', scope: 'chats', group: 'active', status: 'working',
    profileId: 'profile-researcher', projectId: 'project-ministry-ops', projectName: 'Ministry operations', cwd: '/workspace/rhythm',
    branch: 'agents/sunday-handoff', dirtyCount: 0, isolateWorktree: true, model: 'claude-sonnet-4', thinkingBudget: 'Medium', permissionMode: 'Default', fastMode: true,
    createdAt: '2026-08-12T14:04:00-07:00', updatedAt: FIXED_NOW, cost: 0.019, inputTokens: 4200, outputTokens: 720, cachedTokens: 1100,
    totalBudget: 40000, parentId: 'session-sunday-handoff', childIds: ['session-coverage-grandchild'], messages: childMessages, artifacts: [],
  },
  {
    id: 'session-coverage-grandchild', name: 'Livestream reply verification', scope: 'chats', group: 'active', status: 'closed', completedAt: '2026-08-12T14:07:00-07:00',
    profileId: 'profile-researcher', projectId: 'project-ministry-ops', projectName: 'Ministry operations', cwd: '/workspace/rhythm',
    branch: 'agents/sunday-handoff', dirtyCount: 0, isolateWorktree: true, model: 'claude-sonnet-4', thinkingBudget: 'Low', permissionMode: 'Default', fastMode: false,
    createdAt: '2026-08-12T14:06:20-07:00', updatedAt: '2026-08-12T14:07:00-07:00', cost: 0.006, inputTokens: 1200, outputTokens: 210, cachedTokens: 300,
    totalBudget: 12000, parentId: 'session-coverage-child', childIds: [], messages: grandchildMessages, artifacts: [],
  },
  {
    id: 'session-permission', name: 'Prepare release worktree', scope: 'chats', group: 'active', status: 'idle', profileId: 'profile-builder',
    projectId: 'project-rhythm-desktop', projectName: 'Rhythm desktop', cwd: '/workspace/rhythm-desktop', branch: 'release/desktop', dirtyCount: 1,
    isolateWorktree: true, model: 'gpt-5.6-codex', thinkingBudget: 'High', permissionMode: 'Default', fastMode: false,
    createdAt: '2026-08-12T13:31:00-07:00', updatedAt: '2026-08-12T15:43:00-07:00', cost: 0.112, inputTokens: 22400, outputTokens: 5100,
    cachedTokens: 13200, totalBudget: 100000, childIds: [], messages: richMessages.slice(0, 1), artifacts: [],
    permission: { id: 'permission-reset-worktree', operation: 'Reset worktree', command: 'git restore --staged .', cwd: '/workspace/rhythm-desktop', status: 'pending' },
  },
  {
    id: 'session-question', name: 'Choose message migration path', scope: 'chats', group: 'active', status: 'idle', profileId: 'profile-coordinator',
    projectId: 'project-rhythm-desktop', projectName: 'Rhythm desktop', cwd: '/workspace/rhythm-desktop', branch: 'feature/message-storage', dirtyCount: 0,
    isolateWorktree: false, model: 'gpt-5.6', thinkingBudget: 'Medium', permissionMode: 'Default', fastMode: false,
    createdAt: '2026-08-12T12:46:00-07:00', updatedAt: '2026-08-12T15:40:00-07:00', cost: 0.047, inputTokens: 9600, outputTokens: 1700,
    cachedTokens: 2400, totalBudget: 60000, childIds: [], messages: richMessages.slice(0, 1), artifacts: [],
    question: { id: 'question-migration', prompt: 'Which migration path should this session use?', options: ['Compatibility first', 'Clean cutover', 'Draft a comparison'], status: 'pending' },
  },
  {
    id: 'session-offline', name: 'Synology relay recovery', scope: 'chats', group: 'resumable', status: 'resumable', connectionState: 'offline', profileId: 'profile-builder',
    projectId: 'project-relay', projectName: 'Synology relay', cwd: '/workspace/synology-relay', branch: 'mobile/synology-relay', dirtyCount: 0,
    isolateWorktree: false, model: 'gpt-5.6-codex', thinkingBudget: 'Medium', permissionMode: 'Default', fastMode: true,
    createdAt: '2026-08-12T10:02:00-07:00', updatedAt: '2026-08-12T15:37:00-07:00', cost: 0.033, inputTokens: 7100, outputTokens: 1200,
    cachedTokens: 3600, totalBudget: 50000, childIds: [], messages: richMessages.slice(0, 1), queuedDraft: 'Recheck the relay health contract after reconnecting.', artifacts: [],
  },
  {
    id: 'session-completed', name: 'Agents workflow coverage', scope: 'chats', group: 'resumable', status: 'closed', completedAt: '2026-08-12T11:20:00-07:00', profileId: 'profile-builder',
    projectId: 'project-rhythm-desktop', projectName: 'Rhythm desktop', cwd: '/workspace/rhythm-desktop', branch: 'agents/coverage', dirtyCount: 0,
    isolateWorktree: true, model: 'gpt-5.6-codex', thinkingBudget: 'High', permissionMode: 'Default', fastMode: false,
    createdAt: '2026-08-11T16:10:00-07:00', updatedAt: '2026-08-12T11:20:00-07:00', cost: 0.206, inputTokens: 46200, outputTokens: 8800,
    cachedTokens: 17000, totalBudget: 120000, childIds: [], messages: richMessages,
    artifacts: [
      { id: 'artifact-report', name: 'agents-coverage-report.html', type: 'Report', href: '#/dashboard', status: 'ready', updatedAt: '2026-08-12T11:20:00-07:00', html: '<main><h1>Agents coverage report</h1><p>Deterministic verification evidence for the completed session.</p></main>' },
      { id: 'artifact-runbook', name: 'operator-runbook.html', type: 'Runbook', href: '#/dashboard', status: 'ready', updatedAt: '2026-08-12T10:54:00-07:00', html: '<main><h1>Operator runbook</h1><p>Recovery and handoff steps generated by this session.</p></main>' },
    ],
  },
  {
    id: 'session-queued', name: 'Monday planning digest', scope: 'scheduled', group: 'active', status: 'idle', profileId: 'profile-coordinator',
    projectId: 'project-ministry-ops', projectName: 'Ministry operations', cwd: '/workspace/rhythm', branch: 'main', dirtyCount: 0, isolateWorktree: false,
    model: 'gpt-5.6', thinkingBudget: 'Low', permissionMode: 'Default', fastMode: true, createdAt: '2026-08-10T09:00:00-07:00', updatedAt: FIXED_NOW,
    cost: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalBudget: 30000, childIds: [], messages: [], artifacts: [],
  },
  {
    id: 'session-stuck', name: 'Integration health sweep', scope: 'background', group: 'active', status: 'working', stuckSince: '2026-08-12T15:02:00-07:00', profileId: 'profile-researcher',
    projectId: 'project-operations', projectName: 'Operations', cwd: '/workspace/operations', branch: 'main', dirtyCount: 0, isolateWorktree: false,
    model: 'claude-sonnet-4', thinkingBudget: 'Low', permissionMode: 'Default', fastMode: true, createdAt: '2026-08-12T08:00:00-07:00', updatedAt: '2026-08-12T15:02:00-07:00',
    cost: 0.014, inputTokens: 3200, outputTokens: 430, cachedTokens: 800, totalBudget: 20000, childIds: [], messages: [], artifacts: [],
  },
  {
    id: 'session-archived', name: 'July usage review', scope: 'chats', group: 'archived', status: 'closed', profileId: 'profile-coordinator',
    projectId: 'project-operations', projectName: 'Operations', cwd: '/workspace/operations', branch: 'archive/july-usage', dirtyCount: 0, isolateWorktree: false,
    model: 'gpt-5.6', thinkingBudget: 'Low', permissionMode: 'Default', fastMode: false, createdAt: '2026-07-31T12:00:00-07:00', updatedAt: '2026-08-01T09:40:00-07:00',
    cost: 0.078, inputTokens: 16700, outputTokens: 2900, cachedTokens: 4400, totalBudget: 50000, childIds: [], messages: richMessages.slice(1), artifacts: [],
  },
];

export const seedTodos: TodoItem[] = [
  { id: 'todo-context', label: 'Read service context and cached handoff notes', done: true },
  { id: 'todo-coverage', label: 'Confirm unresolved volunteer coverage', done: true },
  { id: 'todo-handoff', label: 'Update the handoff checklist', done: true },
  { id: 'todo-review', label: 'Review child-agent coverage result', done: false },
];

export const seedFiles: FixtureFile[] = [
  { path: 'services/2026-08-16/run-sheet.md', language: 'markdown', content: '# Sunday service · August 16\n\n- Acoustic guitar: unresolved\n- Livestream fallback: unresolved\n- Hospitality: Morgan L.', size: 184, gitStatus: 'M' },
  { path: 'src/agents/session-manager.ts', language: 'typescript', content: 'export function queueLocalInput(id: string, data: string) {\n  return { id, data, queuedAt: FIXED_NOW, transport: "local-only" };\n}', size: 142, gitStatus: 'M' },
  { path: 'tests/agents/permission.spec.ts', language: 'typescript', content: "test('replies once to a pending permission', async ({ page }) => {\n  await page.getByTestId('permission-allow-once').click();\n});", size: 132, gitStatus: 'A' },
  { path: 'assets/rhythm-logo.png', language: 'image', content: '', kind: 'image', mimeType: 'image/png', size: 302104, previewUrl: './assets/rhythm-logo.png' },
  { path: 'build/rhythm-agent', language: 'binary', content: '', kind: 'binary', mimeType: 'application/octet-stream', size: 68412 },
  { path: 'exports/full-transcript.json', language: 'json', content: '', kind: 'text', mimeType: 'application/json', size: 2400001 },
];

export const seedDiff = `diff --git a/services/2026-08-16/run-sheet.md b/services/2026-08-16/run-sheet.md\nindex 4a2..8d1 100644\n--- a/services/2026-08-16/run-sheet.md\n+++ b/services/2026-08-16/run-sheet.md\n@@ -2,2 +2,3 @@\n+- Confirm acoustic guitar coverage\n+- Assign livestream fallback owner\n- Placeholder: hospitality lead`;
