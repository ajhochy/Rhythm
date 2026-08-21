// Host-adapter contracts. A host (Electron renderer today, a Hermes plugin shell later)
// implements this to lend the workspace its theme, viewport class, and current-user display
// info. There is deliberately no field here for credentials, navigation into an agent
// surface, session creation, or approvals — see tests/forbidden-imports.test.ts.

export type RhythmThemeMode = 'light' | 'dark';

/** Semantic design tokens the host already owns (mirrors Hermes/Rhythm's existing CSS custom
 * property vocabulary: bg/surface/fg/border/accent/radii) so a host maps its own tokens once,
 * not per-screen. */
export interface RhythmHostTokens {
  mode: RhythmThemeMode;
  bg: string;
  surface: string;
  surfaceWarm: string;
  surfaceRaised: string;
  fg: string;
  fgSecondary: string;
  fgMuted: string;
  border: string;
  borderSoft: string;
  accent: string;
  accentOn: string;
  accentHover: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  fontUi: string;
  fontMono: string;
  radiusSm: string;
  radiusMd: string;
  radiusLg: string;
  radiusPill: string;
  focusRing: string;
  shadow: string;
}

export type RhythmViewport = 'compact' | 'regular' | 'expanded';

export interface RhythmCurrentUser {
  /** Stable host identity used only for local owner/capability decisions; never a credential. */
  id?: string;
  displayName: string;
  initials: string;
  /** Collaboration surfaces are writable only when this is explicitly set to write; omission is inspect-only. */
  collaborationCapability?: 'read' | 'write';
  /** Host-neutral, affirmative capabilities. An absent list is intentionally read-only. */
  capabilities?: readonly RhythmWorkspaceCapability[];
}

export type RhythmWorkspaceCapability =
  | 'facilities.manage'
  | 'facilities.reserve'
  | 'automations.write'
  | 'integrations.write'
  | 'dashboard.write'
  | 'tasks.write'
  /** Narrow task mutation grants for hosts such as Hermes.  They deliberately do not
   * imply create/delete/edit/collaboration access. */
  | 'tasks.complete'
  | 'tasks.reschedule'
  /** Broad legacy Planner access is an explicit capability, never inferred from
   * collaborationCapability. M5 constrained hosts use the semantic grants below. */
  | 'planner.write'
  /** M5 is intentionally semantic: constrained hosts never receive the broad
   * planner/projects/rhythms write ports. */
  | 'planner.schedule-task'
  | 'planner.update-task'
  | 'planner.update-project-step'
  | 'planner.schedule-project-step'
  | 'rhythms.create-rule'
  | 'rhythms.update-rule'
  | 'rhythms.delete-rule'
  | 'rhythms.update-step'
  | 'projects.generate-instance'
  | 'projects.update-step'
  | 'projects.add-milestone';

export interface RhythmTaskOperationConfirmation {
  taskId: string;
  generation: string;
  operation: 'complete' | 'reschedule';
  /** ISO date for rescheduling; omitted for completion. */
  scheduledDate?: string;
}

/** A host-issued, foreground-only confirmation for an exact M5 operation.
 * `payload` must be canonical JSON (no credentials, URLs, actor, workspace or
 * profile fields); the host binds those server-side before issuing its one-use
 * receipt.  This is deliberately a semantic action, not a generic HTTP port. */
export interface RhythmWorkspaceOperationConfirmation {
  operation: Exclude<RhythmWorkspaceCapability, 'facilities.manage' | 'facilities.reserve' | 'automations.write' | 'integrations.write' | 'dashboard.write' | 'tasks.write'>;
  entityId: string;
  payload: Record<string, string | number | boolean | null>;
  generation: string;
}

/** The ten non-agent screens this package exposes — used only for host-owned, in-package
 * cross-screen navigation (e.g. Dashboard's "Open planner" shortcut). Never includes an
 * agent surface: this package has no notion of one. */
export type RhythmScreenId =
  | 'dashboard' | 'tasks' | 'planner' | 'projects' | 'rhythms'
  | 'messages' | 'facilities' | 'integrations' | 'automations' | 'artifacts';

export interface RhythmHostAdapter {
  tokens: RhythmHostTokens;
  viewport: RhythmViewport;
  currentUser: RhythmCurrentUser;
  /** Optional: a screen asks the host to switch to a sibling screen (e.g. Dashboard's "Open
   * planner"). The host owns routing between screens; this package does not. */
  onNavigateToScreen?: (screenId: RhythmScreenId, context?: { relatedId?: string }) => void;
  /** Optional: called when a screen wants to hand off to a follow-up outside this package —
   * a quick action ("help me finish this"), an OAuth/authorization redirect (Integrations),
   * or any other action this package must not perform itself (creating an agent session,
   * navigating to an agent surface, building an authorization URL). Intentionally untyped
   * beyond a label + context id — this package must never call an agent-session API, build a
   * bearer/OAuth URL, or know what the host does with the request. */
  onRequestFollowUp?: (context: { screen: string; label: string; action?: string; relatedId?: string }) => void;
  /** A foreground-only host port.  The screen calls this only after its focus-trapped
   * confirmation dialog; the host rejects stale, mismatched, or reused payloads. */
  confirmTaskOperation?: (confirmation: RhythmTaskOperationConfirmation) => Promise<boolean>;
  confirmWorkspaceOperation?: (confirmation: RhythmWorkspaceOperationConfirmation) => Promise<boolean>;
}
