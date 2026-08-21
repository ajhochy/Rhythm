// Adapted from apps/web/src/components/quickActions.ts. The real implementation's agent
// quick-action launcher posts directly to the agent-session API and navigates to the agent
// surface — both are exactly the forbidden coupling this package must never contain (see
// tests/forbidden-imports.test.ts). What survives here is the host-neutral half: the
// preset catalog a screen renders as buttons. Firing one is delegated to
// `RhythmHostAdapter.onRequestFollowUp`, which is the host's job to interpret (e.g. by
// creating an agent session) — this package never does so itself.
export type QuickActionPresetId = 'help-finish' | 'draft-next-steps' | 'summarize' | 'follow-up-tasks';

export interface QuickActionPreset {
  id: QuickActionPresetId;
  label: string;
}

export const quickActionPresets: QuickActionPreset[] = [
  { id: 'help-finish', label: 'Help me finish this' },
  { id: 'draft-next-steps', label: 'Draft next steps' },
  { id: 'summarize', label: 'Summarize' },
  { id: 'follow-up-tasks', label: 'Create follow-up tasks' },
];
