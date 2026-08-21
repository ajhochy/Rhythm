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
  surfaceRaised: string;
  fg: string;
  fgMuted: string;
  border: string;
  accent: string;
  accentOn: string;
  danger: string;
  fontUi: string;
  radiusMd: string;
}

export type RhythmViewport = 'compact' | 'regular' | 'expanded';

export interface RhythmCurrentUser {
  displayName: string;
  initials: string;
}

export interface RhythmHostAdapter {
  tokens: RhythmHostTokens;
  viewport: RhythmViewport;
  currentUser: RhythmCurrentUser;
  /** Optional: called when a screen wants to hand off to a follow-up outside this package
   * (e.g. "start a related task"). Intentionally untyped beyond a label + context id — this
   * package must never call an agent-session API or know what the host does with it. */
  onRequestFollowUp?: (context: { screen: string; label: string; relatedId?: string }) => void;
}
