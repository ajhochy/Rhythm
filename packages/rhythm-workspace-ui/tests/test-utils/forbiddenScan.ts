export interface ForbiddenTerm {
  needle: string;
  reason: string;
}

/** Every term that would reintroduce the coupling M1 exists to remove: Electron-only
 * globals/types, the legacy global Rhythm shell, a bearer credential constructed in shared
 * code, agent-session creation/navigation, and approval flows. Kept as literal needles
 * (not regex) so the list itself stays auditable at a glance. */
export const FORBIDDEN_TERMS: ForbiddenTerm[] = [
  { needle: 'from \'electron\'', reason: 'Electron types must stay host-side' },
  { needle: 'from "electron"', reason: 'Electron types must stay host-side' },
  { needle: 'window.rhythmShell', reason: 'the legacy global Rhythm shell must not be referenced' },
  { needle: 'Bearer ', reason: 'a bearer credential must never be constructed in shared code' },
  { needle: 'createSession', reason: 'agent-session creation is a host-only concern' },
  { needle: 'launchQuickActionSession', reason: 'agent-session launch coupling must not leak into shared screens' },
  { needle: 'agentSession', reason: 'no agent-session domain coupling in shared code' },
  { needle: 'approveRun', reason: 'approval flows are a host/backend concern, not a shared UI concern' },
];

export interface ForbiddenHit {
  file: string;
  needle: string;
  reason: string;
}

export function scanForForbiddenTerms(contents: string, file: string): ForbiddenHit[] {
  return FORBIDDEN_TERMS.filter((term) => contents.includes(term.needle)).map((term) => ({
    file,
    needle: term.needle,
    reason: term.reason,
  }));
}
