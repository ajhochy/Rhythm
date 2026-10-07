import type { PairedMacClient } from '@/lib/transport/paired-mac-client';
import type { OpenProjectSessionState } from '@/providers/open-project-session';
import type {
  MobileCoordinatorSessionProvenance,
  MobileSession,
  OpencodeProject,
} from '@/providers/opencode-provider-types';

export type MobileCoordinatorBinding = {
  /** Local view-pointer only; it never crosses the coordinator wire. */
  actorKey: string;
  /** Existing SDK session, used only to guard draft/UI updates. */
  uiSessionId: string;
  /** Authoritative Rhythm local root from paired metadata. */
  sessionId: string;
  /** Opaque paired gateway project ID, never a direct-mode filesystem path. */
  projectId: string;
  /**
   * A catalog root is guarded by its current SDK row. A server-resolved inert
   * root has no SDK identity at all; its view key is explicitly server-root
   * scoped and is never sent as an SDK/session field on the wire.
   */
  source?: 'paired_catalog' | 'server_primary';
};

export type MobileCoordinatorEligibility =
  | { available: true; binding: MobileCoordinatorBinding }
  | { available: false; reason: string };

type SessionWriteState = {
  time?: { archived?: number | null };
  archived?: boolean;
  readOnly?: boolean;
};

/**
 * The paired mobile catalog adds `projectId` without rewriting the engine's
 * `projectID`. The latter can remain an engine hash, so it is intentionally
 * not used as coordinator identity.
 */
type PairedCatalogSession = MobileSession & {
  projectId?: unknown;
};

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function writableRoot(session: MobileSession): boolean {
  const state = session as MobileSession & SessionWriteState;
  return !session.parentID && !state.archived && !state.readOnly && !state.time?.archived;
}

function currentOpenSelectionMatches(
  state: OpenProjectSessionState | undefined,
  projectId: string,
  sessionId: string,
): boolean {
  return state?.kind === 'ready' &&
    state.projectId === projectId &&
    state.sessionId === sessionId;
}

function hasCurrentPairedProvenance(input: {
  actorKey?: string | null;
  activeProjectPath: string;
  localSessionId: string;
  pairedClient: PairedMacClient;
  provenance?: MobileCoordinatorSessionProvenance;
  selectedSession: MobileSession;
}): boolean {
  const { actorKey, activeProjectPath, localSessionId, pairedClient, provenance, selectedSession } = input;
  return Boolean(
    actorKey &&
    provenance &&
    provenance.actorKey === actorKey &&
    provenance.pairedClient === pairedClient &&
    provenance.projectId === activeProjectPath &&
    provenance.uiSessionId === selectedSession.id &&
    provenance.localSessionId === localSessionId,
  );
}

/**
 * Mobile coordination never derives a C1 root identity from an engine SDK ID
 * or worktree. It requires a current actor/host/client-qualified paired
 * catalog observation before a paired root can enter the coordinator wire.
 * A lowercase catalog mirror can corroborate that observation; `projectID`
 * may remain an engine hash and is deliberately not used as identity.
 */
export function resolveMobileCoordinatorBinding(input: {
  actorKey?: string | null;
  pairedClient: PairedMacClient | null;
  currentSessionId?: string;
  selectedSession?: MobileSession;
  activeProjectPath?: string;
  activeProject?: OpencodeProject;
  coordinatorSessionProvenance?: MobileCoordinatorSessionProvenance;
  openProjectSessionState?: OpenProjectSessionState;
  registeredGatewayProjectIds: ReadonlySet<string>;
}): MobileCoordinatorEligibility {
  const {
    actorKey,
    pairedClient,
    currentSessionId,
    selectedSession,
    activeProjectPath,
    activeProject,
    coordinatorSessionProvenance,
    openProjectSessionState,
    registeredGatewayProjectIds,
  } = input;
  if (!pairedClient) {
    return { available: false, reason: 'Coordination is available only through a paired Rhythm connection. Normal chat remains available.' };
  }
  if (!selectedSession || selectedSession.id !== currentSessionId || !writableRoot(selectedSession)) {
    return { available: false, reason: 'Coordination is available only from the current writable root chat.' };
  }
  if (!nonEmpty(activeProjectPath) || !activeProject || activeProject.id !== activeProjectPath ||
    !registeredGatewayProjectIds.has(activeProjectPath)) {
    return { available: false, reason: 'Coordination needs the current paired project catalog. Normal chat remains available.' };
  }

  const localSessionId = selectedSession.rhythm?.localSessionId?.trim();
  if (!localSessionId || !nonEmpty(actorKey)) {
    return { available: false, reason: 'This chat has no authoritative paired Rhythm root yet. Normal chat remains available.' };
  }
  if (!hasCurrentPairedProvenance({
    actorKey,
    activeProjectPath,
    localSessionId,
    pairedClient,
    provenance: coordinatorSessionProvenance,
    selectedSession,
  })) {
    return { available: false, reason: 'Coordination needs a current paired chat catalog. Normal chat remains available.' };
  }

  const pairedSession = selectedSession as PairedCatalogSession;
  const mirrorProjectId = pairedSession.projectId;
  const openSelectionMatches = currentOpenSelectionMatches(
    openProjectSessionState,
    activeProjectPath,
    selectedSession.id,
  );
  // A ready opener state represents the current project/session generation.
  // If it names another scope, an otherwise valid catalog proof may be from a
  // cached selection and must not unlock coordinator writes during the switch.
  if (openProjectSessionState?.kind === 'ready' && !openSelectionMatches) {
    return { available: false, reason: 'Coordination needs the current paired project catalog. Normal chat remains available.' };
  }
  if (nonEmpty(mirrorProjectId) && mirrorProjectId !== activeProjectPath) {
    return { available: false, reason: 'Coordination needs the current paired project catalog. Normal chat remains available.' };
  }
  return {
    available: true,
    binding: {
      actorKey,
      uiSessionId: selectedSession.id,
      sessionId: localSessionId,
      projectId: activeProjectPath,
      source: 'paired_catalog',
    },
  };
}

export const MOBILE_COORDINATOR_UNAVAILABLE_MESSAGE =
  'Coordination is not available from this mobile connection yet. Keep using this chat normally.';
