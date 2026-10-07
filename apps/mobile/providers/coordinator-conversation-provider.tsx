import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { usePathname } from 'expo-router';
import { AppState } from 'react-native';

import {
  mobileCoordinatorScopeKey,
  MobileCoordinatorConversationController,
  type MobileCoordinatorPlanConsent,
  type MobileCoordinatorViewState,
} from '@/providers/coordinator-conversation-controller';
import {
  resolveMobileCoordinatorBinding,
  type MobileCoordinatorBinding,
  type MobileCoordinatorEligibility,
} from '@/providers/coordinator-conversation-binding';
import { createMobileCoordinatorJournal } from '@/providers/coordinator-conversation-journal';
import { useOpencode } from '@/providers/opencode-provider';
import { usePairedHost } from '@/providers/paired-host-provider';
import { useRhythmAccount } from '@/providers/rhythm-account-provider';
import { createPairedCoordinatorConversationGateway } from '@/providers/services/coordinator-conversations-service';
import type {
  MobileCoordinatorResolveResult,
  MobileCoordinatorSetupProfileChoice,
  MobileCoordinatorSetupResult,
} from '@/providers/services/coordinator-conversations-service';

type PrimaryEntry = {
  phase: 'idle' | 'resolving' | 'setting_up' | 'setup_required' | 'setup_choice' | 'switching_project' | 'opening_root' | 'opening_coordination' | 'ready' | 'unavailable';
  notice?: string;
  /** Server-returned opaque profile labels only; this is not a profile grant. */
  setup?: { commandKey: string; profileChoices?: MobileCoordinatorSetupProfileChoice[] };
};

type CoordinatorConversationContextValue = {
  eligibility: MobileCoordinatorEligibility;
  binding?: MobileCoordinatorBinding;
  state: MobileCoordinatorViewState;
  open: () => Promise<boolean>;
  refresh: () => Promise<boolean>;
  loadOlderHistory: () => Promise<boolean>;
  send: (message: string) => Promise<{ accepted: boolean }>;
  retry: () => Promise<boolean>;
  preparePlan: (goalId: string, consent: MobileCoordinatorPlanConsent) => Promise<boolean>;
  continuePlan: (goalId: string, authorizationId: string) => Promise<boolean>;
  retryPlan: () => Promise<boolean>;
  reviewConflict: () => Promise<boolean>;
  beginNewMessageAfterReview: () => Promise<boolean>;
  returnToNormal: () => void;
  /** Synchronous early fence for known explicit navigation (Back, ordinary chat, new chat). */
  revokePrimaryIntent: () => void;
  /** Ephemeral navigation state for the server-owned permanent Rhythm root. */
  primaryEntry: PrimaryEntry;
  resolvePrimary: () => Promise<boolean>;
  /** Explicit setup only; no mount/read path invokes it automatically. */
  setupPrimary: (profileId?: string) => Promise<boolean>;
};

const CoordinatorConversationContext = createContext<CoordinatorConversationContextValue | null>(null);

const inactive: MobileCoordinatorViewState = { enabled: false, phase: 'inactive' };

type PendingPrimaryRoot = {
  generation: number;
  actorKey: string;
  client: Parameters<typeof createPairedCoordinatorConversationGateway>[0];
  originProjectId: string;
  projectId: string;
  sessionId: string;
  phase: 'switching_project' | 'opening_root' | 'opening_coordination';
  /** Paired middleware withheld the conversation until the authenticated selector moves. */
  canonicalReplayRequired?: boolean;
  canonicalReplayRequested?: boolean;
  catalogRefreshRequested?: boolean;
  projectOpenRequested?: boolean;
  /** No paired SDK catalog row exists for this server-owned root. */
  inertBindingRequested?: boolean;
  /** Set only for a transport-replacement requalification; its intent must stay current across every await. */
  requalification?: PrimaryIntent;
  coordinatorOpenRequested?: boolean;
};

type PendingPrimarySetup = {
  generation: number;
  actorKey: string;
  client: Parameters<typeof createPairedCoordinatorConversationGateway>[0];
  commandKey: string;
  originProjectId: string;
  profileChoices?: MobileCoordinatorSetupProfileChoice[];
};

function setupCommandKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid
    ? `coordinator-setup:${uuid}`
    : `coordinator-setup:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

/**
 * A resolve response can designate the durable primary root before the paired
 * SDK catalog exposes a matching row. This is only a local view pointer for
 * the server-owned root: its synthetic UI key never becomes an SDK id or a
 * coordinator wire field.
 */
type ServerPrimaryBinding = {
  actorKey: string;
  client: Parameters<typeof createPairedCoordinatorConversationGateway>[0];
  /**
   * The explicitly selected ordinary view beneath this server-owned overlay.
   * Keeping that selection lets Return to normal reveal it again; changing it
   * is a user navigation event and revokes this temporary view pointer.
   */
  originUiSessionId?: string;
  binding: MobileCoordinatorBinding;
};

/**
 * The user's explicit choice to view the server-owned primary, retained across a
 * transport (paired-client) replacement. It is NOT a binding, SDK row, response
 * body, canonical state or grant: it only lets the provider make ONE fresh
 * read-only resolve through the new current client for the exact same scope.
 */
type PrimaryIntent = {
  userId: number;
  hostId: string;
  deviceId: string;
  actorKey: string;
  projectId: string;
  localRoot: string;
  /** The ordinary selection the primary was opened over (undefined = none). */
  originUiSessionId?: string;
  /** Route where the explicit entry happened (the Agents screen), before the chat route is reached. */
  creationPath: string;
  /** True once the user is on the primary chat route; from then on ANY other route revokes it for good. */
  bound: boolean;
  /** Route epoch observed when it became bound; a later epoch (leave and re-enter) never revives it. */
  routeEpoch: number;
  /** Last paired client seen for this intent. Only a REPLACEMENT of it arms requalification. */
  lastClient: object | null;
  armed: boolean;
};

/** The route `agents.tsx` pushes after the explicit Rhythm entry (app/agents/chat.tsx). */
const PRIMARY_ROUTE = '/agents/chat';

function intentBinding(intent: PrimaryIntent): MobileCoordinatorBinding {
  return {
    actorKey: intent.actorKey,
    projectId: intent.projectId,
    sessionId: intent.localRoot,
    uiSessionId: `server-primary:${intent.localRoot}`,
    source: 'server_primary',
  };
}

export function CoordinatorConversationProvider({ children }: PropsWithChildren) {
  const account = useRhythmAccount();
  const pairedHost = usePairedHost();
  const {
    activeProject,
    activeProjectPath,
    activeSession,
    connection,
    coordinatorSessionProvenance,
    currentSessionId,
    isHydrated,
    openProjectSessionState,
    openProjectSession,
    refreshWorkspaceCatalog,
    registeredGatewayProjectIds,
    selectProject,
    sessions,
    subscribeCoordinatorChanges,
    subscribeProjectReads,
    subscribeSessionActivity,
  } = useOpencode();
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === currentSessionId) ?? activeSession,
    [activeSession, currentSessionId, sessions],
  );
  const pairedClientRef = useRef(pairedHost.client);
  pairedClientRef.current = pairedHost.client;
  const journalRef = useRef<ReturnType<typeof createMobileCoordinatorJournal> | null>(null);
  if (!journalRef.current) journalRef.current = createMobileCoordinatorJournal();
  const controllerRef = useRef<MobileCoordinatorConversationController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new MobileCoordinatorConversationController((binding) => {
      const client = pairedClientRef.current;
      return client ? createPairedCoordinatorConversationGateway(client) : undefined;
    }, journalRef.current);
  }
  const controller = controllerRef.current;
  const actorKey = account.user && pairedHost.host
    ? 'user:' + account.user.id + ':host:' + pairedHost.host.hostId
    : undefined;
  const actorKeyRef = useRef(actorKey);
  actorKeyRef.current = actorKey;
  const activeProjectPathRef = useRef(activeProjectPath);
  activeProjectPathRef.current = activeProjectPath;
  const primaryGenerationRef = useRef(0);
  const primaryIntentRef = useRef<PrimaryIntent | null>(null);
  const previousPointerPresentRef = useRef(false);
  const accountUserIdRef = useRef(account.user?.id);
  accountUserIdRef.current = account.user?.id;
  const pairedHostRecordRef = useRef(pairedHost.host);
  pairedHostRecordRef.current = pairedHost.host;
  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;
  // Actual router identity. The provider wraps the whole Stack, so project/session equality cannot show that the
  // user left the chat route; every observed pathname change advances a monotonic local route epoch.
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const routeEpochRef = useRef(0);
  if (pathnameRef.current !== pathname) {
    pathnameRef.current = pathname;
    routeEpochRef.current += 1;
  }
  const pendingPrimaryRef = useRef<PendingPrimaryRoot | null>(null);
  const pendingSetupRef = useRef<PendingPrimarySetup | null>(null);
  // ponytail: optional chaining only because provider tests mock useOpencode without `connection`.
  const connectionStatus = connection?.status;
  const connectionStatusRef = useRef(connectionStatus);
  connectionStatusRef.current = connectionStatus;

  /** Synchronous: reads refs updated during render, so it is also valid right after an await. */
  const intentStillCurrent = useCallback((intent: PrimaryIntent): boolean => {
    if (primaryIntentRef.current !== intent) return false;
    const host = pairedHostRecordRef.current;
    if (
      accountUserIdRef.current !== intent.userId ||
      host?.hostId !== intent.hostId ||
      host?.deviceId !== intent.deviceId ||
      actorKeyRef.current !== intent.actorKey
    ) return false;
    const path = pathnameRef.current;
    if (intent.bound) return path === PRIMARY_ROUTE && routeEpochRef.current === intent.routeEpoch;
    return path === intent.creationPath || path === PRIMARY_ROUTE;
  }, []);
  /** Revoke for good; cancels an in-flight requalification so a late result cannot publish. */
  const revokePrimaryIntent = useCallback(() => {
    const intent = primaryIntentRef.current;
    if (!intent) return;
    primaryIntentRef.current = null;
    primaryGenerationRef.current += 1;
    if (pendingPrimaryRef.current?.requalification) pendingPrimaryRef.current = null;
  }, []);
  const [primaryEntry, setPrimaryEntry] = useState<PrimaryEntry>({ phase: 'idle' });
  // A same-project resolve does not change the catalog props, so it needs an
  // explicit render tick to begin the server-root transition.
  const [primaryNavigationRevision, setPrimaryNavigationRevision] = useState(0);
  // A catalog refresh can legitimately return the same object identities. Keep
  // a local completion revision so the server-directed root flow is not left
  // waiting for a provider render that never arrives.
  const [primaryCatalogRevision, setPrimaryCatalogRevision] = useState(0);
  const [serverPrimaryBinding, setServerPrimaryBinding] = useState<ServerPrimaryBinding | null>(null);
  const eligibility = useMemo(() => resolveMobileCoordinatorBinding({
    actorKey,
    pairedClient: pairedHost.client,
    currentSessionId,
    selectedSession,
    activeProjectPath,
    activeProject,
    coordinatorSessionProvenance,
    openProjectSessionState,
    registeredGatewayProjectIds,
  }), [
    activeProject,
    activeProjectPath,
    actorKey,
    coordinatorSessionProvenance,
    currentSessionId,
    openProjectSessionState,
    pairedHost.client,
    registeredGatewayProjectIds,
    selectedSession,
  ]);
  const activeServerPrimaryBinding = useMemo(() => {
    if (!serverPrimaryBinding) return undefined;
    const candidate = serverPrimaryBinding.binding;
    // This pointer exists only after the user explicitly chose Rhythm. It can
    // temporarily cover that same ordinary selection when the server's root
    // has no paired SDK catalog row, but a later user selection revokes it.
    // It never derives an SDK id or normal-chat root from that selection.
    if (
      currentSessionId !== serverPrimaryBinding.originUiSessionId ||
      actorKey !== serverPrimaryBinding.actorKey ||
      pairedHost.client !== serverPrimaryBinding.client ||
      activeProjectPath !== candidate.projectId ||
      activeProject?.id !== candidate.projectId ||
      !registeredGatewayProjectIds.has(candidate.projectId)
    ) return undefined;
    return candidate;
  }, [
    activeProject,
    activeProjectPath,
    actorKey,
    currentSessionId,
    pairedHost.client,
    registeredGatewayProjectIds,
    serverPrimaryBinding,
  ]);
  // The explicit server-root view wins only while its qualified origin view
  // remains unchanged. Otherwise normal chat eligibility remains untouched.
  const effectiveEligibility = useMemo<MobileCoordinatorEligibility>(() => (
    activeServerPrimaryBinding
      ? { available: true, binding: activeServerPrimaryBinding }
      : eligibility
  ), [activeServerPrimaryBinding, eligibility]);
  const binding = effectiveEligibility.available ? effectiveEligibility.binding : undefined;
  const bindingKey = mobileCoordinatorScopeKey(binding);
  const [, setRevision] = useState(0);

  useEffect(() => controller.subscribe(() => setRevision((revision) => revision + 1)), [controller]);

  useEffect(() => {
    // A replaced paired client fences old reads even for an unchanged scope.
    controller.activate(binding, pairedHost.client);
    if (!binding) return;
    let active = true;
    void controller.hydrate(binding).then((hydrated) => {
      if (active && hydrated && controller.get(binding).enabled) {
        void controller.open(binding);
      }
    });
    return () => { active = false; };
  }, [binding, bindingKey, controller, pairedHost.client]);

  const bindingRef = useRef(binding);
  bindingRef.current = binding;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  // A canonical result can arrive after the user stopped interacting. Qualified
  // session events for the exact current root, and a foreground return, only
  // trigger a read-only revalidation; they never grant authority or send.
  useEffect(() => subscribeSessionActivity((event) => {
    const current = bindingRef.current;
    if (!current || event.projectId !== current.projectId || activeProjectPathRef.current !== current.projectId) return;
    // An inert server primary has no SDK id: only a catalog row that carries
    // its exact local root qualifies, so an ordinary chat's events never do.
    const exact = current.source === 'server_primary'
      ? sessionsRef.current.some((session) =>
        session.id === event.sessionId &&
        !session.parentID &&
        session.rhythm?.localSessionId?.trim() === current.sessionId &&
        (typeof (session as { projectId?: unknown }).projectId !== 'string' ||
          (session as { projectId?: string }).projectId === current.projectId))
      : event.sessionId === current.uiSessionId;
    if (exact) void controller.revalidate(current);
  }), [controller, subscribeSessionActivity]);

  // Reserved server hint from the paired project stream. It is identity-only:
  // the current client, project, exact local root and the conversation already
  // read for this enabled binding must all match before the read-only,
  // epoch-fenced revalidation. It grants nothing and carries no transcript.
  useEffect(() => subscribeCoordinatorChanges((change) => {
    const current = bindingRef.current;
    if (
      !current ||
      change.pairedClient !== pairedClientRef.current ||
      change.projectId !== current.projectId ||
      activeProjectPathRef.current !== current.projectId ||
      change.localSessionId !== current.sessionId ||
      controller.get(current).conversation?.id !== change.conversationId
    ) return;
    void controller.revalidate(current);
  }), [controller, subscribeCoordinatorChanges]);

  // The existing safety fallback finished a project read for the current
  // client. It names no session, so it only revalidates the current enabled
  // binding in that exact project through its own authenticated reads.
  useEffect(() => subscribeProjectReads((read) => {
    const current = bindingRef.current;
    if (current && read.projectId === current.projectId && activeProjectPathRef.current === current.projectId) {
      void controller.revalidate(current);
    }
  }), [controller, subscribeProjectReads]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const current = bindingRef.current;
      if (state === 'active' && current) void controller.revalidate(current);
    });
    return () => subscription.remove();
  }, [controller]);

  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => () => {
    primaryGenerationRef.current += 1;
    primaryIntentRef.current = null;
    pendingPrimaryRef.current = null;
    pendingSetupRef.current = null;
  }, []);

  const primaryStillCurrent = useCallback((pending: PendingPrimaryRoot) => (
    pendingPrimaryRef.current === pending &&
    primaryGenerationRef.current === pending.generation &&
    actorKeyRef.current === pending.actorKey &&
    pairedClientRef.current === pending.client &&
    (!pending.requalification || intentStillCurrent(pending.requalification))
  ), [intentStillCurrent]);

  // An account/paired-host change makes a previously resolved root
  // inaccessible. Keep ordinary chat intact and never let the old response
  // select or open a root for the new identity.
  useEffect(() => {
    const pending = pendingPrimaryRef.current;
    const setup = pendingSetupRef.current;
    if ((!pending || (pending.actorKey === actorKey && pending.client === pairedHost.client)) &&
      (!setup || (setup.actorKey === actorKey && setup.client === pairedHost.client))) return;
    primaryGenerationRef.current += 1;
    pendingPrimaryRef.current = null;
    pendingSetupRef.current = null;
    setPrimaryEntry({ phase: 'idle', notice: 'Rhythm selection changed. Ordinary chats remain available.' });
  }, [actorKey, pairedHost.client]);

  // Revocation. Route exit and explicit selection/identity change end the intent for good; an undefined
  // project/selection/host value is transport clearing and is neither authority nor a reason to revoke.
  useEffect(() => {
    const intent = primaryIntentRef.current;
    if (!intent) return;
    const host = pairedHost.host;
    if (
      account.user?.id !== intent.userId ||
      !host || host.hostId !== intent.hostId || host.deviceId !== intent.deviceId ||
      (activeProjectPath !== undefined && activeProjectPath !== intent.projectId) ||
      (currentSessionId !== undefined && currentSessionId !== intent.originUiSessionId) ||
      (intent.bound
        ? pathname !== PRIMARY_ROUTE || routeEpochRef.current !== intent.routeEpoch
        : pathname !== intent.creationPath && pathname !== PRIMARY_ROUTE)
    ) {
      revokePrimaryIntent();
      return;
    }
    if (!intent.bound && pathname === PRIMARY_ROUTE) {
      intent.bound = true;
      intent.routeEpoch = routeEpochRef.current;
    }
  }, [account.user?.id, activeProjectPath, currentSessionId, pairedHost.host, pathname, revokePrimaryIntent]);

  useEffect(() => {
    setServerPrimaryBinding((current) => {
      if (!current) return current;
      const binding = current.binding;
      return currentSessionId === current.originUiSessionId &&
        current.actorKey === actorKey &&
        current.client === pairedHost.client &&
        activeProjectPath === binding.projectId &&
        activeProject?.id === binding.projectId &&
        registeredGatewayProjectIds.has(binding.projectId)
        ? current
        : null;
    });
  }, [activeProject, activeProjectPath, actorKey, currentSessionId, pairedHost.client, registeredGatewayProjectIds]);

  const beginPrimaryNavigation = useCallback((result: Extract<MobileCoordinatorResolveResult, { kind: 'resolved' }> | Extract<MobileCoordinatorSetupResult, { kind: 'setup_created' | 'setup_replay' }>, input: {
    generation: number;
    actorKey: string;
    client: Parameters<typeof createPairedCoordinatorConversationGateway>[0];
    originProjectId: string;
    requalification?: PrimaryIntent;
  }): boolean => {
    if (result.conversation.primaryOwnerRoot !== true) {
      setPrimaryEntry({ phase: 'unavailable', notice: 'Rhythm could not confirm its server-bound root. Ordinary chats remain available.' });
      return false;
    }
    const pending: PendingPrimaryRoot = {
      generation: input.generation,
      actorKey: input.actorKey,
      client: input.client,
      originProjectId: input.originProjectId,
      projectId: result.projectId,
      sessionId: result.sessionId,
      phase: 'switching_project',
      ...(input.requalification ? { requalification: input.requalification } : {}),
    };
    pendingPrimaryRef.current = pending;
    setPrimaryNavigationRevision((revision) => revision + 1);
    setPrimaryEntry({ phase: 'switching_project', notice: 'Opening the server-bound Rhythm chat…' });
    // The server-returned opaque project is the only switch target. This is
    // not an SDK/session-ID guess and does not create a chat or model turn.
    if (result.projectId !== activeProjectPathRef.current) selectProject(result.projectId);
    return true;
  }, [selectProject]);

  // Requalification: ONLY a proven transport-only client replacement (same user/host/device, connected to
  // connected) arms ONE fresh read-only resolve through the new client. A pointer merely disappearing never does.
  useEffect(() => {
    const intent = primaryIntentRef.current;
    const client = pairedHost.client;
    if (!intent) return;
    if (client !== intent.lastClient) {
      if (intent.lastClient && client && intent.bound && intent.hostId === pairedHost.host?.hostId &&
        intent.deviceId === pairedHost.host?.deviceId && pairedHost.state === 'connected') {
        intent.armed = true;
      }
      intent.lastClient = client;
    }
    if (
      !intent.armed || !client || !intentStillCurrent(intent) ||
      pairedHost.state !== 'connected' || connectionStatus !== 'connected' || !isHydrated ||
      activeProjectPath !== intent.projectId || activeProject?.id !== intent.projectId ||
      !registeredGatewayProjectIds.has(intent.projectId) || currentSessionId !== intent.originUiSessionId
    ) return;
    intent.armed = false;
    // A pending command is never carried into new authority: stay unavailable instead.
    if (!controller.discardCanonicalView(intentBinding(intent))) {
      revokePrimaryIntent();
      setPrimaryEntry({ phase: 'unavailable', notice: 'Rhythm could not be restored. Ordinary chats remain available.' });
      return;
    }
    const generation = ++primaryGenerationRef.current;
    pendingPrimaryRef.current = null;
    const current = () => (
      generation === primaryGenerationRef.current &&
      pairedClientRef.current === client &&
      intentStillCurrent(intent) &&
      connectionStatusRef.current === 'connected' &&
      activeProjectPathRef.current === intent.projectId &&
      currentSessionIdRef.current === intent.originUiSessionId
    );
    setPrimaryEntry({ phase: 'resolving', notice: 'Restoring your Rhythm chat…' });
    void createPairedCoordinatorConversationGateway(client).resolve!({ projectId: intent.projectId }).then((result) => {
      if (!current()) return;
      if (
        result.kind !== 'resolved' || result.conversation.primaryOwnerRoot !== true ||
        result.projectId !== intent.projectId || result.sessionId !== intent.localRoot
      ) {
        revokePrimaryIntent();
        setPrimaryEntry({ phase: 'unavailable', notice: 'Rhythm could not be restored. Ordinary chats remain available.' });
        return;
      }
      beginPrimaryNavigation(result, {
        generation,
        actorKey: intent.actorKey,
        client,
        originProjectId: intent.projectId,
        requalification: intent,
      });
    }).catch(() => {
      if (!current()) return;
      setPrimaryEntry({ phase: 'unavailable', notice: 'Rhythm could not be reached. Ordinary chats remain available.' });
    });
  }, [
    activeProject, activeProjectPath, beginPrimaryNavigation, connectionStatus, controller, currentSessionId,
    intentStillCurrent, isHydrated, pairedHost.client, pairedHost.host, pairedHost.state,
    registeredGatewayProjectIds, revokePrimaryIntent,
  ]);

  const resolvePrimary = useCallback(async (): Promise<boolean> => {
    const client = pairedHost.client;
    const projectId = activeProjectPath?.trim();
    const currentActor = actorKey;
    const generation = ++primaryGenerationRef.current;
    primaryIntentRef.current = null;
    pendingPrimaryRef.current = null;
    pendingSetupRef.current = null;
    setServerPrimaryBinding(null);
    if (!currentActor || !client) {
      setPrimaryEntry({
        phase: 'unavailable',
        notice: 'Rhythm needs the current paired project catalog. Ordinary chats remain available.',
      });
      return false;
    }
    if (!projectId || !registeredGatewayProjectIds.has(projectId)) {
      const setup: PendingPrimarySetup = {
        generation,
        actorKey: currentActor,
        client,
        commandKey: setupCommandKey(),
        originProjectId: projectId ?? '',
      };
      pendingSetupRef.current = setup;
      setPrimaryEntry({
        phase: 'setup_required',
        notice: 'Rhythm needs one-time setup before a paired project is available. Ordinary chats remain available.',
        setup: { commandKey: setup.commandKey },
      });
      return false;
    }
    setPrimaryEntry({ phase: 'resolving', notice: 'Finding your server-bound Rhythm chat…' });
    try {
      const result = await createPairedCoordinatorConversationGateway(client).resolve!({ projectId });
      if (
        generation !== primaryGenerationRef.current ||
        actorKeyRef.current !== currentActor ||
        pairedClientRef.current !== client
      ) return false;
      if (activeProjectPathRef.current !== projectId) {
        setPrimaryEntry({ phase: 'idle', notice: 'Rhythm project selection changed. Ordinary chats remain available.' });
        return false;
      }
      if (result.kind === 'canonical_project_switch_required') {
        // The paired route deliberately withholds the conversation/root until
        // the authenticated selector commits the server-owned opaque project.
        // A catalog membership check keeps a malformed or stale switch reply
        // from selecting a path, SDK identity, or unregistered project.
        if (!registeredGatewayProjectIds.has(result.projectId)) {
          setPrimaryEntry({
            phase: 'unavailable',
            notice: 'The server-bound Rhythm project is not in the current paired catalog. Ordinary chats remain available.',
          });
          return false;
        }
        const pending: PendingPrimaryRoot = {
          generation,
          actorKey: currentActor,
          client,
          originProjectId: projectId,
          projectId: result.projectId,
          sessionId: result.sessionId,
          phase: 'switching_project',
          canonicalReplayRequired: true,
        };
        pendingPrimaryRef.current = pending;
        setPrimaryNavigationRevision((revision) => revision + 1);
        setPrimaryEntry({ phase: 'switching_project', notice: 'Switching to the server-bound Rhythm project…' });
        if (result.projectId !== activeProjectPathRef.current) selectProject(result.projectId);
        return true;
      }
      if (result.kind === 'setup_unavailable') {
        const setup: PendingPrimarySetup = {
          generation,
          actorKey: currentActor,
          client,
          commandKey: setupCommandKey(),
          originProjectId: projectId,
        };
        pendingSetupRef.current = setup;
        setPrimaryEntry({
          phase: 'setup_required',
          notice: 'Set up Rhythm to create its server-bound chat. Ordinary chats remain available.',
          setup: { commandKey: setup.commandKey },
        });
        return false;
      }
      if (result.kind !== 'resolved' || result.conversation.primaryOwnerRoot !== true) {
        setPrimaryEntry({
          phase: 'unavailable',
          notice: 'Rhythm is not available for this paired workspace. Ordinary chats remain available.',
        });
        return false;
      }
      return beginPrimaryNavigation(result, {
        generation,
        actorKey: currentActor,
        client,
        originProjectId: projectId,
      });
    } catch {
      if (generation === primaryGenerationRef.current && activeProjectPathRef.current === projectId) {
        setPrimaryEntry({ phase: 'unavailable', notice: 'Rhythm could not be reached. Ordinary chats remain available.' });
      } else if (generation === primaryGenerationRef.current) {
        setPrimaryEntry({ phase: 'idle', notice: 'Rhythm project selection changed. Ordinary chats remain available.' });
      }
      return false;
    }
  }, [activeProjectPath, actorKey, beginPrimaryNavigation, pairedHost.client, registeredGatewayProjectIds, selectProject]);

  const setupPrimary = useCallback(async (profileId?: string): Promise<boolean> => {
    const client = pairedHost.client;
    const currentActor = actorKey;
    const current = pendingSetupRef.current;
    if (!client || !currentActor || !current || current.actorKey !== currentActor || current.client !== client) {
      setPrimaryEntry({ phase: 'unavailable', notice: 'Rhythm setup is no longer available for this signed-in paired connection. Ordinary chats remain available.' });
      return false;
    }
    if (profileId !== undefined && !current.profileChoices?.some((choice) => choice.id === profileId)) {
      setPrimaryEntry({
        phase: 'setup_choice',
        notice: 'Choose one of the currently offered Rhythm profiles.',
        setup: { commandKey: current.commandKey, profileChoices: current.profileChoices },
      });
      return false;
    }
    const generation = ++primaryGenerationRef.current;
    primaryIntentRef.current = null;
    const attempt: PendingPrimarySetup = { ...current, generation };
    pendingSetupRef.current = attempt;
    setPrimaryEntry({
      phase: 'setting_up',
      notice: 'Setting up the server-bound Rhythm chat…',
      setup: { commandKey: attempt.commandKey, profileChoices: attempt.profileChoices },
    });
    try {
      // Setup intentionally precedes any selected-project guard. The paired
      // client contributes its per-request device credential; the server alone
      // chooses the fresh owner-bound project and root.
      const result = await createPairedCoordinatorConversationGateway(client).setup!({
        commandKey: attempt.commandKey,
        ...(profileId === undefined ? {} : { profileId }),
      });
      if (
        pendingSetupRef.current !== attempt ||
        generation !== primaryGenerationRef.current ||
        actorKeyRef.current !== currentActor ||
        pairedClientRef.current !== client
      ) return false;
      if (activeProjectPathRef.current !== attempt.originProjectId) {
        setPrimaryEntry({ phase: 'idle', notice: 'Rhythm project selection changed. Ordinary chats remain available.' });
        return false;
      }
      if (result.kind === 'setup_profile_choice_required') {
        attempt.profileChoices = result.profileChoices;
        setPrimaryEntry({
          phase: 'setup_choice',
          notice: 'Choose a currently eligible Rhythm profile. This choice does not grant model or workspace authority.',
          setup: { commandKey: attempt.commandKey, profileChoices: result.profileChoices },
        });
        return false;
      }
      if (result.kind === 'setup_created' || result.kind === 'setup_replay') {
        pendingSetupRef.current = null;
        setServerPrimaryBinding(null);
        return beginPrimaryNavigation(result, {
          generation,
          actorKey: currentActor,
          client,
          originProjectId: attempt.originProjectId,
        });
      }
      setPrimaryEntry({
        phase: 'setup_required',
        notice: 'Rhythm setup is unavailable right now. No chat, model turn, or workspace was created from this screen.',
        setup: { commandKey: attempt.commandKey, profileChoices: attempt.profileChoices },
      });
      return false;
    } catch {
      if (
        pendingSetupRef.current === attempt &&
        generation === primaryGenerationRef.current &&
        actorKeyRef.current === currentActor &&
        pairedClientRef.current === client
      ) {
        // A timeout or malformed response may have reached the server. Keep
        // the exact idempotency key rather than issuing a second setup.
        setPrimaryEntry({
          phase: 'setup_required',
          notice: 'Rhythm setup could not be confirmed. Retry this same setup request when ready.',
          setup: { commandKey: attempt.commandKey, profileChoices: attempt.profileChoices },
        });
      }
      return false;
    }
  }, [actorKey, beginPrimaryNavigation, pairedHost.client]);

  // After the authorized project switch, discover the server root only from
  // the current paired catalog's Rhythm metadata. `projectID` and SDK ids can
  // be engine values, so neither is used as a coordinator root identity.
  useEffect(() => {
    const pending = pendingPrimaryRef.current;
    if (!pending || !primaryStillCurrent(pending)) return;
    if (activeProjectPath !== pending.projectId) {
      // The initial old-project render is expected while selectProject commits.
      // Any third project is a user/scope change, not permission to continue.
      if (activeProjectPath && activeProjectPath !== pending.originProjectId) {
        primaryGenerationRef.current += 1;
        pendingPrimaryRef.current = null;
        setPrimaryEntry({ phase: 'idle', notice: 'Rhythm project selection changed. Ordinary chats remain available.' });
      }
      return;
    }
    if (!activeProject || activeProject.id !== pending.projectId || !registeredGatewayProjectIds.has(pending.projectId)) {
      if (!pending.catalogRefreshRequested) {
        pending.catalogRefreshRequested = true;
        setPrimaryEntry({ phase: 'switching_project', notice: 'Waiting for the current paired project catalog…' });
        void refreshWorkspaceCatalog(true).then(() => {
          if (primaryStillCurrent(pending)) setPrimaryCatalogRevision((revision) => revision + 1);
        }).catch(() => {
          if (!primaryStillCurrent(pending)) return;
          pendingPrimaryRef.current = null;
          setPrimaryEntry({ phase: 'unavailable', notice: 'The paired project catalog is unavailable. Ordinary chats remain available.' });
        });
      } else {
        // The requested refresh completed without a current qualified catalog.
        // Do not keep trying against a cached project or guess an SDK root.
        pendingPrimaryRef.current = null;
        setPrimaryEntry({ phase: 'unavailable', notice: 'The server-bound Rhythm project is not in the current paired catalog. Ordinary chats remain available.' });
      }
      return;
    }
    // A selected project alone is not catalog proof. Revalidate once after
    // the server-directed switch before looking for the metadata root.
    if (!pending.catalogRefreshRequested) {
      pending.catalogRefreshRequested = true;
      setPrimaryEntry({ phase: 'switching_project', notice: 'Checking the current paired project catalog…' });
      void refreshWorkspaceCatalog(true).then(() => {
        if (primaryStillCurrent(pending)) setPrimaryCatalogRevision((revision) => revision + 1);
      }).catch(() => {
        if (!primaryStillCurrent(pending)) return;
        pendingPrimaryRef.current = null;
        setPrimaryEntry({ phase: 'unavailable', notice: 'The paired project catalog is unavailable. Ordinary chats remain available.' });
      });
      return;
    }
    if (pending.canonicalReplayRequired) {
      if (pending.canonicalReplayRequested) return;
      pending.canonicalReplayRequested = true;
      setPrimaryEntry({ phase: 'switching_project', notice: 'Confirming the server-bound Rhythm root…' });
      void createPairedCoordinatorConversationGateway(pending.client)
        .resolve!({ projectId: pending.projectId })
        .then((result) => {
          if (!primaryStillCurrent(pending)) return;
          if (activeProjectPathRef.current !== pending.projectId) {
            pendingPrimaryRef.current = null;
            setPrimaryEntry({ phase: 'idle', notice: 'Rhythm project selection changed. Ordinary chats remain available.' });
            return;
          }
          if (
            result.kind !== 'resolved' ||
            result.projectId !== pending.projectId ||
            result.sessionId !== pending.sessionId ||
            result.conversation.primaryOwnerRoot !== true
          ) {
            pendingPrimaryRef.current = null;
            setPrimaryEntry({ phase: 'unavailable', notice: 'Rhythm could not confirm its server-bound root. Ordinary chats remain available.' });
            return;
          }
          pending.canonicalReplayRequired = false;
          setPrimaryNavigationRevision((revision) => revision + 1);
        })
        .catch(() => {
          if (!primaryStillCurrent(pending)) return;
          pendingPrimaryRef.current = null;
          setPrimaryEntry({ phase: 'unavailable', notice: 'Rhythm could not be reached. Ordinary chats remain available.' });
        });
      return;
    }
    const root = sessions.find((session) =>
      !session.parentID &&
      session.rhythm?.localSessionId?.trim() === pending.sessionId &&
      (typeof (session as { projectId?: unknown }).projectId !== 'string' ||
        (session as { projectId?: string }).projectId === pending.projectId),
    );
    if (!root) {
      if (pending.inertBindingRequested) return;
      // The server is authoritative for its primary root. If the qualified
      // current paired project catalog has no SDK row, use a distinct local
      // view pointer rather than guessing an SDK id or falling back to an
      // ordinary chat. This explicit view remains valid only until the user
      // changes the normal selection beneath it or its paired scope changes.
      pending.inertBindingRequested = true;
      pending.phase = 'opening_coordination';
      const host = pairedHostRecordRef.current;
      const userId = accountUserIdRef.current;
      if (!pending.requalification && host && userId !== undefined) {
        const here = pathnameRef.current;
        primaryIntentRef.current = {
          userId,
          hostId: host.hostId,
          deviceId: host.deviceId,
          actorKey: pending.actorKey,
          projectId: pending.projectId,
          localRoot: pending.sessionId,
          originUiSessionId: currentSessionId,
          creationPath: here,
          bound: here === PRIMARY_ROUTE,
          routeEpoch: routeEpochRef.current,
          lastClient: pending.client,
          armed: false,
        };
      }
      setServerPrimaryBinding({
        actorKey: pending.actorKey,
        client: pending.client,
        originUiSessionId: currentSessionId,
        binding: {
          actorKey: pending.actorKey,
          projectId: pending.projectId,
          sessionId: pending.sessionId,
          uiSessionId: `server-primary:${pending.sessionId}`,
          source: 'server_primary',
        },
      });
      setPrimaryEntry({ phase: 'opening_coordination', notice: 'Opening the server-bound Rhythm chat…' });
      return;
    }
    if (pending.projectOpenRequested) return;
    // A catalog row now carries this root, so ordinary catalog eligibility owns it; no inert intent remains.
    primaryIntentRef.current = null;
    pending.projectOpenRequested = true;
    pending.phase = 'opening_root';
    setPrimaryEntry({ phase: 'opening_root', notice: 'Opening the current paired Rhythm root…' });
    void openProjectSession(pending.projectId, root.id).then(() => {
      if (!primaryStillCurrent(pending)) return;
      // Binding activation below still requires fresh actor/client/catalog
      // provenance before it can issue coordinator open/status.
    }).catch(() => {
      if (!primaryStillCurrent(pending)) return;
      pendingPrimaryRef.current = null;
      setPrimaryEntry({ phase: 'unavailable', notice: 'The Rhythm root could not be opened. Ordinary chats remain available.' });
    });
  }, [activeProject, activeProjectPath, currentSessionId, openProjectSession, primaryCatalogRevision, primaryNavigationRevision, primaryStillCurrent, refreshWorkspaceCatalog, registeredGatewayProjectIds, sessions]);

  useEffect(() => {
    const pending = pendingPrimaryRef.current;
    if (
      !pending ||
      !primaryStillCurrent(pending) ||
      pending.coordinatorOpenRequested ||
      !binding ||
      binding.actorKey !== pending.actorKey ||
      binding.projectId !== pending.projectId ||
      binding.sessionId !== pending.sessionId
    ) return;
    pending.coordinatorOpenRequested = true;
    pending.phase = 'opening_coordination';
    setPrimaryEntry({ phase: 'opening_coordination', notice: 'Loading Rhythm coordination…' });
    void controller.open(binding).then((opened) => {
      if (!primaryStillCurrent(pending)) return;
      pendingPrimaryRef.current = null;
      setPrimaryEntry(opened
        ? { phase: 'ready', notice: 'Rhythm is ready.' }
        : { phase: 'unavailable', notice: 'Rhythm could not be opened. Ordinary chats remain available.' });
    });
  }, [binding, controller, primaryStillCurrent]);

  const state = binding ? controller.get(binding) : inactive;
  const open = useCallback(() => binding ? controller.open(binding) : Promise.resolve(false), [binding, controller]);
  const refresh = useCallback(() => binding ? controller.refresh(binding) : Promise.resolve(false), [binding, controller]);
  const loadOlderHistory = useCallback(
    () => binding ? controller.loadOlderHistory(binding) : Promise.resolve(false),
    [binding, controller],
  );
  const send = useCallback((message: string) => binding ? controller.send(binding, message) : Promise.resolve({ accepted: false }), [binding, controller]);
  const retry = useCallback(() => binding ? controller.retry(binding) : Promise.resolve(false), [binding, controller]);
  const preparePlan = useCallback(
    (goalId: string, consent: MobileCoordinatorPlanConsent) => binding
      ? controller.preparePlan(binding, goalId, consent)
      : Promise.resolve(false),
    [binding, controller],
  );
  const continuePlan = useCallback(
    (goalId: string, authorizationId: string) => binding
      ? controller.continuePlan(binding, goalId, authorizationId)
      : Promise.resolve(false),
    [binding, controller],
  );
  const retryPlan = useCallback(() => binding ? controller.retryPlan(binding) : Promise.resolve(false), [binding, controller]);
  const reviewConflict = useCallback(() => binding ? controller.reviewConflict(binding) : Promise.resolve(false), [binding, controller]);
  const beginNewMessageAfterReview = useCallback(() => binding ? controller.beginNewMessageAfterReview(binding) : Promise.resolve(false), [binding, controller]);
  const returnToNormal = useCallback(() => {
    // Revoke even when no binding is visible (e.g. during a replacement-client read).
    const hadIntent = primaryIntentRef.current !== null;
    revokePrimaryIntent();
    if (binding) controller.returnToNormal(binding);
    if (binding?.source === 'server_primary' || hadIntent) {
      setServerPrimaryBinding(null);
      setPrimaryEntry({ phase: 'idle', notice: 'Returned to normal chat.' });
    }
  }, [binding, controller, revokePrimaryIntent]);

  const value = useMemo<CoordinatorConversationContextValue>(() => ({
    eligibility: effectiveEligibility,
    binding,
    state,
    open,
    refresh,
    loadOlderHistory,
    send,
    retry,
    preparePlan,
    continuePlan,
    retryPlan,
    reviewConflict,
    beginNewMessageAfterReview,
    returnToNormal,
    revokePrimaryIntent,
    primaryEntry,
    resolvePrimary,
    setupPrimary,
  }), [
    beginNewMessageAfterReview,
    binding,
    open,
    preparePlan,
    continuePlan,
    refresh,
    loadOlderHistory,
    retry,
    retryPlan,
    reviewConflict,
    primaryEntry,
    resolvePrimary,
    setupPrimary,
    returnToNormal,
    revokePrimaryIntent,
    send,
    state,
    effectiveEligibility,
  ]);

  return (
    <CoordinatorConversationContext.Provider value={value}>
      {children}
    </CoordinatorConversationContext.Provider>
  );
}

export function useCoordinatorConversation(): CoordinatorConversationContextValue {
  const value = useContext(CoordinatorConversationContext);
  if (!value) throw new Error('useCoordinatorConversation must be used within CoordinatorConversationProvider');
  return value;
}
