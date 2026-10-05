import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons';
import { isSessionOffline, sessionPresentation } from '../sessionState';
import { emptyLiveProfile, useFixtures } from '../store';
import { Composer } from './Composer';
import { FocusDialog } from './FocusDialog';
import { Inspector } from './Inspector';
import { ProfileAvatar } from './Profiles';
import { RemoteComputers } from './RemoteComputers';
import { SessionRail } from './SessionRail';
import { Splitter } from './Splitter';
import { formatCost, Transcript } from './Transcript';
import { WorkstreamsPanel } from './WorkstreamsPanel';
import { usePendingDecisions } from '../pending-decisions';
import { mapMessage, sessionLabel, accountOptionLabel, type AgentProject, type RichTranscriptMessage } from '../gateway/sessions';
import { emitAgentNotification } from '../agentNotifications';
import { useAuthUser } from '../gateway/auth';
import { useGateway } from '../gateway/context';
import {
  coordinatorScopeForRootChat,
  type CoordinatorResolveResult,
  type CoordinatorSetupProfileChoice,
  type CoordinatorSetupResult,
} from '../gateway/coordinator-conversations';
import { CoordinatorConversationCard } from './CoordinatorConversationCard';
import { useCoordinatorConversation } from './use-coordinator-conversation';
import {
  matchSwitchSessionKey, matchesCancelTurnKey, matchesNewSessionKey,
  readLocalUserPreferences, USER_PREFERENCES_CHANGED_EVENT,
} from '../gateway/user-preferences';

type RhythmEntry = {
  opening: boolean;
  notice?: string;
  /** Opaque server-returned setup choices, never local profile authority. */
  setup?: { commandKey: string; profileChoices?: CoordinatorSetupProfileChoice[] };
};

type PendingRhythmSetup = {
  generation: number;
  actorId: number;
  gateway: ReturnType<typeof useGateway>;
  originSessionId: string;
  originProjectId?: string;
  commandKey: string;
  profileChoices?: CoordinatorSetupProfileChoice[];
};

function rhythmSetupCommandKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid
    ? `coordinator-setup:${uuid}`
    : `coordinator-setup:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function AgentsWorkspace() {
  const { selected, sessions, profiles, models, accounts, openaiAccounts, refreshCatalog, sessionGatewayMode, saveSessionSettings, connectionMessage: fixtureConnectionMessage, liveSessionError, loading, summarizeSession, prepareLiveSession, startFreshSession, reconnectLiveSession, updateSession: updateFixtureSession, archiveSession, resumeSession, selectSession, createSession, createLiveSession, selectLiveSession, cancelSession, notify, resumeGone, liveChildView, closeLiveChildView } = useFixtures();
  const auth = useAuthUser();
  const gateway = useGateway();
  const preferenceUserId = auth?.user.id ?? 'fixture';
  const live = sessionGatewayMode === 'live';
  const sessionCost = selected.messages.reduce((total, message) => {
    const cost = (message as RichTranscriptMessage).cost;
    return total + (typeof cost === 'number' && Number.isFinite(cost) && cost > 0 ? cost : 0);
  }, 0);
  const pending = usePendingDecisions(selected.id);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const updateSession: typeof updateFixtureSession = (id, patch) => {
    if (!live) { updateFixtureSession(id, patch); return; }
    void saveSessionSettings(id, { fastMode: patch.fastMode });
  };
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [railWidth, setRailWidth] = useState(280);
  const [inspectorWidth, setInspectorWidth] = useState(336);
  const [railCollapsed, setRailCollapsed] = useState(compactLayout);
  // Details is opt-in on every viewport. Keeping its mounted collapsed surface preserves the
  // existing inspector/PTY lifecycle without narrowing the first-activation conversation pane.
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [sessionSettings, setSessionSettings] = useState(false);
  const [workstreamsOpen, setWorkstreamsOpen] = useState(false);
  // Accounts/models can go stale (added/removed elsewhere) while this session is idle in the
  // background — force a refetch whenever the settings dialog that surfaces them opens.
  const openChatConfiguration = () => {
    void refreshCatalog({ force: true });
    setChatConfigurationOpen(true);
    window.dispatchEvent(new CustomEvent('rhythm:open-chat-configuration'));
  };
  const [prepareOpen, setPrepareOpen] = useState(false);
  const chatMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const prepareReturnFocusRef = useRef<HTMLElement | null>(null);
  const openPrepare = (returnFocusTo?: HTMLElement | null) => {
    prepareReturnFocusRef.current = returnFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setPrepareOpen(true);
  };
  const [selectedProject, setSelectedProject] = useState<AgentProject | null>(null);
  const [shortcutRevision, setShortcutRevision] = useState(0);
  useEffect(() => {
    const sync = () => setShortcutRevision((value) => value + 1);
    window.addEventListener('storage', sync);
    window.addEventListener(USER_PREFERENCES_CHANGED_EVENT, sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener(USER_PREFERENCES_CHANGED_EVENT, sync); };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      // Native <details> toggles before React has committed its onToggle state. Claim Escape
      // from an open message-action disclosure synchronously, otherwise a rapid Enter → Escape
      // can fall through to the workspace cancel-turn shortcut during that render gap.
      const openMessageActions = document.querySelector<HTMLDetailsElement>('details.message-actions[open]');
      if (openMessageActions) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          openMessageActions.open = false;
          requestAnimationFrame(() => openMessageActions.querySelector<HTMLElement>('summary')?.focus());
        }
        return;
      }
      if (event.defaultPrevented || document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      const target = event.target as HTMLElement | null;
      const editing = target?.matches('input, textarea, select, [contenteditable="true"]') && target.dataset.testid !== 'composer-input';
      if (editing) return;
      const preferences = readLocalUserPreferences(preferenceUserId);
      if (matchesNewSessionKey(event, preferences.newSessionKey)) {
        event.preventDefault();
        if (live) {
          const profileId = profiles.find((profile) => profile.enabled && profile.selectable && profile.isDefault)?.id
            ?? profiles.find((profile) => profile.enabled && profile.selectable)?.id;
          if (profileId) void createLiveSession({ name: '', cwd: selectedProject?.cwd ?? selected.cwd, ...(selectedProject ? { projectId: selectedProject.id } : {}), profileId, isolateWorktree: false })
            .catch((error) => notify(error instanceof Error ? error.message : 'Session creation failed'));
        } else createSession();
        return;
      }
      if (matchesCancelTurnKey(event, preferences.cancelTurnKey)) {
        if (selected.status !== 'working') return;
        event.preventDefault();
        cancelSession(selected.id);
        return;
      }
      const direction = matchSwitchSessionKey(event, preferences.switchSessionKey);
      if (!direction) return;
      const sessionIds = new Set(sessions.map((session) => session.id));
      const railOrder = [...document.querySelectorAll<HTMLElement>('button[data-testid^="session-"]')]
        .map((node) => node.dataset.testid?.slice('session-'.length) ?? '')
        .filter((id) => sessionIds.has(id));
      const current = railOrder.indexOf(selected.id);
      if (current < 0 || railOrder.length < 2) return;
      event.preventDefault();
      const offset = direction === 'previous' ? -1 : 1;
      const nextId = railOrder[(current + offset + railOrder.length) % railOrder.length];
      if (nextId) { if (live) void selectLiveSession(nextId); else selectSession(nextId); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [cancelSession, createLiveSession, createSession, live, notify, preferenceUserId, profiles, selectLiveSession, selectSession, selected.cwd, selected.id, selected.status, selectedProject, sessions, shortcutRevision]);
  useEffect(() => {
    const sync = () => emitAgentNotification({ v: 1, type: 'viewing', sessionId: selected.id || null,
      displayed: Boolean(selected.id && !loading && !selectedProject && !liveChildView && window.location.hash.startsWith('#/agents')) }, live);
    sync();
    window.addEventListener('hashchange', sync);
    return () => { window.removeEventListener('hashchange', sync); emitAgentNotification({ v: 1, type: 'viewing', sessionId: null, displayed: false }, live); };
  }, [selected.id, loading, selectedProject, liveChildView, live]);
  useEffect(() => { setSelectedProject(null); }, [selected.id]);
  const [retrying, setRetrying] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const connectionMessage = live ? retrying ? 'Reconciling session…' : liveSessionError ?? (loading ? 'Loading session…' : fixtureConnectionMessage === 'Desktop connected' ? 'Session loaded' : fixtureConnectionMessage) : fixtureConnectionMessage;
  const [chatConfigurationOpen, setChatConfigurationOpen] = useState(false);
  const [resizeAnnouncement, setResizeAnnouncement] = useState('');
  const [activityAnnouncement, setActivityAnnouncement] = useState('');
  const previousStatus = useRef(selected.status);
  const previousConnection = useRef(connectionMessage);
  // ponytail: a real workspace with zero configured agent profiles is a legitimate live state
  // (fresh install, all profiles deleted) — fall back to a placeholder instead of crashing on
  // undefined.icon/.label when `profiles` resolves empty.
  const profile = profiles.find((item) => item.id === selected.profileId) ?? profiles[0] ?? emptyLiveProfile();
  const parentId = selected.parentId;
  const parent = parentId ? sessions.find((session) => session.id === parentId) : undefined;
  const readOnlyChild = live ? Boolean(liveChildView) : Boolean(parent);
  const coordinatorScope = useMemo(() => coordinatorScopeForRootChat({
    actorKey: auth?.user.id ? `user:${auth.user.id}` : 'desktop-local',
    sessionId: selected.id,
    projectId: selected.projectId,
    parentSessionId: readOnlyChild ? 'child-session' : selected.parentId,
    writable: !selectedProject && !readOnlyChild && selected.group !== 'archived' && !selected.completedAt,
    mode: gateway.mode,
  }), [auth?.user.id, gateway.mode, readOnlyChild, selected.completedAt, selected.group, selected.id, selected.parentId, selected.projectId, selectedProject]);
  const coordinator = useCoordinatorConversation(
    coordinatorScope,
    gateway.domains.coordinatorConversations,
    auth?.user.id ? `user:${auth.user.id}` : 'desktop-local',
  );
  // Coordinator history is never synthesized from an acknowledgement: these
  // rows are the bounded server page mapped by the same normal-session
  // mapper. If the actual root is selected, live SDK events can refine the
  // matching row while it streams; a different selected chat is never mixed.
  const coordinatorTranscript = useMemo(() => {
    const history = coordinator.state.canonicalHistory;
    if (!coordinator.state.enabled || !history) return undefined;
    const rows = new Map<string, RichTranscriptMessage>();
    history.messages.forEach((row) => {
      const mapped = mapMessage(row);
      if (mapped.id) rows.set(mapped.id, mapped);
    });
    if (selected.id === history.conversation.sessionId && selected.projectId === history.conversation.projectId) {
      (selected.messages as RichTranscriptMessage[]).forEach((message) => rows.set(message.id, message));
    }
    return {
      messages: [...rows.values()].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id)),
      hasMore: history.hasMore,
      loadingOlder: coordinator.state.canonicalHistoryLoading,
      loadOlder: coordinator.loadOlderHistory,
    };
  }, [coordinator.loadOlderHistory, coordinator.state.canonicalHistory, coordinator.state.canonicalHistoryLoading, coordinator.state.enabled, selected.id, selected.messages, selected.projectId]);
  // This ephemeral navigation fence is deliberately not a coordinator journal
  // or transcript. The server remains the sole owner of the durable primary
  // root; it only prevents a late resolve from moving a different signed-in
  // user or newly selected chat.
  const rhythmResolveGeneration = useRef(0);
  const rhythmActorRef = useRef(auth?.user.id);
  rhythmActorRef.current = auth?.user.id;
  const rhythmGatewayRef = useRef(gateway);
  rhythmGatewayRef.current = gateway;
  const rhythmSelectionRef = useRef({ sessionId: selected.id, projectId: selected.projectId });
  rhythmSelectionRef.current = { sessionId: selected.id, projectId: selected.projectId };
  const rhythmSetupRef = useRef<PendingRhythmSetup | null>(null);
  // The rail disables after React commits, but two native click events can be
  // delivered before that commit. Keep the one primary-entry operation
  // synchronous as well, so a first-use setup key is never replaced by a
  // second click.
  const rhythmOpeningRef = useRef(false);
  const rhythmSetupRequestRef = useRef<string | null>(null);
  const rhythmPrimaryRef = useRef<{
    generation: number;
    actorId: number;
    gateway: typeof gateway;
    sessionId: string;
    projectId: string;
    originSessionId: string;
    originProjectId?: string;
    selectionRequested?: boolean;
    opening?: boolean;
  } | null>(null);
  const dayflowConsentGeneration = useRef(0);
  const dayflowConsentAbort = useRef<AbortController | null>(null);
  const [dayflowConsentNotice, setDayflowConsentNotice] = useState<string>();
  const [rhythmEntry, setRhythmEntry] = useState<RhythmEntry>({ opening: false });
  // Selecting an already-active server root does not change the ordinary
  // selection dependencies below. Keep a small local navigation revision so
  // the primary handoff still starts its existing coordinator open path.
  const [rhythmPrimaryNavigationRevision, setRhythmPrimaryNavigationRevision] = useState(0);
  const releaseRhythmOpening = useCallback((generation: number) => {
    // A selection/account/gateway change increments this generation before a
    // later click may begin. An old completion must never unlock that newer
    // primary-entry operation.
    if (generation === rhythmResolveGeneration.current) rhythmOpeningRef.current = false;
  }, []);
  const navigateRhythmRoot = useCallback(async (
    resolved: Extract<CoordinatorResolveResult, { kind: 'resolved' }> | Extract<CoordinatorSetupResult, { kind: 'setup_created' | 'setup_replay' }>,
    input: { generation: number; actorId: number; requestGateway: typeof gateway; requestSelection: { sessionId: string; projectId?: string } },
  ): Promise<boolean> => {
    if (resolved.conversation.primaryOwnerRoot !== true) {
      setRhythmEntry({ opening: false, notice: 'Rhythm could not open its chat. Your ordinary chats are unchanged.' });
      return false;
    }
    rhythmPrimaryRef.current = {
      generation: input.generation,
      actorId: input.actorId,
      gateway: input.requestGateway,
      sessionId: resolved.sessionId,
      projectId: resolved.projectId,
      originSessionId: input.requestSelection.sessionId,
      originProjectId: input.requestSelection.projectId,
    };
    // Refresh then open only the server-returned root. No client-created
    // session, SDK prompt, or project rewriting occurs here.
    await refreshCatalog({ force: true });
    if (
      input.generation !== rhythmResolveGeneration.current ||
      rhythmActorRef.current !== input.actorId ||
      rhythmGatewayRef.current !== input.requestGateway
    ) return false;
    if (
      rhythmSelectionRef.current.sessionId !== input.requestSelection.sessionId ||
      rhythmSelectionRef.current.projectId !== input.requestSelection.projectId
    ) {
      rhythmPrimaryRef.current = null;
      setRhythmEntry({ opening: false, notice: 'Rhythm selection changed. Your ordinary chats are unchanged.' });
      return false;
    }
    rhythmPrimaryRef.current.selectionRequested = true;
    await selectLiveSession(resolved.sessionId);
    if (
      input.generation !== rhythmResolveGeneration.current ||
      rhythmActorRef.current !== input.actorId ||
      rhythmGatewayRef.current !== input.requestGateway
    ) return false;
    setRhythmPrimaryNavigationRevision((revision) => revision + 1);
    setRhythmEntry({ opening: true, notice: 'Opening Rhythm…' });
    return true;
  }, [refreshCatalog, selectLiveSession]);
  const startRhythmSetup = useCallback(async (profileId?: string): Promise<boolean> => {
    const pending = rhythmSetupRef.current;
    const coordinatorGateway = gateway.domains.coordinatorConversations;
    const actorId = auth?.user.id;
    const requestGateway = gateway;
    if (!pending || !coordinatorGateway?.setup || !actorId || pending.actorId !== actorId || pending.gateway !== requestGateway) {
      rhythmOpeningRef.current = false;
      setRhythmEntry({ opening: false, notice: 'Rhythm setup is not available for this chat. Your ordinary chats are unchanged.' });
      return false;
    }
    if (profileId !== undefined && !pending.profileChoices?.some((choice) => choice.id === profileId)) {
      rhythmOpeningRef.current = false;
      setRhythmEntry({ opening: false, notice: 'Choose one of the listed Rhythm profiles.', setup: { commandKey: pending.commandKey, profileChoices: pending.profileChoices } });
      return false;
    }
    if (rhythmSetupRequestRef.current === pending.commandKey) return false;
    rhythmSetupRequestRef.current = pending.commandKey;
    rhythmOpeningRef.current = true;
    const generation = ++rhythmResolveGeneration.current;
    const attempt: PendingRhythmSetup = { ...pending, generation };
    rhythmSetupRef.current = attempt;
    setRhythmEntry({ opening: true, notice: 'Setting up Rhythm…', setup: { commandKey: attempt.commandKey, profileChoices: attempt.profileChoices } });
    try {
      // This is an explicit user action. The closed setup request contains
      // only its idempotency key and an optional opaque server-returned choice.
      const result = await coordinatorGateway.setup({
        commandKey: attempt.commandKey,
        ...(profileId === undefined ? {} : { profileId }),
      });
      if (
        rhythmSetupRef.current !== attempt ||
        generation !== rhythmResolveGeneration.current ||
        rhythmActorRef.current !== actorId ||
        rhythmGatewayRef.current !== requestGateway
      ) return false;
      if (
        rhythmSelectionRef.current.sessionId !== attempt.originSessionId ||
        rhythmSelectionRef.current.projectId !== attempt.originProjectId
      ) {
        releaseRhythmOpening(generation);
        setRhythmEntry({ opening: false, notice: 'Rhythm selection changed. Your ordinary chats are unchanged.' });
        return false;
      }
      if (result.kind === 'setup_profile_choice_required') {
        attempt.profileChoices = result.profileChoices;
        releaseRhythmOpening(generation);
        setRhythmEntry({
          opening: false,
          notice: 'Choose a Rhythm profile to finish setup.',
          setup: { commandKey: attempt.commandKey, profileChoices: result.profileChoices },
        });
        return false;
      }
      if (result.kind === 'setup_created' || result.kind === 'setup_replay') {
        // The server-created root is now the authoritative setup replay
        // target. Clear this local menu pointer before selecting that root so
        // the origin-selection fence does not mistake the normal handoff for
        // a user navigation away from setup.
        rhythmSetupRef.current = null;
        const navigated = await navigateRhythmRoot(result, {
          generation,
          actorId,
          requestGateway,
          requestSelection: { sessionId: attempt.originSessionId, projectId: attempt.originProjectId },
        });
        if (!navigated) releaseRhythmOpening(generation);
        return navigated;
      }
      releaseRhythmOpening(generation);
      setRhythmEntry({ opening: false, notice: 'Rhythm setup is unavailable right now. Your ordinary chats are unchanged.', setup: { commandKey: attempt.commandKey, profileChoices: attempt.profileChoices } });
      return false;
    } catch {
      if (
        rhythmSetupRef.current === attempt &&
        generation === rhythmResolveGeneration.current &&
        rhythmActorRef.current === actorId &&
        rhythmGatewayRef.current === requestGateway
      ) {
        // A failed acknowledgement can still have reached the server. Keep
        // the exact setup key instead of making a second allocation request.
        releaseRhythmOpening(generation);
        setRhythmEntry({ opening: false, notice: 'Rhythm setup could not be confirmed. Retry when you are ready.', setup: { commandKey: attempt.commandKey, profileChoices: attempt.profileChoices } });
      }
      return false;
    } finally {
      if (rhythmSetupRequestRef.current === attempt.commandKey) rhythmSetupRequestRef.current = null;
    }
  }, [auth?.user.id, gateway, navigateRhythmRoot, releaseRhythmOpening]);
  const openRhythmPrimary = useCallback(async () => {
    if (rhythmOpeningRef.current) return;
    const coordinatorGateway = gateway.domains.coordinatorConversations;
    const actorId = auth?.user.id;
    const requestGateway = gateway;
    const requestSelection = { ...rhythmSelectionRef.current };
    if (!live || !actorId || !coordinatorGateway?.resolve) {
      setRhythmEntry({ opening: false, notice: 'Rhythm is unavailable here. Your ordinary chats are unchanged.' });
      return;
    }
    const existingSetup = rhythmSetupRef.current;
    if (
      existingSetup &&
      existingSetup.actorId === actorId &&
      existingSetup.gateway === requestGateway &&
      existingSetup.originSessionId === requestSelection.sessionId &&
      existingSetup.originProjectId === requestSelection.projectId
    ) {
      if (existingSetup.profileChoices?.length) {
        setRhythmEntry({
          opening: false,
          notice: 'Choose a Rhythm profile to finish setup.',
          setup: { commandKey: existingSetup.commandKey, profileChoices: existingSetup.profileChoices },
        });
        return;
      }
      rhythmOpeningRef.current = true;
      await startRhythmSetup();
      return;
    }
    const generation = ++rhythmResolveGeneration.current;
    rhythmOpeningRef.current = true;
    rhythmPrimaryRef.current = null;
    rhythmSetupRef.current = null;
    setRhythmEntry({ opening: true, notice: 'Opening Rhythm…' });
    try {
      const resolved = await coordinatorGateway.resolve(
        selected.projectId?.trim() ? { projectId: selected.projectId } : {},
      );
      if (generation !== rhythmResolveGeneration.current || rhythmActorRef.current !== actorId || rhythmGatewayRef.current !== requestGateway) return;
      if (
        rhythmSelectionRef.current.sessionId !== requestSelection.sessionId ||
        rhythmSelectionRef.current.projectId !== requestSelection.projectId
      ) {
        releaseRhythmOpening(generation);
        setRhythmEntry({ opening: false, notice: 'Rhythm selection changed. Your ordinary chats are unchanged.' });
        return;
      }
      if (resolved.kind === 'setup_unavailable') {
        const setup: PendingRhythmSetup = {
          generation,
          actorId,
          gateway: requestGateway,
          originSessionId: requestSelection.sessionId,
          originProjectId: requestSelection.projectId,
          commandKey: rhythmSetupCommandKey(),
        };
        rhythmSetupRef.current = setup;
        // Resolve intentionally does not allocate an inert root. Immediately
        // continue through the explicit, server-validated setup exchange so
        // first use either reaches the root or visibly asks for a profile.
        await startRhythmSetup();
        return;
      }
      if (resolved.kind !== 'resolved' || resolved.conversation.primaryOwnerRoot !== true) {
        releaseRhythmOpening(generation);
        setRhythmEntry({ opening: false, notice: 'Rhythm is not available for this chat. Your ordinary chats are unchanged.' });
        return;
      }
      const navigated = await navigateRhythmRoot(resolved, { generation, actorId, requestGateway, requestSelection });
      if (!navigated) releaseRhythmOpening(generation);
    } catch {
      if (generation === rhythmResolveGeneration.current && rhythmActorRef.current === actorId && rhythmGatewayRef.current === requestGateway) {
        releaseRhythmOpening(generation);
        setRhythmEntry({ opening: false, notice: 'Rhythm could not be opened. Your ordinary chats are unchanged.' });
      }
    }
  }, [auth?.user.id, gateway, live, navigateRhythmRoot, releaseRhythmOpening, selected.projectId, startRhythmSetup]);
  useEffect(() => () => {
    rhythmResolveGeneration.current += 1;
    rhythmSetupRef.current = null;
    rhythmSetupRequestRef.current = null;
    rhythmOpeningRef.current = false;
  }, []);
  useEffect(() => {
    dayflowConsentGeneration.current += 1;
    dayflowConsentAbort.current?.abort();
    dayflowConsentAbort.current = null;
    setDayflowConsentNotice(undefined);
  }, [auth?.user.id, gateway, selected.id, selected.projectId]);
  useEffect(() => () => { dayflowConsentAbort.current?.abort(); }, []);
  useEffect(() => {
    const setup = rhythmSetupRef.current;
    if (!setup || (setup.originSessionId === selected.id && setup.originProjectId === selected.projectId)) return;
    rhythmResolveGeneration.current += 1;
    rhythmSetupRef.current = null;
    rhythmSetupRequestRef.current = null;
    rhythmOpeningRef.current = false;
    // A dismissed dialog intentionally has no visible `setup` state, but its
    // retained pointer still belongs only to the origin chat.
    setRhythmEntry({ opening: false, notice: 'Rhythm selection changed. Your ordinary chats are unchanged.' });
  }, [selected.id, selected.projectId]);
  useEffect(() => {
    const pendingPrimary = rhythmPrimaryRef.current;
    if (!pendingPrimary || pendingPrimary.opening) return;
    if (
      pendingPrimary.generation !== rhythmResolveGeneration.current ||
      pendingPrimary.actorId !== rhythmActorRef.current ||
      pendingPrimary.gateway !== rhythmGatewayRef.current
    ) {
      rhythmPrimaryRef.current = null;
      releaseRhythmOpening(pendingPrimary.generation);
      return;
    }
    const currentSelection = rhythmSelectionRef.current;
    if (
      !coordinatorScope ||
      selected.id !== pendingPrimary.sessionId ||
      selected.projectId !== pendingPrimary.projectId
    ) {
      // While the requested root selection is committing, React can still
      // render the origin chat. Any third selection is user/navigation input,
      // not permission for this late resolve to move it back.
      if (
        pendingPrimary.selectionRequested &&
        // `selectLiveSession` sets the selected local id before its detail
        // row reaches the store. During that normal handoff the workspace
        // briefly renders the empty live-session placeholder. It is neither
        // an actor/project switch nor a user navigation away from the root.
        // A nonempty third session still cancels this late entry request.
        currentSelection.sessionId !== '' &&
        currentSelection.sessionId !== pendingPrimary.sessionId &&
        (currentSelection.sessionId !== pendingPrimary.originSessionId ||
          currentSelection.projectId !== pendingPrimary.originProjectId)
      ) {
        // Fence the still-awaited selectLiveSession continuation as well as
        // the visible card effect. Otherwise its late completion can repaint
        // "Opening" after a user deliberately chose another chat.
        rhythmResolveGeneration.current += 1;
        rhythmPrimaryRef.current = null;
        rhythmOpeningRef.current = false;
        setRhythmEntry({ opening: false, notice: 'Rhythm selection changed. Your ordinary chats are unchanged.' });
      }
      return;
    }
    pendingPrimary.opening = true;
    void coordinator.open().then((opened) => {
      if (rhythmPrimaryRef.current !== pendingPrimary || pendingPrimary.generation !== rhythmResolveGeneration.current) return;
      rhythmPrimaryRef.current = null;
      releaseRhythmOpening(pendingPrimary.generation);
      setRhythmEntry(opened
        ? { opening: false, notice: 'Rhythm is ready.' }
        : { opening: false, notice: 'Rhythm could not be opened. Your ordinary chats are unchanged.' });
    });
  }, [auth?.user.id, coordinator, coordinatorScope, gateway, releaseRhythmOpening, rhythmPrimaryNavigationRevision, selected.id, selected.projectId]);
  const backToParent = () => { if (liveChildView) closeLiveChildView(); else if (parent) selectSession(parent.id); };
  const presentation = sessionPresentation(selected);
  const recoverableConnection = Boolean(live && liveSessionError) || isSessionOffline(selected) || selected.connectionState === 'unavailable' || Boolean(selected.stuckSince);
  const lifecycleDisabled = lifecycleBusy || live && (!selected.id || readOnlyChild || selected.status === 'working' || selected.status === 'starting');
  const compactSession = async () => {
    if (lifecycleDisabled) return;
    setLifecycleBusy(true);
    try { await summarizeSession(selected.id); } finally { setLifecycleBusy(false); }
  };
  const prepareProject = async () => {
    if (lifecycleDisabled) return;
    if (!live) { setPrepareOpen(false); notify('Project prepared for agents'); return; }
    setLifecycleBusy(true);
    try { if (await prepareLiveSession(selected.id)) setPrepareOpen(false); } finally { setLifecycleBusy(false); }
  };
  const retryConnection = async () => {
    if (retrying) return;
    setRetrying(true);
    try { if (live) await reconnectLiveSession(); else { resumeSession(selected.id); notify('Desktop connection restored'); } }
    catch { /* The store retains the reconciliation error for the header. */ }
    finally { setRetrying(false); }
  };

  useEffect(() => { setRetrying(false); setChatConfigurationOpen(false); previousStatus.current = selected.status; previousConnection.current = connectionMessage; }, [selected.id]);
  useEffect(() => {
    const syncConfigurationVisibility = (event: Event) => setChatConfigurationOpen(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener('rhythm:chat-configuration-visibility', syncConfigurationVisibility);
    return () => window.removeEventListener('rhythm:chat-configuration-visibility', syncConfigurationVisibility);
  }, []);
  useEffect(() => {
    if (previousStatus.current === 'working' && selected.status !== 'working') setActivityAnnouncement('Agent response complete.');
    previousStatus.current = selected.status;
  }, [selected.status]);
  useEffect(() => {
    if (previousConnection.current !== connectionMessage) setActivityAnnouncement(`Connection status: ${connectionMessage}`);
    previousConnection.current = connectionMessage;
  }, [connectionMessage]);
  const waitingForDecision = live ? !liveChildView && Boolean(pending.permissions.size || pending.questions.size) : selected.permission?.status === 'pending' || selected.question?.status === 'pending';
  useEffect(() => {
    if (waitingForDecision) setActivityAnnouncement('Agent is waiting for your decision.');
  }, [waitingForDecision]);
  const latestAssistant = [...selected.messages].reverse().find((message) => message.role === 'assistant');
  const goToActivity = () => {
    const target = waitingForDecision ? document.querySelector<HTMLElement>('[data-agent-decision="true"]') : latestAssistant ? document.getElementById(`agent-message-${latestAssistant.id}`) : null;
    target?.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const change = (event: MediaQueryListEvent) => {
      setCompactLayout(event.matches);
      if (event.matches) { setRailCollapsed(true); setInspectorCollapsed(true); }
    };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  const resizeRail = useCallback((size: number) => { setRailWidth(size); setResizeAnnouncement(`Sessions rail width ${size} pixels`); }, []);
  const resizeInspector = useCallback((size: number) => { setInspectorWidth(size); setResizeAnnouncement(`Inspector width ${size} pixels`); }, []);
  const toggleRail = () => {
    setRailCollapsed((value) => {
      if (compactLayout && value) setInspectorCollapsed(true);
      return !value;
    });
  };
  const toggleInspector = () => {
    setInspectorCollapsed((value) => {
      if (compactLayout && value) setRailCollapsed(true);
      return !value;
    });
  };
  const canManageDayflowSource = Boolean(
    live &&
    gateway.domains.dayflowSourceConsent &&
    coordinator.state.enabled &&
    coordinator.state.conversation?.schemaVersion === 3 &&
    coordinator.state.conversation.primaryOwnerRoot === true &&
    coordinator.state.conversation.sessionId === selected.id &&
    coordinator.state.conversation.projectId === selected.projectId,
  );
  const requestDayflowSourceConsent = useCallback(async (action: 'grant' | 'revoke') => {
    const consentGateway = gateway.domains.dayflowSourceConsent;
    const actorId = auth?.user.id;
    const conversation = coordinator.state.conversation;
    const selection = { sessionId: selected.id, projectId: selected.projectId };
    if (!consentGateway || !actorId || !conversation || conversation.schemaVersion !== 3 || conversation.primaryOwnerRoot !== true ||
      conversation.sessionId !== selection.sessionId || conversation.projectId !== selection.projectId) {
      setDayflowConsentNotice('Dayflow source controls are unavailable for this chat.');
      return;
    }
    const generation = ++dayflowConsentGeneration.current;
    dayflowConsentAbort.current?.abort();
    const controller = new AbortController();
    dayflowConsentAbort.current = controller;
    setDayflowConsentNotice(action === 'grant' ? 'Allowing Dayflow context…' : 'Removing Dayflow context…');
    try {
      const result = await consentGateway.setSourceConsent({
        action,
        sessionId: selection.sessionId,
        projectId: selection.projectId,
      }, controller.signal);
      if (
        generation !== dayflowConsentGeneration.current ||
        rhythmActorRef.current !== actorId ||
        rhythmGatewayRef.current !== gateway ||
        rhythmSelectionRef.current.sessionId !== selection.sessionId ||
        rhythmSelectionRef.current.projectId !== selection.projectId
      ) return;
      setDayflowConsentNotice(result.status === 'accepted'
        ? (action === 'grant' ? 'Dayflow context request accepted. Refresh to see current source availability.' : 'Dayflow context removal request accepted. Refresh to see current source availability.')
        : 'Dayflow source controls are unavailable. No local consent was changed.');
    } catch {
      // Abort, network, and malformed responses all remain closed. Do not
      // disclose transport details or represent an unverified local grant.
      if (generation === dayflowConsentGeneration.current) {
        setDayflowConsentNotice('Dayflow source controls are unavailable. No local consent was changed.');
      }
    } finally {
      if (dayflowConsentAbort.current === controller) dayflowConsentAbort.current = null;
    }
  }, [auth?.user.id, coordinator.state.conversation, gateway, selected.id, selected.projectId]);
  const deferRhythmSetup = () => {
    rhythmOpeningRef.current = false;
    setRhythmEntry((current) => current.setup ? {
      opening: false,
      notice: current.setup.profileChoices?.length
        ? 'Rhythm setup is waiting for your profile choice.'
        : 'Rhythm setup is ready to retry.',
    } : current);
  };
  const secondaryChatActions = (closeConfigurationThen: (action: () => void) => void) => <>
    {rhythmEntry.setup ? <button type="button" className="secondary-button" disabled={rhythmEntry.opening} onClick={() => closeConfigurationThen(() => {
      const pendingSetup = rhythmSetupRef.current;
      if (pendingSetup?.profileChoices?.length) {
        setRhythmEntry({
          opening: false,
          notice: 'Choose a Rhythm profile to finish setup.',
          setup: { commandKey: pendingSetup.commandKey, profileChoices: pendingSetup.profileChoices },
        });
      } else void startRhythmSetup();
    })} data-testid="session-actions-rhythm-setup"><Icon name="agents" size={14} />Set up Rhythm</button> : null}
    {coordinatorScope ? <button type="button" className="secondary-button" onClick={() => closeConfigurationThen(() => { void coordinator.open(); })} data-testid="session-actions-coordinate"><Icon name="agents" size={14} />Coordinate with Rhythm</button> : null}
    {canManageDayflowSource ? <>
      <button type="button" className="secondary-button" onClick={() => closeConfigurationThen(() => { void requestDayflowSourceConsent('grant'); })} data-testid="session-actions-dayflow-allow">Allow Dayflow context</button>
      <button type="button" className="secondary-button" onClick={() => closeConfigurationThen(() => { void requestDayflowSourceConsent('revoke'); })} data-testid="session-actions-dayflow-remove">Remove Dayflow context</button>
    </> : null}
    <button type="button" className="secondary-button" onClick={() => closeConfigurationThen(() => { void refreshCatalog({ force: true }); setSessionSettings(true); })} data-testid="session-actions-session-defaults"><Icon name="rename" size={14} />Session defaults and account</button>
    <button type="button" className="secondary-button" disabled={lifecycleDisabled} onClick={() => closeConfigurationThen(() => { void compactSession(); })} data-testid="session-actions-compact"><Icon name="spark" size={14} />Compact session</button>
    <button type="button" className="secondary-button" disabled={lifecycleDisabled} onClick={() => closeConfigurationThen(() => openPrepare(chatMenuTriggerRef.current))} data-testid="session-actions-prepare"><Icon name="worktree" size={14} />Prepare project for agents</button>
    <button type="button" className="secondary-button" disabled={live && (!selected.id || readOnlyChild)} onClick={() => closeConfigurationThen(() => archiveSession(selected.id))} data-testid="session-actions-archive"><Icon name="archive" size={14} />Archive session</button>
    <button type="button" className="secondary-button" onClick={() => closeConfigurationThen(() => notify('Session view closed; selection remains in the rail'))} data-testid="session-actions-close"><Icon name="close" size={14} />Close session view</button>
  </>;

  // #1374 — remote attach replaces the whole workspace surface rather than nesting inside the
  // local conversation-pane grid, so the local session header/transcript/composer rows this
  // component otherwise renders are entirely untouched by remote mode.
  if (remoteOpen) return <RemoteComputers onClose={() => setRemoteOpen(false)} />;

  return (
    <section className="agents-workspace" aria-label="Agents workspace" style={{
      '--rail-width': railCollapsed ? '48px' : `${railWidth}px`,
      '--inspector-resizer-width': inspectorCollapsed ? '0px' : '8px',
      '--inspector-width': inspectorCollapsed ? 'var(--collapsed-inspector-width)' : `${inspectorWidth}px`,
    } as React.CSSProperties} data-od-id="agents-workspace">
      <SessionRail collapsed={railCollapsed} onToggle={toggleRail} selectedProject={selectedProject} onSelectProject={setSelectedProject} onOpenRemoteComputers={() => setRemoteOpen(true)} onOpenRhythm={() => { void openRhythmPrimary(); }} rhythmOpening={rhythmEntry.opening} />
      {!railCollapsed && <Splitter orientation="vertical" storageKey="layout.agents.rail" min={228} max={380} defaultSize={280} onResize={resizeRail} ariaLabel="Resize Agents rail" className="rail-resize" testId="rail-resizer" />}
      <section className="conversation-pane" aria-label={selectedProject ? 'Selected agent project' : 'Active agent session'} data-od-id="active-agent-session">
        {selectedProject ? <div className="agent-project-empty" role="status" data-testid="selected-agent-project"><Icon name="worktree" size={28} /><h1>{selectedProject.name}</h1><p className="rail-project-path">{selectedProject.cwd}</p><p>No session selected. Use New session in the Agents rail to start here.</p><button className="secondary-button" type="button" onClick={() => setSelectedProject(null)}>Back to sessions</button></div> : <>
        <header className="session-header">
          <div className="session-identity">
            <ProfileAvatar profile={profile} />
            <div className="session-title-copy">
              {readOnlyChild && <button className="child-breadcrumb" type="button" onClick={backToParent} aria-label={`Back to parent session ${sessionLabel(parent ?? selected).label}`} data-testid="child-back"><Icon name="chevronRight" className="rotate-180" size={12} />{parent ? parent.name : selected.name}</button>}
              <div className="identity-line"><strong>{profile.label}</strong>{selected.account && <button type="button" onClick={openChatConfiguration}>{selected.account}<Icon name="chevronDown" size={11} /></button>}<span className={`status-label ${presentation.tone}`}><i />{presentation.label}</span></div>
              <h1 className={!liveChildView && sessionLabel(selected).fallback ? 'session-name-fallback' : undefined}>{liveChildView ? liveChildView.title : sessionLabel(selected).label}</h1>
              <div className="session-meta"><span><Icon name="branch" size={13} />{selected.branch}</span>{selected.dirtyCount > 0 && <span className="dirty-badge">{selected.dirtyCount} changed</span>}{selected.isolateWorktree && <span className="worktree-badge"><Icon name="worktree" size={12} />worktree</span>}{readOnlyChild && <span className="readonly-badge">Read only</span>}<span className="session-connection" aria-live="polite" data-testid="connection-status"><i className={`status-dot ${connectionMessage.toLowerCase().includes('offline') || connectionMessage.toLowerCase().includes('unavailable') ? 'offline' : 'working'}`} />{connectionMessage}</span></div>
              {rhythmEntry.notice ? <p className="coordinator-conversation-notice" role="status" aria-live="polite" aria-atomic="true" data-testid="rhythm-primary-status">{rhythmEntry.notice}</p> : null}
              {dayflowConsentNotice ? <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="dayflow-source-consent-status">{dayflowConsentNotice}</p> : null}
              {resumeGone && resumeGone.id === selected.id && <div className="form-error" role="alert" data-testid="resume-gone-alert"><p>{resumeGone.message}</p><button className="secondary-button" type="button" disabled={lifecycleBusy} onClick={async () => { setLifecycleBusy(true); try { await startFreshSession(selected.id); } finally { setLifecycleBusy(false); } }}>Start fresh</button></div>}
            </div>
          </div>
          <div className="session-header-actions">
            {(waitingForDecision || latestAssistant) && <button className="text-button compact" type="button" onClick={goToActivity} data-testid="agent-go-to-activity">{waitingForDecision ? 'Go to decision' : 'Go to latest response'}</button>}
            {sessionCost > 0 && <span className="session-cost" title="Total loaded session cost" data-testid="session-cost">{formatCost(sessionCost)}</span>}
            {recoverableConnection && <button className="secondary-button compact" type="button" disabled={retrying} onClick={() => void retryConnection()} data-testid="session-retry"><Icon name="refresh" className={retrying ? 'spin' : ''} size={14} />{retrying ? 'Retrying' : 'Reconnect'}</button>}
            <button className="icon-button small" type="button" disabled={lifecycleDisabled} onClick={() => void compactSession()} aria-label="Compact session" title="Compact session" data-testid="session-compact"><Icon name="spark" size={15} /></button>
            <button className="secondary-button prepare-button" type="button" disabled={lifecycleDisabled} onClick={() => openPrepare()} data-testid="prepare-project" aria-label="Prepare project for agents" title="Prepare project for agents"><Icon name="worktree" size={14} /><span>Prepare project</span></button>
            <button className="secondary-button compact" type="button" onClick={() => setWorkstreamsOpen(true)} data-testid="workstreams-open">Workstreams</button>
            <button className="secondary-button compact" type="button" onClick={toggleInspector} aria-expanded={!inspectorCollapsed} aria-controls="session-inspector" data-testid="session-details">Details</button>
            <button ref={chatMenuTriggerRef} className="icon-button small" type="button" aria-label="Chat menu" aria-haspopup="dialog" aria-expanded={chatConfigurationOpen} onClick={openChatConfiguration} data-testid="session-actions"><Icon name="more" size={16} /></button>
          </div>
        </header>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="agent-activity-status">{activityAnnouncement}</span>
        <div className="transcript-reader"><Transcript coordinatorTranscript={coordinatorTranscript} coordinatorStatus={coordinatorScope ? <CoordinatorConversationCard
          state={coordinator.state}
          onRefresh={() => { void coordinator.refresh(); }}
          onRetry={() => { void coordinator.retry(); }}
          onRetryPlan={() => { void coordinator.retryPlan(); }}
          onPreparePlan={(goalId, consent) => { void coordinator.preparePlan(goalId, consent); }}
          onContinuePlan={(goalId, authorizationId) => { void coordinator.continuePlan(goalId, authorizationId); }}
          onReviewConflict={() => { void coordinator.reviewConflict(); }}
          onBeginNewMessageAfterReview={coordinator.beginNewMessageAfterReview}
          onReturnToNormal={coordinator.returnToNormal}
          onInspectWorkstream={() => setWorkstreamsOpen(true)}
        /> : undefined} /></div>
        {!liveChildView && <Composer renderSecondaryChatActions={secondaryChatActions} coordinator={coordinatorScope ? { active: coordinator.state.enabled, onSend: coordinator.send } : undefined} />}
        </>}
      </section>
      {!inspectorCollapsed && <Splitter orientation="vertical" storageKey="layout.agents.inspector" min={286} max={470} defaultSize={336} onResize={resizeInspector} ariaLabel="Resize Inspector" resizeEdge="end" className="inspector-resize" testId="inspector-resizer" />}
      {selectedProject ? <aside className={`inspector${inspectorCollapsed ? ' collapsed' : ''}`} aria-label="Project context" /> : <Inspector collapsed={inspectorCollapsed} onToggle={toggleInspector} />}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="panel-resize-status">{resizeAnnouncement}</span>

      <FocusDialog open={sessionSettings} onClose={() => setSessionSettings(false)} title="Session settings" description="Update the fields supported by PATCH /agent-sessions/:id." testId="session-settings-dialog" wide returnFocusTo={chatMenuTriggerRef.current}>
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault(); if (savingSettings) return;
          const data = new FormData(event.currentTarget);
          if (!live) { updateFixtureSession(selected.id, { name: String(data.get('name')), profileId: String(data.get('profile')), model: String(data.get('model')), thinkingBudget: String(data.get('thinking')), permissionMode: String(data.get('permission')), fastMode: data.get('fast') === 'on' }); setSessionSettings(false); notify('Session settings applied'); return; }
          const key = String(data.get('model')); const model = models.find(m => `${m.providerId}/${m.modelId}` === key);
          const account = String(data.get('account') ?? '');
          const openaiAccount = String(data.get('openaiAccount') ?? '');
          setSavingSettings(true); setSettingsError('');
          void saveSessionSettings(selected.id, { name: String(data.get('name')).trim(), profileId: String(data.get('profile')) || null, ...(model ? { providerId: model.providerId, modelId: model.modelId } : key === '' ? { providerId: null, modelId: null } : {}), thinkingBudget: data.get('thinking') === '' ? null : Number(data.get('thinking')), permissionMode: String(data.get('permission')), fastMode: data.get('fast') === 'on', ...(account && account !== selected.account ? { anthropicAccountId: account } : {}), ...(openaiAccount && openaiAccount !== selected.openaiAccount ? { openaiAccountId: openaiAccount } : {}) })
            .then(() => { setSessionSettings(false); notify('Session settings saved and read back'); })
            .catch(error => setSettingsError(error instanceof Error ? error.message : 'Session settings failed'))
            .finally(() => setSavingSettings(false));
        }}>
          {settingsError && <p className="span-2" role="alert">{settingsError}</p>}
          <label className="field span-2">Session name<input name="name" required defaultValue={selected.name} /></label>
          <label className="field">Agent<select name="profile" defaultValue={selected.profileId}><option value="">Session default</option>{profiles.filter((item) => item.enabled && item.selectable && (!live || !item.id.startsWith('profile-created-'))).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <label className="field">Model<select name="model" defaultValue={live ? selected.providerId && selected.modelId ? `${selected.providerId}/${selected.modelId}` : '' : selected.model}>{live ? <><option value="">Profile default</option>{selected.providerId && selected.modelId && !models.some(m => m.providerId === selected.providerId && m.modelId === selected.modelId) && <option value={`${selected.providerId}/${selected.modelId}`}>{selected.modelId} (unavailable; retain)</option>}{models.map(m => <option key={`${m.providerId}/${m.modelId}`} value={`${m.providerId}/${m.modelId}`}>{m.label} · {m.providerId}</option>)}</> : <><option>gpt-5.6</option><option>gpt-5.6-codex</option><option>claude-sonnet-4</option></>}</select></label>
          <label className="field">Reasoning{live ? <><input type="number" min="0" step="1" name="thinking" defaultValue={selected.thinkingBudget} /><span>Token budget; blank uses the default.</span></> : <select name="thinking" defaultValue={selected.thinkingBudget}><option>Off</option><option>Low</option><option>Medium</option><option>High</option><option>X-High</option><option>Max</option></select>}</label>
          <label className="field">Permissions<select name="permission" defaultValue={selected.permissionMode}>{live ? <><option value="default">Default</option><option value="acceptEdits">Accept Edits</option><option value="plan">Plan</option><option value="bypassPermissions">Bypass permissions (trusted workspaces only)</option></> : <><option>Default</option><option>Accept Edits</option><option>Plan</option><option>Bypass</option></>}</select></label>
          {live && <label className="field">Anthropic account<select name="account" defaultValue={selected.account ?? ''}><option value="">Keep current account</option>{selected.account && !accounts.some(a => a.id === selected.account) && <option value={selected.account}>{selected.account} (unavailable; retain)</option>}{accounts.map(a => <option value={a.id} key={a.id} disabled={!!a.status && a.status !== 'ok'}>{accountOptionLabel(a)}</option>)}</select></label>}
          {live && selected.providerId === 'openai' && openaiAccounts.length > 0 && <label className="field">OpenAI account<select name="openaiAccount" defaultValue={selected.openaiAccount ?? ''} data-testid="session-openai-account"><option value="">Keep current account</option>{selected.openaiAccount && !openaiAccounts.some(a => a.id === selected.openaiAccount) && <option value={selected.openaiAccount}>{selected.openaiAccount} (unavailable; retain)</option>}{openaiAccounts.map(a => <option value={a.id} key={a.id} disabled={!!a.status && a.status !== 'ok'}>{accountOptionLabel(a)}</option>)}</select></label>}
          <label className="check-label"><input name="fast" type="checkbox" defaultChecked={selected.fastMode} />Fast mode</label>
          <footer className="dialog-actions span-2"><button className="secondary-button" type="button" onClick={() => setSessionSettings(false)}>Cancel</button><button className="primary-button" type="submit" disabled={savingSettings || live && (!selected.id || readOnlyChild)} data-testid="save-session-settings">{savingSettings ? 'Saving…' : 'Save settings'}</button></footer>
        </form>
      </FocusDialog>
      <FocusDialog open={prepareOpen} onClose={() => setPrepareOpen(false)} title="Prepare project for agents" description="Initialize project instructions through POST /agent-sessions/:id/init." testId="prepare-project-dialog" returnFocusTo={prepareReturnFocusRef.current}>{live ? <p>The configured model will inspect this project and write instructions. This can use provider tokens and modify AGENTS.md.</p> : <div className="prepare-list"><span><Icon name="check" />Git repository available</span><span><Icon name="check" />Worktree can be isolated</span><span><Icon name="check" />AGENTS.md discovered</span></div>}<div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setPrepareOpen(false)}>Cancel</button><button className="primary-button" type="button" disabled={lifecycleDisabled} onClick={() => void prepareProject()} data-testid="confirm-prepare-project">{lifecycleBusy ? 'Preparing…' : 'Prepare project'}</button></div></FocusDialog>
      <FocusDialog
        open={Boolean(rhythmEntry.setup) && !rhythmEntry.opening}
        onClose={deferRhythmSetup}
        title="Set up Rhythm"
        description={rhythmEntry.setup?.profileChoices?.length
          ? 'One Rhythm conversation stays with you across projects.'
          : 'Rhythm could not confirm setup. Retry, or keep using ordinary chat.'}
        testId="rhythm-setup-dialog"
        returnFocusTo={chatMenuTriggerRef.current}>
        <div className="rhythm-setup">
          {rhythmEntry.setup?.profileChoices?.length ? <p className="rhythm-setup-copy">Choose the existing profile Rhythm should use for its configured model and tools. This does not change permissions.</p> : null}
          <div className="rhythm-setup-choice-list" role="group" aria-label="Choose a Rhythm profile" data-testid="rhythm-setup-choice-list">
            {rhythmEntry.setup?.profileChoices?.length
              ? rhythmEntry.setup.profileChoices.map((choice) => <button className="secondary-button rhythm-setup-choice" type="button" key={choice.id} onClick={() => { void startRhythmSetup(choice.id); }} data-testid={`rhythm-setup-profile-${choice.id}`}>{choice.label}</button>)
              : <button className="secondary-button rhythm-setup-choice" type="button" onClick={() => { void startRhythmSetup(); }} data-testid="rhythm-setup-retry">Retry setup</button>}
          </div>
          <footer className="rhythm-setup-footer" data-testid="rhythm-setup-footer">
            <button className="text-button" type="button" onClick={deferRhythmSetup} data-testid="rhythm-setup-keep-ordinary">Keep using ordinary chat</button>
          </footer>
        </div>
      </FocusDialog>
      <FocusDialog open={workstreamsOpen} onClose={() => setWorkstreamsOpen(false)} title="Workstreams" description="Explicit, bounded read-only workers for this project. Ordinary chat remains separate." testId="workstreams-dialog" wide>
        <WorkstreamsPanel projectId={selectedProject?.id ?? selected.projectId} parentSessionId={selectedProject || readOnlyChild || liveChildView ? null : selected.id} profiles={profiles} />
      </FocusDialog>
    </section>
  );
}
